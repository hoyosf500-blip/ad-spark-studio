import { createServerFn } from "@tanstack/react-start";
import { setResponseHeaders } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SYS_ANALYZE, SYS_GENERATE } from "@/lib/system-prompts";
import type { Database } from "@/integrations/supabase/types";

// ─── pricing tables (USD per 1M tokens) ───────────────────────────────
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
};

function priceFor(model: string) {
  return PRICING[model] ?? PRICING["claude-sonnet-4-6"];
}

function calcCost(model: string, input: number, output: number) {
  const p = priceFor(model);
  return (input * p.input + output * p.output) / 1_000_000;
}

// Service-role client for trusted writes from server functions (already auth'd via middleware)
function adminClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

async function logUsage(opts: {
  userId: string;
  workspaceId?: string | null;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  metadata?: Record<string, unknown>;
}) {
  const cost = calcCost(opts.model, opts.inputTokens, opts.outputTokens);
  const sb = adminClient();
  const row = {
    user_id: opts.userId,
    workspace_id: opts.workspaceId ?? null,
    provider: "anthropic",
    model: opts.model,
    operation: opts.operation,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cost_usd: cost,
    metadata: opts.metadata ?? {},
  };
  // Cast: the generated type for insert can be too strict in some Supabase versions.
  await sb.from("api_usage").insert(row as never);
  return cost;
}

// Build the multimodal user message: frames + optional product photo + optional transcription
type FrameInput = { time: number; dataUrl: string };
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

function dataUrlToBase64(dataUrl: string): { mediaType: string; b64: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return { mediaType: "image/jpeg", b64: dataUrl };
  return { mediaType: m[1], b64: m[2] };
}

function buildAnalyzeContent(opts: {
  frames: FrameInput[];
  productPhoto?: string | null;
  transcription?: string | null;
}): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  blocks.push({
    type: "text",
    text: `Analiza este video frame por frame. Recibes ${opts.frames.length} frames extraídos a 1fps.`,
  });
  opts.frames.forEach((f) => {
    const { mediaType, b64 } = dataUrlToBase64(f.dataUrl);
    blocks.push({
      type: "text",
      text: `\nFRAME ${Math.round(f.time)}s (timestamp ${f.time.toFixed(2)}s):`,
    });
    blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
  });
  if (opts.productPhoto) {
    const { mediaType, b64 } = dataUrlToBase64(opts.productPhoto);
    blocks.push({
      type: "text",
      text: "\n\nFOTO DEL PRODUCTO (referencia adicional, no es un frame del video):",
    });
    blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
  }
  if (opts.transcription && opts.transcription.trim()) {
    blocks.push({
      type: "text",
      text: `\n\nTRANSCRIPCIÓN PROVISTA POR EL USUARIO (úsala como verdad, completa con tu lectura de frames):\n${opts.transcription.trim()}`,
    });
  }
  blocks.push({
    type: "text",
    text:
      "\n\nProduce el análisis completo siguiendo EXACTAMENTE el formato definido en tu role. " +
      "No omitas frames. Termina con la sección final de transcripción consolidada.",
  });
  return blocks;
}

// ─── ANALYZE: returns the full analysis as one shot (with usage tracking) ──
export const anthropicAnalyze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      frames: FrameInput[];
      productPhoto?: string | null;
      transcription?: string | null;
      model?: string;
      workspaceId?: string | null;
    }) => {
      if (!Array.isArray(input.frames) || input.frames.length === 0) {
        throw new Error("frames is required (1+ items)");
      }
      if (input.frames.length > 60) {
        throw new Error("max 60 frames per request");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const model = data.model || "claude-sonnet-4-5-20250929";
    const userId = (context as { userId: string }).userId;

    const content = buildAnalyzeContent({
      frames: data.frames,
      productPhoto: data.productPhoto ?? null,
      transcription: data.transcription ?? null,
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: SYS_ANALYZE,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 500)}`);
    }

    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason?: string;
    };

    const text = body.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("");

    const usage = body.usage ?? { input_tokens: 0, output_tokens: 0 };
    const cost = await logUsage({
      userId,
      workspaceId: data.workspaceId ?? null,
      model,
      operation: "claude_analysis",
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      metadata: { frames: data.frames.length, hasProductPhoto: !!data.productPhoto },
    });

    return {
      ok: true,
      text,
      stopReason: body.stop_reason ?? null,
      isTruncated: body.stop_reason === "max_tokens",
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd: cost,
      model,
    };
  });

// ─── GENERATE: SSE stream proxy. Returns a Response with text/event-stream body.
// Client reads with EventSource-style parsing: each chunk is a Server-Sent Event line.
export const anthropicGenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      analysis: string;
      transcription?: string | null;
      variationType: string;
      variationLabel: string;
      productPhoto?: string | null;
      referenceFrames?: FrameInput[];
      model?: string;
      workspaceId?: string | null;
      variationId?: string | null;
    }) => {
      if (!input.analysis || !input.variationType || !input.variationLabel) {
        throw new Error("analysis, variationType and variationLabel are required");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const model = data.model || "claude-sonnet-4-5-20250929";
    const userId = (context as { userId: string }).userId;

    // Build user content: instruct the model with the variation type + analysis
    const content: ContentBlock[] = [];
    content.push({
      type: "text",
      text:
        `Generate the full ad script for variation type: **${data.variationType}** ` +
        `(label: "${data.variationLabel}"). Use the analysis below as the canonical source. ` +
        `Output every scene separated by lines of "▬▬▬▬▬▬▬▬▬▬▬▬▬▬" exactly as defined in your role.`,
    });
    content.push({ type: "text", text: `\n\n=== ANALYSIS ===\n${data.analysis}` });
    if (data.transcription && data.transcription.trim()) {
      content.push({
        type: "text",
        text: `\n\n=== TRANSCRIPTION ===\n${data.transcription.trim()}`,
      });
    }
    if (data.productPhoto) {
      const { mediaType, b64 } = dataUrlToBase64(data.productPhoto);
      content.push({ type: "text", text: "\n\n=== PRODUCT PHOTO ===" });
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
    }
    if (data.referenceFrames && data.referenceFrames.length > 0) {
      content.push({
        type: "text",
        text: `\n\n=== REFERENCE FRAMES (${data.referenceFrames.length}) ===`,
      });
      for (const f of data.referenceFrames) {
        const { mediaType, b64 } = dataUrlToBase64(f.dataUrl);
        content.push({ type: "text", text: `\nframe @ ${f.time.toFixed(1)}s:` });
        content.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: b64 },
        });
      }
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        stream: true,
        system: SYS_GENERATE,
        messages: [{ role: "user", content }],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      throw new Error(`Anthropic ${upstream.status}: ${errText.slice(0, 500)}`);
    }

    setResponseHeaders(
      new Headers({
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
      }),
    );

    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buf = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            // Parse SSE lines: "event: X\ndata: {...}\n\n"
            let idx;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
              if (!dataLine) continue;
              const payload = dataLine.slice(6).trim();
              if (!payload) continue;
              try {
                const evt = JSON.parse(payload) as {
                  type: string;
                  delta?: { type?: string; text?: string; stop_reason?: string };
                  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
                  usage?: { input_tokens?: number; output_tokens?: number };
                };
                if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                  const t = evt.delta.text ?? "";
                  fullText += t;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "text", text: t })}\n\n`),
                  );
                } else if (evt.type === "message_start") {
                  inputTokens = evt.message?.usage?.input_tokens ?? inputTokens;
                } else if (evt.type === "message_delta") {
                  if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                  if (evt.usage?.output_tokens) outputTokens = evt.usage.output_tokens;
                  if (evt.usage?.input_tokens) inputTokens = evt.usage.input_tokens;
                }
              } catch {
                /* ignore malformed event */
              }
            }
          }

          // Log usage (after stream completes)
          const cost = await logUsage({
            userId,
            workspaceId: data.workspaceId ?? null,
            model,
            operation: "claude_variation",
            inputTokens,
            outputTokens,
            metadata: {
              variationType: data.variationType,
              variationLabel: data.variationLabel,
              variationId: data.variationId ?? null,
              isTruncated: stopReason === "max_tokens",
            },
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                fullText,
                inputTokens,
                outputTokens,
                costUsd: cost,
                stopReason,
                isTruncated: stopReason === "max_tokens",
                model,
              })}\n\n`,
            ),
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                error: err instanceof Error ? err.message : String(err),
              })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
      },
    });
  });
