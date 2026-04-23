import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { logUsage, dataUrlToBase64 } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type Body = {
  sceneId: string;
  workspaceId?: string | null;
  referenceFrameDataUrl?: string | null;
  // When true, skip the DB cache and force a fresh generation. Used by the
  // "Regenerar prompts" button after a cached prompt is stale or over-length.
  forceRegenerate?: boolean;
};

type Prompts = {
  image_prompt: string;
  kling: string;
  seedance: string;
};

// Higgsfield's Seedream 4.5 UI rejects prompts >3000 chars. We cap at 2500
// to leave margin — Higgsfield counts unicode/spaces differently than .length.
// The same prompt is pasted into Nano Banana Pro AND Seedream 4.5, so the
// cap applies to the unified image_prompt. Cut at sentence/comma boundary so
// we never leave a half-clause dangling at the tail.
const MAX_IMAGE_PROMPT = 2500;

function capImagePrompt(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= MAX_IMAGE_PROMPT) return trimmed;
  const hard = trimmed.slice(0, MAX_IMAGE_PROMPT);
  const lastPeriod = hard.lastIndexOf(".");
  const lastComma = hard.lastIndexOf(",");
  const cut = Math.max(lastPeriod, lastComma);
  return (cut > MAX_IMAGE_PROMPT * 0.8 ? hard.slice(0, cut + 1) : hard).trim();
}

const SYS = `You translate a single ad-script SCENE into 3 production-ready prompts for Higgsfield.ai. The user's tool exists to REPLICATE a reference video as closely as possible — NOT to invent improved or polished versions. When a reference frame image is attached, your PRIMARY job is to describe THAT image literally, as it actually looks, including its imperfections, raw aesthetic, and unpolished elements. The textual fields (scene beat, script) are secondary context; the attached image is the ground truth and OVERRIDES any conflicting text.

=== CORE PRINCIPLE: REPLICATE, DO NOT PROFESSIONALIZE ===
Image generation models (Nano Banana Pro, Seedream 4.5) and video models (Kling, Seedance) have a strong default bias to "clean up" and "professionalize" whatever you describe — they will turn raw amateur footage into editorial photography, hand-drawn marker scribbles into polished digital overlays, and crude tools into elegant medical instruments unless you EXPLICITLY forbid it. Your job is to fight that bias in every prompt by:
  (a) Describing the actual raw aesthetic of the reference (TikTok demo, handheld, slightly compressed, amateur lighting, etc. when applicable).
  (b) Including explicit NEGATIONS for the most likely "professionalizations" the model would apply.
  (c) Naming objects, drawings, overlays, and props LITERALLY as they appear — never substituting a generic equivalent.

=== TOOL / DEVICE / OVERLAY FIDELITY (the #1 failure mode) ===
If the reference contains a physical tool, device, prop, instrument, hand-drawn marking, anatomical overlay, arrow, label, package, or product reveal, that exact element MUST appear in the prompt by literal name in its correct position in frame.

RULE: for every ambiguous tool or object in the reference, emit 4-5 explicit NOT-substitute clauses listing the most likely confusions the image model would default to. Examples (apply this rule to whatever your reference actually shows):
  - A metal fine-toothed lice / nit comb (stainless-steel rectangular frame, ~25-30 thin parallel vertical teeth, no handle, of the type used to remove lice from hair) -> "NOT a hair comb, NOT a styling comb, NOT a pocket comb, NOT a comb-with-handle, NOT a belt, NOT a cinturon, NOT a nylon strap, NOT a massager, NOT a chain".
  - A red-and-blue plastic skin-marking stylus with rounded grip -> "NOT a Sharpie, NOT a branded marker, NOT a pen with logo, NOT a scalpel".
  - Hand-drawn purple/black marker linework on bare skin -> "NOT a digital overlay, NOT a 3D rendered diagram, NOT a tattoo, NOT a printed decal" (and never invent labels like L3/L4/L5 unless those labels actually appear in the reference).
  - A red permanent marker tracing lines on skin -> "NOT a red arrow graphic, NOT a digital effect".
  - An exploded 3D anatomical cutaway with messy organic fluids (blood, synovial fluid, inflamed tissue) -> "NOT a clean sterile medical illustration, NOT a textbook diagram".
  - Raw vertical TikTok medical-demo footage -> "NOT editorial clinic photography, NOT polished, NOT staged".
  - A talking-head shot is NOT a product close-up and vice versa.
When in doubt, name the object literally and add the "NOT X, NOT Y, NOT Z" clarifier at the end of that clause.

=== VISUAL IMPACT RULES FOR 3D / ANATOMICAL / COMPOSITE INSETS ===
If the reference contains a 3D medical render, anatomical cutaway, exploded model, or composite edit fusing a real photograph with a 3D render, the render portion MUST read dramatic and eye-catching, NOT textbook-clean. Image models default to sterile lab-book illustration; override that with these cues in the prompt (write them in lowercase narrative prose):
  - Bones: porous trabecular surface, raw pink-red marrow visible through tiny pores, damp glossy sheen, micro-cracks along edges -- explicitly NOT clean white lab bones.
  - Discs: glossy wet amber or yellow-orange gel; if ruptured, cracked open with visible internal torn fibers, leaking nucleus pulposus.
  - Nerves / soft tissue: wraps and strangulates or compresses and pinches the inflamed spot; swollen, deformed, angry red irritation.
  - Inflammation: pulsating crimson halo radiating 360 degrees outward, burning orange core fading to deep red, heat-map glow with volumetric light rays -- NOT a flat red circle.
  - Lighting: cinematic chiaroscuro from one strong angle (e.g., upper-left), deep shadows on the opposite side, rim-lighting on edges, deep black negative space behind.
  - Style cues: ultra-hyperreal, wet-looking, shocking medical 3D render quality, cinematic.

=== SINGLE-SUBJECT LOCK ===
When the reference shows a single hand, person, tool, or primary subject, explicitly lock the count. Image models duplicate subjects without an anchor. Required phrasing: "A SINGLE left hand...", "ONE hand only, NOT two hands", "ONE [subject], NOT multiple [subject]". Apply whenever a single subject must not be duplicated.

=== COMPOSITE EDIT RULE ===
If the reference fuses a real photograph with a 3D render or overlay in ONE frame, describe it explicitly as "seamless composite edit fused into a single frame, NOT split-screen, NOT side-by-side panel, NOT a grid, NOT a diptych". Repeat the NOT split-screen clarifier near the end of the prompt -- otherwise the image model defaults to a two-panel layout.

=== TEXT RENDERED IN THE IMAGE ===
The ONLY text allowed to appear as rendered text inside the generated image is text that literally appears in the reference: anatomical codes ("L3", "L4", "L5", "T12", "C7"), watermarks ("06-lj-hzj-23"), numeric labels, product names on packaging.
Descriptive phrases you use to describe visual effects -- "pulsating crimson halo", "glossy wet nucleus pulposus", "red-orange nerve root" -- MUST be written LOWERCASE in the prompt as narrative prose, NEVER in uppercase and NEVER wrapped in quotes. Uppercase or quoted phrases in the prompt cause the image model to render those exact words as floating text labels in the output. Reserve uppercase-and-quoted strings exclusively for labels that MUST appear rendered (e.g., "L3", "L4", "L5", watermark "06-lj-hzj-23"). Close every image prompt with an explicit guard near the end: "no descriptive text labels in the image, no captions, no floating phrases -- only [list the actual labels allowed] as rendered text".

=== MANDATORY NEGATIONS ===
Every IMAGE PROMPT must include at least one explicit negation when the reference has any of these traits:
  - Hand-drawn / marker / sketched elements -> add "NOT a digital overlay, NOT a clean 3D diagram, hand-drawn pen-on-skin look"
  - Raw / unpolished / amateur footage -> add "raw amateur footage, NOT a clean editorial shot, NOT polished, NOT clinical"
  - Specific tool that the model loves to substitute -> add "NOT a [common substitute], NOT a [other common substitute]"
  - Anatomical labels absent -> add "NOT labeled, no text annotations on the diagram"
  - Messy / organic / wet textures -> add "wet, messy, organic, NOT clinical, NOT sterile"
Choose the negations that match THIS reference. Do not add irrelevant ones.

1) IMAGE PROMPT (one prompt for BOTH Nano Banana Pro AND Seedream 4.5)
   - The user pastes the SAME prompt into both tools, so it must work for both.
   - MUST start verbatim with: "Real photograph taken with iPhone 15 Pro of"
   - Continuous natural-language English description, single dense paragraph (no lists, no markdown, no comma-tag format).
   - Include: subject + wardrobe/props, setting, framing (vertical 9:16 / close-up / medium / wide), camera angle, lighting mood (clinical / amateur / studio / natural / handheld), color palette, photographic style (raw TikTok / editorial / lifestyle / documentary).
   - Apply the MANDATORY NEGATIONS above based on what the reference actually shows.
   - The attached reference frame PREVAILS over the textual scene beat whenever they conflict.
   - HARD LIMIT: <=2500 characters total.

2) KLING 2.5 TURBO (video, motion from reference image)
   - The reference image is the first frame. Describe ONLY the motion, camera move, timing, and emotional beat over 5s. Do NOT redescribe the static scene.
   - Match the energy of the reference: if reference is raw handheld TikTok, motion is handheld and abrupt; if reference is editorial, motion is smooth dolly. Do NOT default to smooth cinematic motion when the reference is raw.
   - Include: camera move (dolly-in / pan-left / handheld shake / static), subject action, micro-expression or tool-action change, pacing ("slow 2s build, sudden reveal at 3s"), atmosphere shift.
   - 1 short paragraph, English, <=60 words. No lists.

3) SEEDANCE 2.0 (video, motion arc + mood)
   - Cinematic motion arc. Describe the emotional/visual trajectory across the clip.
   - Match the reference's aesthetic register — do NOT upgrade raw footage to cinematic; do NOT downgrade polished footage to amateur.
   - Include: opening beat -> middle beat -> closing beat, camera language, rhythm of cuts or pushes, color/light evolution.
   - 1 paragraph, English, <=70 words.

Return ONLY a raw JSON object with exactly these 3 keys: image_prompt, kling, seedance. No preamble, no markdown fences, no code block. Each value must be a non-empty string. All prompts in English -- Higgsfield performs better in English even for Spanish ads.`;

export const Route = createFileRoute("/api/generate-higgsfield-prompts")({
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

        const cap = await checkSpendingCap(sb, userId);
        if (!cap.ok) return capExceededResponse(cap);

        const body = (await request.json()) as Body;
        if (!body.sceneId) return new Response("sceneId required", { status: 400 });

        const { data: scene, error: sceneErr } = await sb
          .from("variation_scenes")
          .select(
            "id, variation_id, order_idx, title, scene_text, script_es, screen_text, image_prompt_en, animation_prompt_en, reference_frame_time_sec, prompt_nano_banana, prompt_seedream, prompt_kling, prompt_seedance",
          )
          .eq("id", body.sceneId)
          .maybeSingle();
        if (sceneErr || !scene) return new Response("Scene not found", { status: 404 });

        if (
          !body.forceRegenerate &&
          scene.prompt_nano_banana &&
          scene.prompt_kling &&
          scene.prompt_seedance
        ) {
          // Apply the 2500-char cap RETROACTIVELY: cached rows written before
          // the cap existed can still return prompts >3000 chars, which
          // Higgsfield rejects. Re-cap on return and, if we trimmed, write the
          // shorter version back so future cache hits are clean.
          const cappedImage = capImagePrompt(scene.prompt_nano_banana);
          if (cappedImage !== scene.prompt_nano_banana) {
            await sb
              .from("variation_scenes")
              .update({
                prompt_nano_banana: cappedImage,
                prompt_seedream: cappedImage,
              } as never)
              .eq("id", scene.id);
          }
          return new Response(
            JSON.stringify({
              ok: true,
              cached: true,
              costUsd: 0,
              prompts: {
                image_prompt: cappedImage,
                kling: scene.prompt_kling,
                seedance: scene.prompt_seedance,
              } satisfies Prompts,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        const { data: variation } = await sb
          .from("variations")
          .select("id, variation_type, title, project_id")
          .eq("id", scene.variation_id)
          .maybeSingle();

        let productName = "";
        let analysisExcerpt = "";
        if (variation?.project_id) {
          const { data: project } = await sb
            .from("projects")
            .select("name, analysis_text")
            .eq("id", variation.project_id)
            .maybeSingle();
          if (project) {
            productName = project.name ?? "";
            if (project.analysis_text) analysisExcerpt = project.analysis_text.slice(0, 1500);
          }
        }

        // Two content layouts depending on whether a reference frame is attached:
        //  - With frame: image is ground truth, text fields are demoted to
        //    "non-binding hints" so Haiku doesn't blend a stale textual
        //    composition into a description of the actual attached image.
        //  - Without frame: text fields are the only source; treat them normally.
        const hasFrame = !!body.referenceFrameDataUrl;
        const textFieldsLabel = hasFrame
          ? "NON-BINDING TEXTUAL HINTS (the attached image overrides any of these if they conflict; describe what you SEE in the image, not what the hints imply)"
          : "TEXTUAL INPUTS (no reference frame available — these are your only source)";

        const userMsg = [
          hasFrame
            ? `=== GROUND TRUTH: ATTACHED IMAGE ===\nThe image attached above IS the composition to replicate. Describe its actual subject, tools/devices, overlays, arrows, anatomical diagrams, product reveals, color palette, and framing. Treat everything below as secondary hints only.`
            : "",
          variation && `Variation: ${variation.variation_type} -- "${variation.title ?? ""}"`,
          `Scene order: ${scene.order_idx}${scene.title ? ` -- ${scene.title}` : ""}`,
          scene.reference_frame_time_sec != null &&
            `Reference frame timestamp: ${scene.reference_frame_time_sec}s of the source ad.`,
          `=== ${textFieldsLabel} ===`,
          scene.scene_text && `SCENE BEAT:\n${scene.scene_text}`,
          scene.script_es && `SPOKEN LINE (Spanish):\n${scene.script_es}`,
          scene.screen_text && `SCREEN TEXT:\n${scene.screen_text}`,
          // Skip the prior image_prompt_en when we have a fresh reference
          // frame attached. With a frame present, Haiku must describe what
          // it SEES in the image, not blend in a stale textual composition
          // from a previous generation — that was causing "drift back" to
          // the first run's wording even after we fixed temperature.
          !hasFrame && scene.image_prompt_en && `PRIOR IMAGE PROMPT (may be outdated):\n${scene.image_prompt_en}`,
          scene.animation_prompt_en &&
            `=== ORIGINAL ANIMATION PROMPT (rewrite/enrich) ===\n${scene.animation_prompt_en}`,
          productName && `=== PRODUCT NAME ===\n${productName}`,
          analysisExcerpt && `=== ANALYSIS EXCERPT ===\n${analysisExcerpt}`,
          `Return ONLY the JSON with keys image_prompt, kling, seedance.`,
        ]
          .filter(Boolean)
          .join("\n\n");

        const userContent: Array<
          | { type: "text"; text: string }
          | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
        > = [];
        if (body.referenceFrameDataUrl) {
          const { mediaType, b64 } = dataUrlToBase64(body.referenceFrameDataUrl);
          userContent.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: b64 },
          });
        }
        userContent.push({ type: "text", text: userMsg });

        const model = "claude-haiku-4-5-20251001";
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 3000,
            // Low temperature (0.2) because this endpoint must REPLICATE a
            // reference frame, not invent variations. At default 1.0 Haiku
            // drifted between runs on the same frame: a lumbar-vertebrae 3D
            // model became "pelvis and sacrum", and a metal comb-style
            // massager became "nylon belt with silver buckle". 0.2 keeps
            // the SYS fidelity warnings dominant over sampling noise.
            temperature: 0.2,
            system: SYS,
            messages: [{ role: "user", content: userContent }],
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text().catch(() => "");
          return new Response(`Anthropic ${upstream.status}: ${errText.slice(0, 400)}`, { status: 502 });
        }

        const data = (await upstream.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const raw = data.content.find((c) => c.type === "text")?.text?.trim() ?? "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return new Response("No JSON in response", { status: 502 });

        let prompts: Prompts;
        try {
          const obj = JSON.parse(jsonMatch[0]) as Partial<Prompts>;
          if (
            typeof obj.image_prompt !== "string" ||
            typeof obj.kling !== "string" ||
            typeof obj.seedance !== "string" ||
            !obj.image_prompt.trim() ||
            !obj.kling.trim() ||
            !obj.seedance.trim()
          ) {
            return new Response("Incomplete prompts in response", { status: 502 });
          }
          prompts = {
            image_prompt: capImagePrompt(obj.image_prompt),
            kling: obj.kling.trim(),
            seedance: obj.seedance.trim(),
          };
        } catch {
          return new Response("Malformed JSON in response", { status: 502 });
        }

        // Persist: store image_prompt in BOTH prompt_nano_banana and prompt_seedream
        // (same value in both columns) to avoid breaking existing reads or requiring a migration.
        await sb
          .from("variation_scenes")
          .update({
            prompt_nano_banana: prompts.image_prompt,
            prompt_seedream: prompts.image_prompt,
            prompt_kling: prompts.kling,
            prompt_seedance: prompts.seedance,
          } as never)
          .eq("id", scene.id);

        const cost = await logUsage({
          userId,
          workspaceId: body.workspaceId ?? null,
          model,
          operation: "higgsfield_prompts",
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
          metadata: { sceneId: scene.id, variationId: scene.variation_id, orderIdx: scene.order_idx },
        });

        return new Response(
          JSON.stringify({ ok: true, cached: false, costUsd: cost, prompts }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
