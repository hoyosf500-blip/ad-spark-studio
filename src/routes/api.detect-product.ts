import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { dataUrlToBase64, logUsage } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type Body = {
  productPhoto: string;
  workspaceId?: string | null;
  model?: string;
};

type DetectResult = {
  name: string;
  oneLiner: string;
  price: string;
  audience: string;
};

const SYS = `You are a product-photo analyst for Colombian COD e-commerce.

You receive a single product photo and return ONE JSON object with these 4 fields:
- name      — short product name as shown on packaging or a plausible Spanish name (2–5 words)
- oneLiner  — main benefit in Spanish, one short sentence (e.g. "alivia el dolor de espalda en minutos")
- price     — best-guess Colombian retail price WITH the "$" and "COP" (e.g. "$89.900 COP"). If no price signal, leave empty string.
- audience  — target audience in Spanish (e.g. "mujeres 35+ con dolor lumbar" or "padres con bebés de 0–6 meses")

Return ONLY the JSON object. No preamble. No markdown fences. No code block. Just the raw JSON.
If any field cannot be inferred, return an empty string "" for that field — never null.`;

export const Route = createFileRoute("/api/detect-product")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = authHeader.slice(7);
        // Pass user JWT so checkSpendingCap can read profiles under RLS as the
        // calling user (otherwise daily_cap_usd silently defaults to $20).
        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub;

        const cap = await checkSpendingCap(sb, userId, "api.generate-higgsfield-prompts");
        if (!cap.ok) return capExceededResponse(cap);

        const body = (await request.json()) as Body;
        if (!body.productPhoto) return new Response("productPhoto required", { status: 400 });

        const model = body.model || "claude-sonnet-4-5-20250929";
        const { mediaType, b64 } = dataUrlToBase64(body.productPhoto);

        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 512,
            system: SYS,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
                  { type: "text", text: "Detecta los 4 campos y devuelve solo el JSON." },
                ],
              },
            ],
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(`Anthropic ${upstream.status}: ${errText.slice(0, 500)}`, { status: 502 });
        }

        const data = (await upstream.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const raw = data.content.find((c) => c.type === "text")?.text?.trim() ?? "";

        // Buscar el JSON completo. El regex anterior `/\{[\s\S]*\}/` era greedy
        // y, si Claude metía texto explicativo después del JSON con un `}` en
        // medio, capturaba hasta el último `}` del texto y JSON.parse fallaba.
        // Ahora cortamos del primer `{` al `}` que cierra ese bloque haciendo
        // un brace-matching simple — robusto a texto trailing.
        let parsed: DetectResult = { name: "", oneLiner: "", price: "", audience: "" };
        const start = raw.indexOf("{");
        let jsonText: string | null = null;
        if (start >= 0) {
          let depth = 0;
          for (let i = start; i < raw.length; i++) {
            if (raw[i] === "{") depth++;
            else if (raw[i] === "}") {
              depth--;
              if (depth === 0) { jsonText = raw.slice(start, i + 1); break; }
            }
          }
        }
        if (jsonText) {
          try {
            const obj = JSON.parse(jsonText) as Partial<DetectResult>;
            parsed = {
              name: typeof obj.name === "string" ? obj.name : "",
              oneLiner: typeof obj.oneLiner === "string" ? obj.oneLiner : "",
              price: typeof obj.price === "string" ? obj.price : "",
              audience: typeof obj.audience === "string" ? obj.audience : "",
            };
          } catch {
            /* fall through */
          }
        }

        const cost = await logUsage({
          userId,
          workspaceId: body.workspaceId ?? null,
          model,
          operation: "claude_detect_product",
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
          metadata: { hasPhoto: true },
        });

        return new Response(JSON.stringify({ ...parsed, costUsd: cost }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
