import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_GENERATE } from "@/lib/system-prompts";
import { SCENE_FORMAT } from "@/lib/scene-format";
import { HOOK_PLAYBOOKS } from "@/lib/variation-defs";
import { WINNING_PREAMBLE, checkScript } from "@/lib/winning-framework";
import { dataUrlToBase64, logUsage } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type FrameInput = { time: number; dataUrl: string };
type CacheControl = { type: "ephemeral" };
type ContentBlock =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
      cache_control?: CacheControl;
    };

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
        // Pass user JWT so checkSpendingCap can read profiles under RLS as the
        // calling user (otherwise daily_cap_usd silently defaults to $20).
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

        const cap = await checkSpendingCap(supabase, userId, "api.anthropic-generate");
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

        // Default aligned with the UI dropdown (Sonnet 4.6). Previously this
        // fell back to "claude-sonnet-4-5-20250929" while priceFor() and the UI
        // selector both use "claude-sonnet-4-6", causing cost-tracking
        // mismatches when the client omitted `model` from the body.
        const model = body.model || "claude-sonnet-4-6";
        const isClone = body.variationType === "clon";

        // === SHARED PREFIX ===
        // This block is IDENTICAL across the 6 variation calls for the same video.
        // We mark the LAST shared block with cache_control: ephemeral so Anthropic
        // caches everything up to (and including) that point. The first variation
        // pays cache_creation cost (1.25x input price); the next 5 pay cache_read
        // (0.10x input price) instead of full price. With ~150k tokens of frames+
        // analysis shared, this drops per-project input cost by ~65%.
        // Cache lifetime: 5 min (Anthropic ephemeral TTL) — fits comfortably inside
        // a typical multi-variation generation run.
        const sharedContent: ContentBlock[] = [];
        sharedContent.push({
          type: "text",
          text: `=== SCENE FORMAT (MANDATORY) ===\n${SCENE_FORMAT}`,
        });
        sharedContent.push({
          type: "text",
          text: `\n\n=== ANALYSIS ===\n${body.analysis}`,
        });
        if (body.transcription?.trim()) {
          // Label kept neutral so the prefix matches across clon and non-clon
          // variations (the per-variation directive is set in the suffix below).
          sharedContent.push({
            type: "text",
            text: `\n\n=== TRANSCRIPTION (raw) ===\n${body.transcription.trim()}`,
          });
        }
        if (body.productPhoto) {
          const { mediaType, b64 } = dataUrlToBase64(body.productPhoto);
          sharedContent.push({ type: "text", text: "\n\n=== PRODUCT PHOTO ===" });
          sharedContent.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: b64 },
          });
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
            const { mediaType, b64 } = dataUrlToBase64(f.dataUrl);
            sharedContent.push({ type: "text", text: `\nframe @ ${f.time.toFixed(1)}s:` });
            sharedContent.push({
              type: "image",
              source: { type: "base64", media_type: mediaType, data: b64 },
            });
          }
        }
        // Mark the END of the shared prefix as the cache breakpoint.
        if (sharedContent.length > 0) {
          const last = sharedContent[sharedContent.length - 1];
          last.cache_control = { type: "ephemeral" };
        }

        // === VARIATION-SPECIFIC SUFFIX ===
        // This part differs per variation (header + playbook + creative brief)
        // so it lives after the cache breakpoint and is paid full price each call.
        const variationContent: ContentBlock[] = [];
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

        const content: ContentBlock[] = [...sharedContent, ...variationContent];

        // Cap output to avoid the 60k-token runaway observed in prod
        // ($1.17 / 20-min variation). Worst case now: 32k output × $15/M = $0.48.
        const MAX_TOKENS = 16000;
        const MAX_CONTINUATIONS = 1;

        let fullText = "", inputTokens = 0, outputTokens = 0;
        let cacheCreateTokens = 0, cacheReadTokens = 0;
        let stopReason: string | null = null;
        // When upstream Anthropic rejects (429/5xx) we emit a single `error`
        // event and must NOT also emit `done` — otherwise the client races and
        // the empty `done` overwrites the error (symptom: "done $0.0000 sin
        // escenas parseadas").
        let failed = false;
        const dec = new TextDecoder();
        const enc = new TextEncoder();

        type Msg = { role: "user" | "assistant"; content: ContentBlock[] | string };
        const messages: Msg[] = [{ role: "user", content }];

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
                const upstream = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify({
                    model, max_tokens: MAX_TOKENS, stream: true,
                    // Cache the system prompt + the shared user prefix (analysis,
                    // frames, product info — last block carries cache_control above).
                    // First variation pays cache write (1.25x); next 5 read at 0.10x.
                    system: [
                      {
                        type: "text",
                        text: SYS_GENERATE,
                        cache_control: { type: "ephemeral" },
                      },
                    ],
                    messages,
                  }),
                });
                if (!upstream.ok || !upstream.body) {
                  const errText = await upstream.text().catch(() => "");
                  controller.enqueue(enc.encode(`data: ${JSON.stringify({
                    type: "error", error: `Anthropic ${upstream.status}: ${errText.slice(0, 300)}`,
                  })}\n\n`));
                  failed = true;
                  break;
                }

                const reader = upstream.body.getReader();
                let buf = "";
                let attemptText = "";
                let attemptStop: string | null = null;
                let attemptIn = 0, attemptOut = 0;
                let attemptCacheCreate = 0, attemptCacheRead = 0;
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
                        message?: {
                          usage?: {
                            input_tokens?: number;
                            output_tokens?: number;
                            cache_creation_input_tokens?: number;
                            cache_read_input_tokens?: number;
                          };
                        };
                        usage?: { input_tokens?: number; output_tokens?: number };
                      };
                      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                        const t = evt.delta.text ?? "";
                        attemptText += t;
                        fullText += t;
                        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "text", text: t })}\n\n`));
                      } else if (evt.type === "message_start") {
                        attemptIn = evt.message?.usage?.input_tokens ?? attemptIn;
                        attemptCacheCreate =
                          evt.message?.usage?.cache_creation_input_tokens ?? attemptCacheCreate;
                        attemptCacheRead =
                          evt.message?.usage?.cache_read_input_tokens ?? attemptCacheRead;
                      } else if (evt.type === "message_delta") {
                        if (evt.delta?.stop_reason) attemptStop = evt.delta.stop_reason;
                        if (evt.usage?.output_tokens) attemptOut = evt.usage.output_tokens;
                        if (evt.usage?.input_tokens) attemptIn = evt.usage.input_tokens;
                      }
                    } catch { /* skip */ }
                  }
                }
                inputTokens += attemptIn;
                outputTokens += attemptOut;
                cacheCreateTokens += attemptCacheCreate;
                cacheReadTokens += attemptCacheRead;
                stopReason = attemptStop;

                if (attemptStop !== "max_tokens" || attempt >= MAX_CONTINUATIONS || !attemptText) break;
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
                model, operation: "claude_variation",
                inputTokens, outputTokens,
                cacheCreateTokens, cacheReadTokens,
                reservedUsd,
                metadata: {
                  variationType: body.variationType,
                  variationLabel: body.variationLabel,
                  variationId: body.variationId ?? null,
                  isTruncated: stopReason === "max_tokens",
                  maxTokens: MAX_TOKENS,
                  validationPass: validation?.pass ?? null,
                  validationViolations: validation?.violations ?? null,
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

              // Don't emit `done` after an error — the client would race with
              // the already-queued error event and overwrite the failure state
              // with empty content. The error event alone is the terminal
              // signal in that case.
              if (!failed) {
                controller.enqueue(enc.encode(`data: ${JSON.stringify({
                  type: "done", fullText, inputTokens, outputTokens,
                  costUsd: cost, stopReason, isTruncated: stopReason === "max_tokens", model,
                  validation,
                })}\n\n`));
              }
            } catch (err) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify({
                type: "error", error: err instanceof Error ? err.message : String(err),
              })}\n\n`));
              if (inputTokens || outputTokens) {
                await logUsage({
                  userId, workspaceId: body.workspaceId ?? null, model,
                  operation: "claude_variation_partial",
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
