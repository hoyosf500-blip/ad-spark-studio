import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_ANALYZE } from "@/lib/system-prompts";
import { dataUrlToOpenAIImage, logUsage } from "@/utils/openrouter.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type FrameInput = { time: number; dataUrl: string };

// OpenAI message content parts (with optional Anthropic cache_control passed
// through transparently by OpenRouter for Anthropic models).
type CacheControl = { type: "ephemeral" };
type ContentPart =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" }; cache_control?: CacheControl };

type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export const Route = createFileRoute("/api/analyze-frames")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) return new Response("OPENROUTER_API_KEY not configured", { status: 500 });

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

        const model = body.model || "anthropic/claude-sonnet-4.5";

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
          content.push(dataUrlToOpenAIImage(f.dataUrl));
        }
        if (body.productPhoto) {
          content.push({ type: "text", text: "\n\nFOTO DEL PRODUCTO (referencia adicional, no es un frame del video):" });
          content.push(dataUrlToOpenAIImage(body.productPhoto));
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

        const maxTokens = Math.min(16000, Math.max(4000, body.frames.length * 250 + 1000));
        const MAX_CONTINUATIONS = 1;

        let fullText = "", inputTokens = 0, outputTokens = 0;
        let cacheCreateTokens = 0, cacheReadTokens = 0;
        let stopReason: string | null = null;
        let failed = false;
        const dec = new TextDecoder();
        const enc = new TextEncoder();

        const messages: OpenAIMessage[] = [];

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
                const upstreamMessages: OpenAIMessage[] = [
                  { role: "system", content: SYS_ANALYZE },
                ];
                if (attempt === 0) {
                  upstreamMessages.push({ role: "user", content });
                } else {
                  upstreamMessages.push(...messages);
                  upstreamMessages.push({
                    role: "user",
                    content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el mismo formato y termina con la sección final de transcripción consolidada.",
                  });
                }

                const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${apiKey}`,
                    "HTTP-Referer": "https://adsparkstudio.com",
                    "X-Title": "Ad Spark Studio",
                  },
                  body: JSON.stringify({
                    model,
                    max_completion_tokens: maxTokens,
                    stream: true,
                    temperature: 0.4,
                    messages: upstreamMessages,
                  }),
                });
                if (!upstream.ok || !upstream.body) {
                  const errText = await upstream.text().catch(() => "");
                  controller.enqueue(enc.encode(`data: ${JSON.stringify({
                    type: "error", error: `OpenRouter ${upstream.status}: ${errText.slice(0, 300)}`,
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
                let attemptFinishReason: string | null = null;

                for (;;) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  buf += dec.decode(value, { stream: true });
                  let idx;
                  while ((idx = buf.indexOf("\n\n")) !== -1) {
                    const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
                    const dl = chunk.split("\n").find((l) => l.startsWith("data: "));
                    if (!dl) continue;
                    const payload = dl.slice(6).trim();
                    if (payload === "[DONE]") continue;
                    try {
                      const evt = JSON.parse(payload) as {
                        choices?: Array<{
                          delta?: { content?: string };
                          finish_reason?: string | null;
                        }>;
                        usage?: {
                          prompt_tokens?: number;
                          completion_tokens?: number;
                          cache_creation_input_tokens?: number;
                          cache_read_input_tokens?: number;
                          prompt_tokens_details?: {
                            cached_tokens?: number;
                            cache_creation_tokens?: number;
                            cache_read_tokens?: number;
                          };
                        };
                      };
                      const deltaText = evt.choices?.[0]?.delta?.content;
                      if (typeof deltaText === "string") {
                        attemptText += deltaText;
                        fullText += deltaText;
                        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "text", text: deltaText })}
\n`));
                      }
                      const finish = evt.choices?.[0]?.finish_reason;
                      if (finish) attemptFinishReason = finish;
                      if (evt.usage?.prompt_tokens) attemptIn = evt.usage.prompt_tokens;
                      if (evt.usage?.completion_tokens) attemptOut = evt.usage.completion_tokens;
                      const cc = evt.usage?.cache_creation_input_tokens
                        ?? evt.usage?.prompt_tokens_details?.cache_creation_tokens;
                      const cr = evt.usage?.cache_read_input_tokens
                        ?? evt.usage?.prompt_tokens_details?.cache_read_tokens
                        ?? evt.usage?.prompt_tokens_details?.cached_tokens;
                      if (typeof cc === "number") attemptCacheCreate = cc;
                      if (typeof cr === "number") attemptCacheRead = cr;
                    } catch { /* skip malformed */ }
                  }
                }
                inputTokens += attemptIn;
                outputTokens += attemptOut;
                cacheCreateTokens += attemptCacheCreate;
                cacheReadTokens += attemptCacheRead;
                stopReason = attemptFinishReason;

                if (attemptFinishReason !== "length" || attempt >= MAX_CONTINUATIONS || !attemptText) break;
                messages.push({ role: "assistant", content: attemptText });
                messages.push({
                  role: "user",
                  content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el mismo formato y termina con la sección de transcripción consolidada.",
                });
              }

              let cost = 0;
              try {
                cost = await logUsage({
                  userId,
                  workspaceId: body.workspaceId ?? null,
                  model,
                  operation: failed ? "openrouter_analysis_partial" : "openrouter_analysis",
                  inputTokens,
                  outputTokens,
                  cacheCreateTokens,
                  cacheReadTokens,
                  reservedUsd,
                  metadata: {
                    frames: body.frames.length,
                    hasProductPhoto: !!body.productPhoto,
                    isTruncated: stopReason === "length",
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
                  costUsd: cost, stopReason, isTruncated: stopReason === "length", model,
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
