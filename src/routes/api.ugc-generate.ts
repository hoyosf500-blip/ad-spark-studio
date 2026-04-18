import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_UGC } from "@/lib/system-prompts";
import { logUsage } from "@/utils/anthropic.functions";
import type { Database } from "@/integrations/supabase/types";

type Body = {
  workspaceId: string;
  projectId?: string | null;
  sourceVideoId?: string | null;
  style: "ugc-casual" | "ugc-testimonial" | "ugc-viral" | "ugc-unboxing";
  analysisText?: string | null;
  transcription?: string | null;
  productInfo?: string | null;
  videoModel?: "wan2.6-i2v" | "kling2.5-turbo" | "veo3";
  model?: string;
};

// Style descriptions — ugc-casual / ugc-testimonial / ugc-unboxing preserved verbatim from HTML standalone.
// ugc-viral rewritten 2026-04-18 applying create-viral-content skill research:
// BuzzSumo 100M headlines, Outbrain +63% negative superlatives, WHAT→HOW→WHY NOW→PAYOFF body,
// command-close (no engagement bait), Spanish AI-tells blacklist.
const STYLE_DESC: Record<Body["style"], string> = {
  "ugc-casual":
    "Casual dolor — she HAS the problem, discovers the product for the first time. Tone: vulnerable, relatable, hopeful. Structure: problem (Shot 1-2) → discovery of product (Shot 2-3, NOT Shot 1) → first reaction → CTA. She shows WHERE it hurts with physical indicators (touching the zone, wincing, restricted movement). Product appears mid-video, never at the start. Hook: pain moment or frustrated gesture.",
  "ugc-testimonial":
    "Testimonial — she ALREADY used the product, shares her result. Tone: confident, grateful, recommending to a friend. Structure: before context with time anchor (\"llevo 2 semanas\", \"desde el mes pasado\") → product use → result with before/after verbal contrast (\"antes no podía ni agacharme, ahora...\") → recommendation. Product appears early. Hook: transformation statement or before/after contrast.",
  "ugc-viral":
    `Hook viral — personal-brand UGC. The Avatar IS the product. Product NEVER appears in frame. Do NOT reference /image1.

════ HOOK (0–2s) — pick exactly ONE of these four patterns ════
A. CONTRARIAN + STAKES (highest CTR):
   "Nadie te va a decir que [creencia común] te está [costando algo concreto medible]."
   ej: "Nadie te va a decir que esa cena de las 10pm te está robando el sueño profundo."
B. TRIBAL SPLIT (ego trigger):
   "Esto separa [quien quieres ser] de [quien nunca quieres volver a ser]."
   ej: "Esto separa a la que se recupera del dolor lumbar de la que vive 10 años con él."
C. NEGATIVE SUPERLATIVE (+63% vs positivo — research Outbrain):
   "Los [N impar] errores que [destruyen / arruinan / sabotean] tu [outcome]."
   N debe ser 3, 5 o 7 — números impares rinden mejor que pares.
D. PATTERN INTERRUPT: acción inesperada + corte + frase de impacto.
   ej: se tira al piso, "así duerme una lumbalgia de 40 años."

════ BODY (2–22s) — 4-beat build OBLIGATORIO ════
1. WHAT    (2–5s):  concepto en 1 frase corta. Sin hedging.
2. HOW     (5–12s): mecanismo + 1 ejemplo específico con número real. Contraste verbal antes/después.
3. WHY NOW (12–17s): urgencia física o estacional. Síntoma que empeora hoy.
4. PAYOFF  (17–22s): resultado tangible que puede conseguir esta semana. Número o tiempo concreto.

════ CLOSER (22–30s) — COMMAND, never a request ════
Patrón obligatorio: "Tu próximo [acción cotidiana] no debería [forma vieja]. Debería [forma nueva específica]."
ej: "Tu próximo levantamiento no debería venir de la espalda. Debería empezar en la cadera."

❌ PROHIBIDO en el closer:
- "dale like", "suscríbete", "sígueme"
- "déjame saber en los comentarios", "¿qué opinan?", "cuéntame abajo"
- "comenta X y te envío", "escribe la palabra YA"
- mención de COD, "paga al recibir", precio, envío

════ BLACKLIST (AI tells en español — CERO tolerancia) ════
❌ "Hola chicos / Hola familia / Hola qué tal"
❌ "Les voy a contar" / "Les traigo" / "Hoy vengo a..."
❌ "Esto les va a cambiar la vida" / "No van a creer"
❌ "Increíble" / "Revolucionario" / "Impresionante" / "Brutal"
❌ "Literalmente" como muletilla
❌ "La verdad es que..." al inicio de frase
❌ Transiciones: "Pero lo mejor viene ahora", "Ahora sí lo bueno", "Prepárate porque..."
❌ Listas recitadas: "Primero... Segundo... Tercero..."

════ VOICE (obligatorio) ════
• Variación de longitud de oración: mezclar frases de 3 palabras con frases de 14. Nunca 5 frases seguidas de la misma duración.
• Ratio 1:1 — 1 ejemplo concreto con número por cada claim abstracto.
• Cero "beneficios" genéricos. Siempre: "vas a sentir X en Y minutos" o "tu Z deja de doler el día N".
• Contracciones naturales colombianas: "pa' que", "ni de broma", "eso sí", "en serio".

════ SETTING ════
Gym con pesas de fondo · carro en parqueadero · caminando calle de barrio · escaleras urbanas · cocina abierta con café recién hecho. NUNCA sala-apartamento beige con sofá. Luz natural dura o contraluz — no softbox uniforme.

════ HOOKS EXTRA (las 3 alternativas del final) ════
Deben venir de patrones DISTINTOS (una A, una B, una C). No variaciones de la misma frase.`,
  "ugc-unboxing":
    "Unboxing COD — she opens the package ON CAMERA. Tone: excited, genuine surprise, show-and-tell. Structure: package arrives (doorbell or package in hands) → anticipation beats (reads label, feels weight, shows security seal) → opens and reveals product — this reveal moment is the hero visual → first impression reaction → CTA with \"paga al recibir\". Reference product as \"pictured in /image1\" at the reveal moment. Hook: package in hands or doorbell.",
};

export const Route = createFileRoute("/api/ugc-generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = authHeader.slice(7);

        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false } },
        );
        const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub;

        const body = (await request.json()) as Body;
        // analysisText is required for every style EXCEPT ugc-viral (viral = fresh personal-brand content, no source needed).
        const viralNoAnalysis = body.style === "ugc-viral";
        if (!body.workspaceId || !body.style || (!viralNoAnalysis && !body.analysisText)) {
          return new Response("Missing fields: workspaceId, style, analysisText (analysisText optional only for ugc-viral)", { status: 400 });
        }
        const model = body.model || "claude-sonnet-4-5-20250929";
        const videoModel = body.videoModel || "wan2.6-i2v";
        const targetModelLabel =
          videoModel === "veo3"
            ? "Veo 3.1 Fast"
            : videoModel === "kling2.5-turbo"
              ? "Kling 3.0"
              : "Seedance 2.0";

        const isKling = videoModel === "kling2.5-turbo";
        const klingRules = isKling
          ? [
              `LANGUAGE RULES (Kling 3.0): the IMAGE PROMPT and ANIMATION PROMPT MUST be fully in ENGLISH — no Spanish words inside them except the SCRIPT dialogue itself (which stays Spanish).`,
              body.transcription
                ? `Translate the Spanish transcription into natural English BEFORE embedding it as dialogue cues in the ANIMATION PROMPT (subject's mouth shapes English). The SCRIPT stays in Spanish for overlay text.`
                : "",
            ].filter(Boolean).join("\n")
          : "";

        const analysisBlock = body.analysisText
          ? `SOURCE VIDEO ANALYSIS (for reference only — do NOT copy structure, this UGC is a fresh testimonial):\n${body.analysisText.slice(0, 12000)}`
          : viralNoAnalysis
            ? `NO SOURCE VIDEO. This is a fresh personal-brand viral piece — invent the scenario from scratch using the STYLE guidance and PRODUCT INFO.`
            : "";

        const userText = [
          `STYLE: ${body.style} — ${STYLE_DESC[body.style]}`,
          `TARGET MODEL: ${targetModelLabel}`,
          klingRules,
          body.productInfo ? `PRODUCT INFO:\n${body.productInfo}` : "",
          body.transcription ? `USER TRANSCRIPTION (use word-for-word, split across shots naturally):\n${body.transcription}` : "",
          analysisBlock,
          `\nProduce ONLY the PROMPT and HOOKS sections, exactly per the format. No preamble.`,
        ]
          .filter(Boolean)
          .join("\n\n");

        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            stream: true,
            system: SYS_UGC,
            messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text();
          return new Response(`Anthropic ${upstream.status}: ${errText.slice(0, 500)}`, { status: 502 });
        }

        let fullText = "";
        let inputTokens = 0;
        let outputTokens = 0;
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
                workspaceId: body.workspaceId,
                model,
                operation: "claude_ugc_script",
                inputTokens,
                outputTokens,
                metadata: { style: body.style, videoModel, isTruncated: stopReason === "max_tokens" },
              });

              // Parse PROMPT and HOOKS sections + extract image/animation prompts
              const parsed = parseUgcOutput(fullText);

              // Persist row
              const admin = createClient<Database>(
                process.env.SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { auth: { persistSession: false } },
              );
              const { data: row } = await admin
                .from("ugc_generations")
                .insert({
                  workspace_id: body.workspaceId,
                  user_id: userId,
                  source_project_id: body.projectId ?? null,
                  source_video_id: body.sourceVideoId ?? null,
                  style: body.style,
                  script_text: parsed.scriptEs,
                  image_prompt_en: parsed.imagePromptEn,
                  animation_prompt_en: parsed.animationPromptEn,
                  video_model: videoModel,
                  cost_usd: cost,
                  status: "ready",
                  data: { fullText, hooks: parsed.hooks, stopReason },
                } as never)
                .select("id")
                .single();

              controller.enqueue(enc.encode(`data: ${JSON.stringify({
                type: "done",
                ugcId: row?.id ?? null,
                fullText,
                imagePromptEn: parsed.imagePromptEn,
                animationPromptEn: parsed.animationPromptEn,
                scriptEs: parsed.scriptEs,
                hooks: parsed.hooks,
                costUsd: cost,
                stopReason,
                isTruncated: stopReason === "max_tokens",
                model,
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

function parseUgcOutput(text: string): {
  imagePromptEn: string;
  animationPromptEn: string;
  scriptEs: string;
  hooks: string[];
} {
  // PROMPT section: between "PROMPT:" and "HOOKS:"
  const promptMatch = /PROMPT:\s*([\s\S]*?)(?=\n\s*HOOKS:|$)/i.exec(text);
  const promptParagraph = (promptMatch?.[1] ?? "").trim();

  // HOOKS section
  const hooksMatch = /HOOKS:\s*([\s\S]*)$/i.exec(text);
  const hooksRaw = (hooksMatch?.[1] ?? "").trim();
  const hooks = hooksRaw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*\d+[\.\)]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);

  // Image prompt: photographic Shot 1 description (use full paragraph as Qwen reference)
  const imagePromptEn = promptParagraph
    ? `Real photograph taken with iPhone 15 Pro of ${promptParagraph} ZERO bokeh, sharp focus across entire frame, 9:16 vertical, hyperrealistic skin texture, light catching on collarbones and jewelry.`
    : "";

  // Animation prompt for video models = the full paragraph
  const animationPromptEn = promptParagraph;

  // Script ES: extract Spanish dialogue lines from the paragraph
  const dialogueMatches = [...promptParagraph.matchAll(/Dialogue[^:]*:\s*"([^"]+)"/gi)];
  const scriptEs = dialogueMatches.map((m) => m[1]).join(" ").trim();

  return { imagePromptEn, animationPromptEn, scriptEs, hooks };
}
