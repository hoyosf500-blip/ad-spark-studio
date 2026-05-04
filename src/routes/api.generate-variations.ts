import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_GENERATE } from "@/lib/system-prompts";
import { SCENE_FORMAT } from "@/lib/scene-format";
import { HOOK_PLAYBOOKS } from "@/lib/variation-defs";
import { WINNING_PREAMBLE, checkScript } from "@/lib/winning-framework";
import { dataUrlToAnthropicImage, logUsage } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type FrameInput = { time: number; dataUrl: string };

// Anthropic native content block types. Cache_control on the LAST part of the
// shared prefix marks everything before it as cacheable (5 min TTL ephemeral).
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

export const Route = createFileRoute("/api/generate-variations")({
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

        // Default Haiku 4.5 — la app produce prompts paste-ready para Higgsfield,
        // no contenido final que se publique tal cual. Haiku basta para los 6
        // scripts de variaciones; el usuario refina/regenera en Higgsfield.
        // Override a Sonnet desde body.model si se necesita prosa más pulida.
        const model = body.model || "claude-haiku-4-5";
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
          sharedContent.push(dataUrlToAnthropicImage(body.productPhoto));
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
            sharedContent.push(dataUrlToAnthropicImage(f.dataUrl));
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

        // Sonnet 4.5 soporta hasta 64k output sin penalización (solo se paga por
        // tokens generados). avg_output ~24k, p95 ~51k → 32k cap evita continuations
        // en el caso normal pero MAX_CONTINUATIONS=1 queda como red de seguridad.
        const MAX_TOKENS = 32000;
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
                    content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el formato ═══ y completa todas las secciones pendientes (escenas restantes, AVATAR, HOOKS EXTRA, EFFECTS DENSITY MAP, ENERGY ARC, TIMELINE CAPCUT, RECOMMENDATION).",
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
                    max_tokens: MAX_TOKENS,
                    stream: true,
                    temperature: 0.5,
                    system: SYS_GENERATE,
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
                    } catch { /* skip */ }
                  }
                }
                inputTokens += attemptIn;
                outputTokens += attemptOut;
                cacheCreateTokens += attemptCacheCreate;
                cacheReadTokens += attemptCacheRead;
                stopReason = attemptStopReason;

                if (attemptStopReason !== "max_tokens" || attempt >= MAX_CONTINUATIONS || !attemptText) break;
                messages.push({ role: "assistant", content: attemptText });
                messages.push({
                  role: "user",
                  content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el formato ═══ y completa todas las secciones pendientes (escenas restantes, AVATAR, HOOKS EXTRA, EFFECTS DENSITY MAP, ENERGY ARC, TIMELINE CAPCUT, RECOMMENDATION).",
                });
              }

              const isTruncated = stopReason === "max_tokens";
              const validation = isClone ? null : checkScript(fullText);

              const cost = await logUsage({
                userId,
                workspaceId: body.workspaceId ?? null,
                model,
                operation: "anthropic_variation",
                inputTokens,
                outputTokens,
                cacheCreateTokens,
                cacheReadTokens,
                reservedUsd,
                metadata: {
                  variationType: body.variationType,
                  variationLabel: body.variationLabel,
                  variationId: body.variationId ?? null,
                  isTruncated,
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
                  costUsd: cost, stopReason, isTruncated, model,
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
                  operation: "anthropic_variation_partial",
                  inputTokens, outputTokens,
                  cacheCreateTokens, cacheReadTokens,
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
