import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_GENERATE } from "@/lib/system-prompts";
import { SCENE_FORMAT } from "@/lib/scene-format";
import { HOOK_PLAYBOOKS } from "@/lib/variation-defs";
import { WINNING_PREAMBLE, checkScript } from "@/lib/winning-framework";
import { dataUrlToOpenAIImage, logUsage } from "@/utils/openrouter.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type FrameInput = { time: number; dataUrl: string };

// Anthropic prompt caching via OpenRouter: pass `cache_control: { type: "ephemeral" }`
// on the LAST part of the cacheable prefix. Anthropic caches everything up to and
// including that part. OpenRouter passes the field through transparently for
// Anthropic models since late 2025.
type CacheControl = { type: "ephemeral" };
type ContentPart =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" }; cache_control?: CacheControl };

type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export const Route = createFileRoute("/api/generate-variations")({
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

        const cap = await checkSpendingCap(supabase, userId, "api.generate-variations");
        if (!cap.ok) return capExceededResponse(cap);
        const reservedUsd = cap.reservedUsd;

        const body = (await request.json()) as {
          analysis: string;
          transcription?: string | null;
          variationType: string;
          variationLabel: string;
          productPhoto?: string | null;
          productInfo?: string | null;
          creativeBrief?: string | null;
          referenceFrames?: FrameInput[];
          model?: string;
          workspaceId?: string | null;
          variationId?: string | null;
        };
        if (!body.analysis || !body.variationType || !body.variationLabel) {
          return new Response("Missing fields", { status: 400 });
        }

        const model = body.model || "anthropic/claude-sonnet-4.5";
        const isClone = body.variationType === "clon";

        // === SHARED PREFIX ===
        const sharedContent: ContentPart[] = [];
        sharedContent.push({
          type: "text",
          text: `=== SCENE FORMAT (MANDATORY) ===\n${SCENE_FORMAT}`,
        });
        sharedContent.push({
          type: "text",
          text: `\n\n=== ANALYSIS ===\n${body.analysis}`,
        });
        if (body.transcription?.trim()) {
          sharedContent.push({
            type: "text",
            text: `\n\n=== TRANSCRIPTION (raw) ===\n${body.transcription.trim()}`,
          });
        }
        if (body.productPhoto) {
          sharedContent.push({ type: "text", text: "\n\n=== PRODUCT PHOTO ===" });
          sharedContent.push(dataUrlToOpenAIImage(body.productPhoto));
        }
        if (body.productInfo?.trim()) {
          sharedContent.push({
            type: "text",
            text: `\n\n=== PRODUCT INFO (keep the product name verbatim in SCREEN TEXT and CTA beats; match price + audience when writing the hook) ===\n${body.productInfo.trim()}`,
          });
        }
        if (body.referenceFrames?.length) {
          sharedContent.push({
            type: "text",
            text: `\n\n=== REFERENCE FRAMES (${body.referenceFrames.length}) ===`,
          });
          for (const f of body.referenceFrames) {
            sharedContent.push({ type: "text", text: `\nframe @ ${f.time.toFixed(1)}s:` });
            sharedContent.push(dataUrlToOpenAIImage(f.dataUrl));
          }
        }

        // Mark the LAST part of the shared prefix as the cache breakpoint.
        // Everything pushed above (SCENE FORMAT + ANALYSIS + TRANSCRIPTION +
        // PRODUCT PHOTO + PRODUCT INFO + REFERENCE FRAMES) becomes a cacheable
        // ephemeral block (~5 min TTL). Calls 2-N for the same project hit it
        // as cache_read at 0.10x input price instead of paying full freight.
        if (sharedContent.length > 0) {
          sharedContent[sharedContent.length - 1] = {
            ...sharedContent[sharedContent.length - 1],
            cache_control: { type: "ephemeral" },
          };
        }

        // === VARIATION-SPECIFIC SUFFIX ===
        const variationContent: ContentPart[] = [];
        const transcriptionDirective = body.transcription?.trim()
          ? isClone
            ? " The TRANSCRIPTION above is the CANONICAL voice-over: copy it WORD-FOR-WORD across the SCRIPT fields, Spanish, zero paraphrasing."
            : " The TRANSCRIPTION above is REFERENCE ONLY — do NOT copy verbatim, only reuse it for insight."
          : "";
        const header =
          `\n\nNow generate the full ad script for variation type: **${body.variationType}** ` +
          `(label: "${body.variationLabel}"). Use the analysis above as the canonical source.` +
          (isClone
            ? " CLON: replicate the original structure beat-by-beat."
            : " NOT a clone: create a fresh script inspired by the analysis.") +
          transcriptionDirective;
        variationContent.push({ type: "text", text: header });
        if (!isClone) {
          variationContent.push({ type: "text", text: `\n\n${WINNING_PREAMBLE}` });
        }
        const playbook = HOOK_PLAYBOOKS[body.variationType];
        if (playbook) {
          variationContent.push({ type: "text", text: `\n\n${playbook}` });
        }
        if (body.creativeBrief?.trim()) {
          variationContent.push({
            type: "text",
            text:
              `\n\n=== IDEA CREATIVA DEL USUARIO ===\n` +
              body.creativeBrief.trim() +
              `\n\nCONTRATO (leé esto antes de escribir):\n` +
              `- La IDEA CREATIVA dicta SOLO: tono, setting/locación, emoción del personaje, ritmo, decisiones estéticas.\n` +
              `- La IDEA CREATIVA NO dicta: nombre del producto, componente, dosis, precio, testimonios, claims médicos, datos demográficos específicos.\n` +
              `- Si la IDEA contradice PRODUCT INFO, ANALYSIS o TRANSCRIPTION, prevalecen los datos reales sin excepción.\n` +
              `- Si la IDEA menciona un dato concreto (ej. "el producto cura X", "cuesta Y") y ese dato NO aparece en PRODUCT INFO o ANALYSIS, IGNORALO — no lo metas en el guion.\n` +
              `- Interpretá la IDEA como la voz del cliente diciéndote "así lo veo en mi cabeza", no como fuente de verdad sobre el producto.`,
          });
        }

        const content: ContentPart[] = [...sharedContent, ...variationContent];

        // 2026-05-04: subido de 16000 a 32000. Audit mostró avg_output=24k vs
        // cap 16k → la mayoría disparaba continuation, re-enviando ~16k de
        // assistant message como input NO cacheado (~$0.29/proyecto desperdiciados).
        // Sonnet 4.5 soporta hasta 64k output sin penalización (solo se paga
        // por tokens generados, no por el cap). MAX_CONTINUATIONS=1 se mantiene
        // como red de seguridad para casos extremos (>32k).
        const MAX_TOKENS = 32000;
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
                  { role: "system", content: SYS_GENERATE },
                ];
                if (attempt === 0) {
                  upstreamMessages.push({ role: "user", content });
                } else {
                  upstreamMessages.push(...messages);
                  upstreamMessages.push({
                    role: "user",
                    content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el formato ═══ y completa todas las secciones pendientes (escenas restantes, AVATAR, HOOKS EXTRA, EFFECTS DENSITY MAP, ENERGY ARC, TIMELINE CAPCUT, RECOMMENDATION).",
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
                    max_completion_tokens: MAX_TOKENS,
                    stream: true,
                    temperature: 0.5,
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
                          // OpenRouter sometimes nests Anthropic-specific cache
                          // counters under prompt_tokens_details.
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
                    } catch { /* skip */ }
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
                  content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el formato ═══ y completa todas las secciones pendientes (escenas restantes, AVATAR, HOOKS EXTRA, EFFECTS DENSITY MAP, ENERGY ARC, TIMELINE CAPCUT, RECOMMENDATION).",
                });
              }

              const validation = isClone ? null : checkScript(fullText);

              const cost = await logUsage({
                userId,
                workspaceId: body.workspaceId ?? null,
                model,
                operation: "openrouter_variation",
                inputTokens,
                outputTokens,
                cacheCreateTokens,
                cacheReadTokens,
                reservedUsd,
                metadata: {
                  variationType: body.variationType,
                  variationLabel: body.variationLabel,
                  variationId: body.variationId ?? null,
                  isTruncated: stopReason === "length",
                  maxTokens: MAX_TOKENS,
                  validationPass: validation?.pass ?? null,
                  validationViolations: validation?.violations ?? null,
                  cacheCreateTokens,
                  cacheReadTokens,
                },
              });

              if (validation && body.variationId) {
                try {
                  await supabase
                    .from("variations")
                    .update({ validation } as never)
                    .eq("id", body.variationId);
                } catch { /* non-fatal */ }
              }

              if (!failed) {
                controller.enqueue(enc.encode(`data: ${JSON.stringify({
                  type: "done", fullText, inputTokens, outputTokens,
                  cacheCreateTokens, cacheReadTokens,
                  costUsd: cost, stopReason, isTruncated: stopReason === "length", model,
                  validation,
                })}
\n`));
              }
            } catch (err) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify({
                type: "error", error: err instanceof Error ? err.message : String(err),
              })}
\n`));
              if (inputTokens || outputTokens) {
                await logUsage({
                  userId, workspaceId: body.workspaceId ?? null, model,
                  operation: "openrouter_variation_partial",
                  inputTokens, outputTokens,
                  reservedUsd,
                  metadata: { variationType: body.variationType, partial: true },
                }).catch(() => {});
              }
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
