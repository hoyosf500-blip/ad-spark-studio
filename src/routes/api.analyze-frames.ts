import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_ANALYZE } from "@/lib/system-prompts";
import { dataUrlToAnthropicImage, logUsage } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type FrameInput = { time: number; dataUrl: string };

// Anthropic native content block types.
type CacheControl = { type: "ephemeral" };
type ContentPart =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
      cache_control?: CacheControl;
    };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | ContentPart[];
};

export const Route = createFileRoute("/api/analyze-frames")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = authHeader.slice(7);
        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub;

        const cap = await checkSpendingCap(supabase, userId, "api.analyze-frames");
        if (!cap.ok) return capExceededResponse(cap);
        const reservedUsd = cap.reservedUsd;

        const body = (await request.json()) as {
          frames: FrameInput[];
          productPhoto?: string | null;
          transcription?: string | null;
          productInfo?: string | null;
          model?: string;
          workspaceId?: string | null;
        };
        if (!Array.isArray(body.frames) || body.frames.length === 0) {
          return new Response("frames required", { status: 400 });
        }
        if (body.frames.length > 60) {
          return new Response("max 60 frames", { status: 400 });
        }

        const model = body.model || "claude-sonnet-4-5";

        const content: ContentPart[] = [];
        content.push({
          type: "text",
          text: `Analiza este video frame por frame. Recibes ${body.frames.length} frames extraídos.`,
        });
        for (const f of body.frames) {
          content.push({
            type: "text",
            text: `\nFRAME ${Math.round(f.time)}s (timestamp ${f.time.toFixed(2)}s):`,
          });
          content.push(dataUrlToAnthropicImage(f.dataUrl));
        }
        if (body.productPhoto) {
          content.push({ type: "text", text: "\n\nFOTO DEL PRODUCTO (referencia adicional, no es un frame del video):" });
          content.push(dataUrlToAnthropicImage(body.productPhoto));
        }
        if (body.productInfo?.trim()) {
          content.push({
            type: "text",
            text: `\n\nDATOS DEL PRODUCTO (úsalos para entender qué se anuncia, el precio, el público y el beneficio clave):\n${body.productInfo.trim()}`,
          });
        }
        if (body.transcription?.trim()) {
          content.push({
            type: "text",
            text: `\n\nTRANSCRIPCIÓN PROVISTA POR EL USUARIO (úsala como verdad, completa con tu lectura de frames):\n${body.transcription.trim()}`,
          });
        }
        content.push({
          type: "text",
          text: "\n\nProduce el análisis completo siguiendo EXACTAMENTE el formato definido en tu role. No omitas frames. Termina con la sección final de transcripción consolidada.",
          // Cache breakpoint at the END of the content array. Re-runs of the
          // analyze step on the same video (e.g. user edits productInfo and
          // re-runs) hit the cached frames at 0.10x input price.
          cache_control: { type: "ephemeral" },
        });

        // Fórmula relajada para evitar continuations: con 60 frames da 26000,
        // holgura suficiente respecto al cap 32000.
        const maxTokens = Math.min(32000, Math.max(4000, body.frames.length * 400 + 2000));
        const MAX_CONTINUATIONS = 1;

        let fullText = "", inputTokens = 0, outputTokens = 0;
        let cacheCreateTokens = 0, cacheReadTokens = 0;
        let stopReason: string | null = null;
        let failed = false;
        const dec = new TextDecoder();
        const enc = new TextEncoder();

        const messages: AnthropicMessage[] = [];

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
                const upstreamMessages: AnthropicMessage[] = [];
                if (attempt === 0) {
                  upstreamMessages.push({ role: "user", content });
                } else {
                  upstreamMessages.push(...messages);
                  upstreamMessages.push({
                    role: "user",
                    content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el mismo formato y termina con la sección final de transcripción consolidada.",
                  });
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
                    max_tokens: maxTokens,
                    stream: true,
                    temperature: 0.4,
                    // System con cache_control nativo: garantiza el hit explícito
                    // sobre SYS_ANALYZE (~3.5KB) aunque el user prefix cambie en
                    // re-runs. Cubre uno de los 4 breakpoints permitidos por Anthropic;
                    // el segundo está en el último ContentPart del user content.
                    system: [
                      { type: "text", text: SYS_ANALYZE, cache_control: { type: "ephemeral" } },
                    ],
                    messages: upstreamMessages,
                  }),
                });
                if (!upstream.ok || !upstream.body) {
                  const errText = await upstream.text().catch(() => "");
                  controller.enqueue(enc.encode(`data: ${JSON.stringify({
                    type: "error", error: `Anthropic ${upstream.status}: ${errText.slice(0, 300)}`,
                  })}
\n`));
                  failed = true;
                  break;
                }

                const reader = upstream.body.getReader();
                let buf = "";
                let attemptText = "";
                let attemptIn = 0, attemptOut = 0;
                let attemptCacheCreate = 0, attemptCacheRead = 0;
                let attemptStopReason: string | null = null;

                for (;;) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  buf += dec.decode(value, { stream: true });
                  let idx;
                  while ((idx = buf.indexOf("\n\n")) !== -1) {
                    const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
                    // Anthropic SSE chunks tienen `event: <type>\ndata: <json>`.
                    // Solo nos importa la línea data: — el event redundante con type interno.
                    const dl = chunk.split("\n").find((l) => l.startsWith("data: "));
                    if (!dl) continue;
                    const payload = dl.slice(6).trim();
                    if (!payload) continue;
                    try {
                      const evt = JSON.parse(payload) as {
                        type?: string;
                        message?: {
                          usage?: {
                            input_tokens?: number;
                            output_tokens?: number;
                            cache_creation_input_tokens?: number;
                            cache_read_input_tokens?: number;
                          };
                        };
                        delta?: {
                          type?: string;
                          text?: string;
                          stop_reason?: string;
                        };
                        usage?: { output_tokens?: number };
                      };
                      if (evt.type === "message_start" && evt.message?.usage) {
                        attemptIn = evt.message.usage.input_tokens ?? 0;
                        attemptCacheCreate = evt.message.usage.cache_creation_input_tokens ?? 0;
                        attemptCacheRead = evt.message.usage.cache_read_input_tokens ?? 0;
                      } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                        const t = evt.delta.text;
                        if (typeof t === "string" && t.length) {
                          attemptText += t;
                          fullText += t;
                          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "text", text: t })}
\n`));
                        }
                      } else if (evt.type === "message_delta") {
                        if (evt.delta?.stop_reason) attemptStopReason = evt.delta.stop_reason;
                        if (typeof evt.usage?.output_tokens === "number") {
                          attemptOut = evt.usage.output_tokens;
                        }
                      }
                    } catch { /* skip malformed */ }
                  }
                }
                inputTokens += attemptIn;
                outputTokens += attemptOut;
                cacheCreateTokens += attemptCacheCreate;
                cacheReadTokens += attemptCacheRead;
                stopReason = attemptStopReason;

                // Anthropic: stop_reason === "max_tokens" equivale a "length" de OpenAI.
                if (attemptStopReason !== "max_tokens" || attempt >= MAX_CONTINUATIONS || !attemptText) break;
                messages.push({ role: "assistant", content: attemptText });
                messages.push({
                  role: "user",
                  content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el mismo formato y termina con la sección de transcripción consolidada.",
                });
              }

              const isTruncated = stopReason === "max_tokens";
              let cost = 0;
              try {
                cost = await logUsage({
                  userId,
                  workspaceId: body.workspaceId ?? null,
                  model,
                  operation: failed ? "anthropic_analysis_partial" : "anthropic_analysis",
                  inputTokens,
                  outputTokens,
                  cacheCreateTokens,
                  cacheReadTokens,
                  reservedUsd,
                  metadata: {
                    frames: body.frames.length,
                    hasProductPhoto: !!body.productPhoto,
                    isTruncated,
                    maxTokens,
                    failed,
                    cacheCreateTokens,
                    cacheReadTokens,
                  },
                });
              } catch (logErr) {
                console.error("[analyze-frames] logUsage failed:", logErr);
              }
              if (!failed) {
                controller.enqueue(enc.encode(`data: ${JSON.stringify({
                  type: "done", fullText, inputTokens, outputTokens,
                  cacheCreateTokens, cacheReadTokens,
                  costUsd: cost, stopReason, isTruncated, model,
                })}
\n`));
              }
            } catch (err) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify({
                type: "error", error: err instanceof Error ? err.message : String(err),
              })}
\n`));
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
