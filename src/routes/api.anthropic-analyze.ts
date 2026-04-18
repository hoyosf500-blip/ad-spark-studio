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
          model?: string;
          workspaceId?: string | null;
        };
        if (!Array.isArray(body.frames) || body.frames.length === 0) {
          return new Response("frames is required (1+ items)", { status: 400 });
        }
        if (body.frames.length > 60) {
          return new Response("max 60 frames per request", { status: 400 });
        }

        const model = body.model || "claude-sonnet-4-5-20250929";
        const content: ContentBlock[] = [];
        content.push({
          type: "text",
          text: `Analiza este video frame por frame. Recibes ${body.frames.length} frames extraídos a 1fps.`,
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
            system: SYS_ANALYZE,
            messages: [{ role: "user", content }],
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(`Anthropic ${upstream.status}: ${errText.slice(0, 500)}`, { status: 502 });
        }

        const apiBody = (await upstream.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens: number; output_tokens: number };
          stop_reason?: string;
        };

        const text = apiBody.content.filter((c) => c.type === "text").map((c) => c.text || "").join("");
        const usage = apiBody.usage ?? { input_tokens: 0, output_tokens: 0 };
        const cost = await logUsage({
          userId,
          workspaceId: body.workspaceId ?? null,
          model,
          operation: "claude_analysis",
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          metadata: { frames: body.frames.length, hasProductPhoto: !!body.productPhoto },
        });

        return Response.json({
          ok: true,
          text,
          stopReason: apiBody.stop_reason ?? null,
          isTruncated: apiBody.stop_reason === "max_tokens",
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          costUsd: cost,
          model,
        });
      },
    },
  },
});
