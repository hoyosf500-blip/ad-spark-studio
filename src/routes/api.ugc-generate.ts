import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SYS_UGC } from "@/lib/system-prompts";
import { logUsage, dataUrlToAnthropicImage } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import { WINNING_PREAMBLE, checkScript } from "@/lib/winning-framework";
import type { Database } from "@/integrations/supabase/types";

type Body = {
  workspaceId: string;
  projectId?: string | null;
  sourceVideoId?: string | null;
  style: "ugc-casual" | "ugc-testimonial" | "ugc-viral" | "ugc-unboxing";
  analysisText?: string | null;
  transcription?: string | null;
  productInfo?: string | null;
  productPhoto?: string | null;
  duration?: string;
  creativeBrief?: string | null;
  videoModel?: "wan2.6-i2v" | "kling2.5-turbo";
  model?: string;
};

// Anthropic native content block types.
type CacheControl = { type: "ephemeral" };
type ContentPart =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
      cache_control?: CacheControl;
    };

// Style descriptions — ugc-casual / ugc-testimonial / ugc-unboxing preserved verbatim from HTML standalone.
// ugc-viral rewritten 2026-04-18 applying create-viral-content skill research:
// BuzzSumo 100M headlines, Outbrain +63% negative superlatives, WHAT→HOW→WHY NOW→PAYOFF body,
// command-close (no engagement bait), Spanish AI-tells blacklist.
const STYLE_DESC: Record<Body["style"], string> = {
  "ugc-casual":
    "Casual problema — she HAS the problem (CUALQUIER nicho: dolor físico, problema de piel, mancha en la cocina, celular que se descarga, batidos que no satisfacen, etc.), discovers the product for the first time. Tone: vulnerable, relatable, hopeful. Structure: problem (Shot 1-2) → discovery of product (Shot 2-3, NOT Shot 1) → first reaction → CTA. She SHOWS where está el problema con indicadores físicos del nicho real (tocando la zona del dolor, mostrando la mancha en el azulejo, mostrando el porcentaje de batería bajo, frotando la piel sin resultado). Adapt the visual indicator to the actual niche from PRODUCT INFO. Product appears mid-video, never at the start. Hook: el momento de frustración del nicho (dolor + mueca, mancha + suspiro, batería 5% + cara de pánico, piel grasa + reflexión en espejo). Ejemplos por nicho: SALUD = wincing al levantarse; BELLEZA = mira el espejo y se toca la mejilla con frustración; HOGAR = restriega la mancha y suspira; TECNOLOGÍA = ve el ícono de batería y resopla; WELLNESS = bostezo + ojos cansados a las 3pm.",
  "ugc-testimonial":
    "Testimonial — she ALREADY used the product, shares her result. Tone: confident, grateful, recommending to a friend. Structure: before context with time anchor (\"llevo 2 semanas\", \"desde el mes pasado\") → product use → result with before/after verbal contrast (elegí el del nicho real: \"antes no podía ni agacharme, ahora...\" / \"antes mi piel se veía apagada en cualquier foto, ahora...\" / \"antes el celular no me llegaba a la tarde, ahora...\") → recommendation. Product appears early. Hook: transformation statement or before/after contrast.",
  // 2026-05-04: rotación de hooks B/D + closer + voice por nicho (salud | belleza | tech)
  // — bias salud-only detectado en CHECK 5 de auditoría multinicho. HOOK A y C quedan
  // intactos (A es wellness genérico, C es estructural sin ejemplo de nicho).
  "ugc-viral":
    `Hook viral — personal-brand UGC. The Avatar IS the product. Product NEVER appears in frame. Do NOT reference /image1.

════ HOOK (0–2s) — pick exactly ONE of these four patterns ════
A. CONTRARIAN + STAKES (highest CTR):
   "Nadie te va a decir que [creencia común] te está [costando algo concreto medible]."
   ej: "Nadie te va a decir que esa cena de las 10pm te está robando el sueño profundo."
B. TRIBAL SPLIT (ego trigger):
   "Esto separa [quien quieres ser] de [quien nunca quieres volver a ser]."
   ej (elegí el del nicho real):
     salud:   "Esto separa a la que se recupera del dolor lumbar de la que vive 10 años con él."
     belleza: "Esto separa a la que recupera glow después de los 35 de la que vive 10 años con base pesada."
     tech:    "Esto separa al que llega a las 8pm con 40% de batería del que carga 3 veces al día."
C. NEGATIVE SUPERLATIVE (+63% vs positivo — research Outbrain):
   "Los [N impar] errores que [destruyen / arruinan / sabotean] tu [outcome]."
   N debe ser 3, 5 o 7 — números impares rinden mejor que pares.
D. PATTERN INTERRUPT: acción inesperada + corte + frase de impacto.
   ej (elegí el del nicho real):
     salud:   se tira al piso, "así duerme una lumbalgia de 40 años."
     belleza: se mira al espejo en luz natural, "así se ve la piel después de 3 noches sin sérum."
     tech:    muestra el cel al 8% a las 4pm, "así llegás a la tarde con cualquier cargador chino."

════ BODY (2–22s) — 4-beat build OBLIGATORIO ════
1. WHAT    (2–5s):  concepto en 1 frase corta. Sin hedging.
2. HOW     (5–12s): mecanismo + 1 ejemplo específico con número real. Contraste verbal antes/después.
3. WHY NOW (12–17s): urgencia física o estacional. Síntoma que empeora hoy.
4. PAYOFF  (17–22s): resultado tangible que puede conseguir esta semana. Número o tiempo concreto.

════ CLOSER (22–30s) — COMMAND, never a request ════
Patrón obligatorio: "Tu próximo [acción cotidiana] no debería [forma vieja]. Debería [forma nueva específica]."
ej (elegí el del nicho real):
  salud:   "Tu próximo levantamiento no debería venir de la espalda. Debería empezar en la cadera."
  belleza: "Tu próximo glow no debería venir de filtros. Debería empezar en la barrera de tu piel."
  tech:    "Tu próxima carga no debería tomar 2 horas. Debería empezar antes del primer café."

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
• Cero "beneficios" genéricos. Siempre: "vas a sentir/ver/notar X en Y [minutos/días/usos]". Ej por nicho: "lumbar respira el 4to día" (salud) | "mancha aclara en 2 semanas" (belleza) | "celular llega a la tarde con 40%" (tech).
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

        const cap = await checkSpendingCap(sb, userId, "api.ugc-generate");
        if (!cap.ok) return capExceededResponse(cap);
        const reservedUsd = cap.reservedUsd;

        const body = (await request.json()) as Body;
        // analysisText is required for every style EXCEPT ugc-viral (viral = fresh personal-brand content, no source needed).
        const viralNoAnalysis = body.style === "ugc-viral";
        if (!body.workspaceId || !body.style || (!viralNoAnalysis && !body.analysisText)) {
          return new Response("Missing fields: workspaceId, style, analysisText (analysisText optional only for ugc-viral)", { status: 400 });
        }

        // Service-role client: used for (1) workspace-membership check before spending tokens,
        // and (2) inserting the ugc_generations row after the stream completes. The RLS policy
        // ug_ins requires is_ws_member(auth.uid(), workspace_id); service-role bypasses RLS,
        // so we enforce membership manually here.
        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );
        const { data: membership } = await admin
          .from("workspace_members")
          .select("user_id")
          .eq("user_id", userId)
          .eq("workspace_id", body.workspaceId)
          .maybeSingle();
        if (!membership) return new Response("Forbidden: not a workspace member", { status: 403 });

        const model = body.model || "claude-sonnet-4-5";
        const videoModel = body.videoModel || "wan2.6-i2v";
        const targetModelLabel =
          videoModel === "kling2.5-turbo" ? "Kling 2.5 Turbo" : "Seedance 2.0";

        const isKling = videoModel === "kling2.5-turbo";
        const klingRules = isKling
          ? [
              `LANGUAGE RULES (Kling 2.5 Turbo): the IMAGE PROMPT and ANIMATION PROMPT MUST be fully in ENGLISH — no Spanish words inside them except the SCRIPT dialogue itself (which stays Spanish).`,
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

        const isViral = body.style === "ugc-viral";
        const durationStr = body.duration ?? "12";

        // === SHARED PREFIX (cacheable across the 4 UGC styles for the same project) ===
        // productPhoto + productInfo + transcription + analysisBlock no cambian
        // entre estilos. Marcamos la última parte con cache_control para que las
        // llamadas 2-N peguen al cache (~5 min TTL Anthropic) a 0.10x input.
        const sharedContent: ContentPart[] = [];
        if (body.productPhoto) {
          sharedContent.push({ type: "text", text: "=== PRODUCT PHOTO (reference) ===" });
          sharedContent.push(dataUrlToAnthropicImage(body.productPhoto));
        }
        const sharedTextParts = [
          body.productInfo ? `PRODUCT INFO:\n${body.productInfo}` : "",
          body.transcription ? `USER TRANSCRIPTION (use word-for-word, split across shots naturally):\n${body.transcription}` : "",
          analysisBlock,
        ].filter(Boolean).join("\n\n");
        if (sharedTextParts) {
          sharedContent.push({ type: "text", text: sharedTextParts });
        }
        if (sharedContent.length > 0) {
          sharedContent[sharedContent.length - 1] = {
            ...sharedContent[sharedContent.length - 1],
            cache_control: { type: "ephemeral" },
          };
        }

        // === STYLE-SPECIFIC SUFFIX (cambia entre las 4 calls UGC) ===
        const styleText = [
          !isViral ? WINNING_PREAMBLE : "",
          `STYLE: ${body.style} — ${STYLE_DESC[body.style]}`,
          `TARGET MODEL: ${targetModelLabel}`,
          `DURATION: ${durationStr} seconds`,
          klingRules,
          body.creativeBrief?.trim()
            ? `=== IDEA CREATIVA DEL USUARIO ===\n${body.creativeBrief.trim()}\n\nCONTRATO:\n- La IDEA dicta SOLO: tono, setting, personaje, emoción, ritmo.\n- La IDEA NO dicta: componente, dosis, precio, testimonios, claims médicos.\n- Si contradice PRODUCT INFO / TRANSCRIPTION / ANALYSIS, prevalecen los datos reales.\n- Si la IDEA menciona un dato concreto que no está en los inputs, IGNORALO.`
            : "",
          `\nProduce ONLY the PROMPT and HOOKS sections, exactly per the format. No preamble.`,
        ].filter(Boolean).join("\n\n");

        const content: ContentPart[] = [
          ...sharedContent,
          { type: "text", text: styleText },
        ];

        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            // 8192 da margen 2x sobre el output típico de UGC sin penalización.
            max_tokens: 8192,
            stream: true,
            temperature: 0.6,
            // System con cache_control nativo. SYS_UGC (~10.9KB ≈ 2800 tokens) se
            // manda 4 veces por proyecto (fan-out de estilos UGC). Cache_read en las
            // 4 calls reduce el peso del system de ~$0.034 a ~$0.011 acumulado.
            system: [
              { type: "text", text: SYS_UGC, cache_control: { type: "ephemeral" } },
            ],
            messages: [{ role: "user", content }],
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text();
          // Reconcile the held reservation back to zero so the spending cap
          // doesn't drift when the upstream fails before any tokens are spent.
          await logUsage({
            userId,
            workspaceId: body.workspaceId,
            model,
            operation: "anthropic_ugc_script_failed",
            inputTokens: 0,
            outputTokens: 0,
            reservedUsd,
            metadata: { upstreamStatus: upstream.status, style: body.style },
          }).catch((e) => console.warn("[ugc-generate] reconcile log failed:", e));
          return new Response(`Anthropic ${upstream.status}: ${errText.slice(0, 500)}`, { status: 502 });
        }

        let fullText = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheCreateTokens = 0;
        let cacheReadTokens = 0;
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
                    const payload = dl.slice(6).trim();
                    if (!payload) continue;
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
                      inputTokens = evt.message.usage.input_tokens ?? 0;
                      cacheCreateTokens = evt.message.usage.cache_creation_input_tokens ?? 0;
                      cacheReadTokens = evt.message.usage.cache_read_input_tokens ?? 0;
                    } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                      const t = evt.delta.text;
                      if (typeof t === "string" && t.length) {
                        fullText += t;
                        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "text", text: t })}\n\n`));
                      }
                    } else if (evt.type === "message_delta") {
                      if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                      if (typeof evt.usage?.output_tokens === "number") {
                        outputTokens = evt.usage.output_tokens;
                      }
                    }
                  } catch { /* skip */ }
                }
              }

              const isTruncated = stopReason === "max_tokens";

              const cost = await logUsage({
                userId,
                workspaceId: body.workspaceId,
                model,
                operation: "anthropic_ugc_script",
                inputTokens,
                outputTokens,
                cacheCreateTokens,
                cacheReadTokens,
                reservedUsd,
                metadata: {
                  style: body.style,
                  videoModel,
                  isTruncated,
                  cacheCreateTokens,
                  cacheReadTokens,
                },
              });

              // Parse PROMPT and HOOKS sections + extract image/animation prompts
              const parsed = parseUgcOutput(fullText);
              const validation = checkScript(fullText);

              // Persist row (admin client is shared with the membership check above).
              // Surface insert errors explicitly so the client can show a clear
              // "saved but invisible" warning instead of a silent ugcId:null.
              const { data: row, error: insertErr } = await admin
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
                  validation,
                } as never)
                .select("id")
                .single();
              if (insertErr) {
                console.error("[ugc-generate] insert failed:", insertErr);
              }

              controller.enqueue(enc.encode(`data: ${JSON.stringify({
                type: "done",
                ugcId: row?.id ?? null,
                persistError: insertErr?.message ?? null,
                fullText,
                imagePromptEn: parsed.imagePromptEn,
                animationPromptEn: parsed.animationPromptEn,
                scriptEs: parsed.scriptEs,
                hooks: parsed.hooks,
                costUsd: cost,
                inputTokens,
                outputTokens,
                cacheCreateTokens,
                cacheReadTokens,
                stopReason,
                isTruncated,
                model,
                validation,
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
