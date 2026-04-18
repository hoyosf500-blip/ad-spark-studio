import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_ANALYZE } from "@/lib/system-prompts";
import { dataUrlToBase64, logUsage } from "@/utils/anthropic.functions";
import type { Database } from "@/integrations/supabase/types";

type FrameInput = { time: number; dataUrl: string };
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export const Route = createFileRoute("/api/anthropic-analyze")({
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

        const model = body.model || "claude-sonnet-4-5-20250929";

        const content: ContentBlock[] = [];
        content.push({
          type: "text",
          text: `Analiza este video frame por frame. Recibes ${body.frames.length} frames extraídos.`,
        });
        for (const f of body.frames) {
          const { mediaType, b64 } = dataUrlToBase64(f.dataUrl);
          content.push({
            type: "text",
            text: `\nFRAME ${Math.round(f.time)}s (timestamp ${f.time.toFixed(2)}s):`,
          });
          content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
        }
        if (body.productPhoto) {
          const { mediaType, b64 } = dataUrlToBase64(body.productPhoto);
          content.push({ type: "text", text: "\n\nFOTO DEL PRODUCTO (referencia adicional, no es un frame del video):" });
          content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
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
        });

        const maxTokens = Math.min(32000, Math.max(8000, body.frames.length * 500 + 2000));
        const MAX_CONTINUATIONS = 1;

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
                    model, max_tokens: maxTokens, stream: true,
                    system: SYS_ANALYZE,
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
                  content: "Continúa exactamente desde donde te cortaste, sin repetir lo anterior. Mantén el mismo formato y termina con la sección de transcripción consolidada.",
                });
              }

              const cost = await logUsage({
                userId,
                workspaceId: body.workspaceId ?? null,
                model, operation: "claude_analysis",
                inputTokens, outputTokens,
                metadata: {
                  frames: body.frames.length,
                  hasProductPhoto: !!body.productPhoto,
                  isTruncated: stopReason === "max_tokens",
                  maxTokens,
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
