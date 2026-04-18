import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_GENERATE } from "@/lib/system-prompts";
import { SCENE_FORMAT } from "@/lib/scene-format";
import { HOOK_PLAYBOOKS } from "@/lib/variation-defs";
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
          productInfo?: string | null;
          referenceFrames?: FrameInput[];
          model?: string;
          workspaceId?: string | null;
          variationId?: string | null;
        };
        if (!body.analysis || !body.variationType || !body.variationLabel) {
          return new Response("Missing fields", { status: 400 });
        }

        const model = body.model || "claude-sonnet-4-5-20250929";
        const isClone = body.variationType === "clon";
        const content: ContentBlock[] = [];
        const header =
          `Generate the full ad script for variation type: **${body.variationType}** ` +
          `(label: "${body.variationLabel}"). Use the analysis below as the canonical source.` +
          (isClone
            ? " CLON: replicate the original structure beat-by-beat and keep the transcription WORD-FOR-WORD in the SCRIPT sections (Spanish, zero paraphrasing)."
            : " NOT a clone: create a fresh script inspired by the analysis — do NOT copy the original transcription verbatim, only reuse it for insight.");
        content.push({ type: "text", text: header });
        const playbook = HOOK_PLAYBOOKS[body.variationType];
        if (playbook) {
          content.push({ type: "text", text: `\n\n${playbook}` });
        }
        content.push({ type: "text", text: `\n\n=== SCENE FORMAT (MANDATORY) ===\n${SCENE_FORMAT}` });
        content.push({ type: "text", text: `\n\n=== ANALYSIS ===\n${body.analysis}` });
        if (body.transcription?.trim()) {
          content.push({
            type: "text",
            text: isClone
              ? `\n\n=== TRANSCRIPTION (use WORD-FOR-WORD across the SCRIPT fields) ===\n${body.transcription.trim()}`
              : `\n\n=== TRANSCRIPTION (reference only — do NOT copy verbatim) ===\n${body.transcription.trim()}`,
          });
        }
        if (body.productPhoto) {
          const { mediaType, b64 } = dataUrlToBase64(body.productPhoto);
          content.push({ type: "text", text: "\n\n=== PRODUCT PHOTO ===" });
          content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
        }
        if (body.productInfo?.trim()) {
          content.push({
            type: "text",
            text: `\n\n=== PRODUCT INFO (keep the product name verbatim in SCREEN TEXT and CTA beats; match price + audience when writing the hook) ===\n${body.productInfo.trim()}`,
          });
        }
        if (body.referenceFrames?.length) {
          content.push({ type: "text", text: `\n\n=== REFERENCE FRAMES (${body.referenceFrames.length}) ===` });
          for (const f of body.referenceFrames) {
            const { mediaType, b64 } = dataUrlToBase64(f.dataUrl);
            content.push({ type: "text", text: `\nframe @ ${f.time.toFixed(1)}s:` });
            content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
          }
        }

        const MAX_TOKENS = 32000;
        const MAX_CONTINUATIONS = 2;

        let fullText = "", inputTokens = 0, outputTokens = 0;
        let stopReason: string | null = null;
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
                    system: SYS_GENERATE,
                    messages,
                  }),
                });
                if (!upstream.ok || !upstream.body) {
                  const errText = await upstream.text().catch(() => "");
                  controller.enqueue(enc.encode(`data: ${JSON.stringify({
                    type: "error", error: `Anthropic ${upstream.status}: ${errText.slice(0, 300)}`,
                  })}\n\n`));
                  break;
                }

                const reader = upstream.body.getReader();
                let buf = "";
                let attemptText = "";
                let attemptStop: string | null = null;
                let attemptIn = 0, attemptOut = 0;
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
                        attemptText += t;
                        fullText += t;
                        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "text", text: t })}\n\n`));
                      } else if (evt.type === "message_start") {
                        attemptIn = evt.message?.usage?.input_tokens ?? attemptIn;
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
                stopReason = attemptStop;

                if (attemptStop !== "max_tokens" || attempt >= MAX_CONTINUATIONS || !attemptText) break;
                messages.push({ role: "assistant", content: attemptText });
                messages.push({
                  role: "user",
                  content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el formato ═══ y completa todas las secciones pendientes (escenas restantes, AVATAR, HOOKS EXTRA, EFFECTS DENSITY MAP, ENERGY ARC, TIMELINE CAPCUT, RECOMMENDATION).",
                });
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
                  maxTokens: MAX_TOKENS,
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
              if (inputTokens || outputTokens) {
                await logUsage({
                  userId, workspaceId: body.workspaceId ?? null, model,
                  operation: "claude_variation_partial",
                  inputTokens, outputTokens,
                  metadata: { variationType: body.variationType, partial: true },
                }).catch(() => {});
              }
              void calcCost;
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
