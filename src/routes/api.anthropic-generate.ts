import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_GENERATE } from "@/lib/system-prompts";
import { dataUrlToBase64, calcCost, logUsage } from "@/utils/anthropic.functions";
import type { Database } from "@/integrations/supabase/types";

type FrameInput = { time: number; dataUrl: string };
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export const Route = createFileRoute("/api/anthropic-generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });

        // Auth
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = authHeader.slice(7);
        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false } },
        );
        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub;

        const body = (await request.json()) as {
          analysis: string;
          transcription?: string | null;
          variationType: string;
          variationLabel: string;
          productPhoto?: string | null;
          referenceFrames?: FrameInput[];
          model?: string;
          workspaceId?: string | null;
          variationId?: string | null;
        };
        if (!body.analysis || !body.variationType || !body.variationLabel) {
          return new Response("Missing fields", { status: 400 });
        }

        const model = body.model || "claude-sonnet-4-5-20250929";
        const content: ContentBlock[] = [];
        content.push({
          type: "text",
          text:
            `Generate the full ad script for variation type: **${body.variationType}** ` +
            `(label: "${body.variationLabel}"). Use the analysis below as the canonical source. ` +
            `Output every scene separated by lines of "▬▬▬▬▬▬▬▬▬▬▬▬▬▬" exactly as defined in your role.`,
        });
        content.push({ type: "text", text: `\n\n=== ANALYSIS ===\n${body.analysis}` });
        if (body.transcription?.trim()) {
          content.push({ type: "text", text: `\n\n=== TRANSCRIPTION ===\n${body.transcription.trim()}` });
        }
        if (body.productPhoto) {
          const { mediaType, b64 } = dataUrlToBase64(body.productPhoto);
          content.push({ type: "text", text: "\n\n=== PRODUCT PHOTO ===" });
          content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
        }
        if (body.referenceFrames?.length) {
          content.push({ type: "text", text: `\n\n=== REFERENCE FRAMES (${body.referenceFrames.length}) ===` });
          for (const f of body.referenceFrames) {
            const { mediaType, b64 } = dataUrlToBase64(f.dataUrl);
            content.push({ type: "text", text: `\nframe @ ${f.time.toFixed(1)}s:` });
            content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
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
            model, max_tokens: 8192, stream: true,
            system: SYS_GENERATE,
            messages: [{ role: "user", content }],
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text();
          return new Response(`Anthropic ${upstream.status}: ${errText.slice(0, 500)}`, { status: 502 });
        }

        let fullText = "", inputTokens = 0, outputTokens = 0;
        let stopReason: string | null = null;
        const dec = new TextDecoder();
        const enc = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstream.body!.getReader();
            let buf = "";
            try {
              for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                let idx;
                while ((idx = buf.indexOf("\n\n")) !== -1) {
                  const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
                  const dl = chunk.split("\n").find((l) => l.startsWith("data: "));
                  if (!dl) continue;
                  try {
                    const evt = JSON.parse(dl.slice(6).trim()) as {
                      type: string;
                      delta?: { type?: string; text?: string; stop_reason?: string };
                      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
                      usage?: { input_tokens?: number; output_tokens?: number };
                    };
                    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                      const t = evt.delta.text ?? "";
                      fullText += t;
                      controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "text", text: t })}\n\n`));
                    } else if (evt.type === "message_start") {
                      inputTokens = evt.message?.usage?.input_tokens ?? inputTokens;
                    } else if (evt.type === "message_delta") {
                      if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                      if (evt.usage?.output_tokens) outputTokens = evt.usage.output_tokens;
                      if (evt.usage?.input_tokens) inputTokens = evt.usage.input_tokens;
                    }
                  } catch { /* skip */ }
                }
              }
              const cost = await logUsage({
                userId,
                workspaceId: body.workspaceId ?? null,
                model, operation: "claude_variation",
                inputTokens, outputTokens,
                metadata: {
                  variationType: body.variationType,
                  variationLabel: body.variationLabel,
                  variationId: body.variationId ?? null,
                  isTruncated: stopReason === "max_tokens",
                },
              });
              controller.enqueue(enc.encode(`data: ${JSON.stringify({
                type: "done", fullText, inputTokens, outputTokens,
                costUsd: cost, stopReason, isTruncated: stopReason === "max_tokens", model,
              })}\n\n`));
            } catch (err) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify({
                type: "error", error: err instanceof Error ? err.message : String(err),
              })}\n\n`));
              // Best-effort partial usage log
              if (inputTokens || outputTokens) {
                await logUsage({
                  userId, workspaceId: body.workspaceId ?? null, model,
                  operation: "claude_variation_partial",
                  inputTokens, outputTokens,
                  metadata: { variationType: body.variationType, partial: true },
                }).catch(() => {});
              }
              void calcCost; // keep import used
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
      },
    },
  },
});
