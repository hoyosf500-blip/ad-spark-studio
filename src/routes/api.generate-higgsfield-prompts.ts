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

const SYS = `You translate a single ad-script SCENE into 3 production-ready prompts for Higgsfield.ai. CRITICAL: when a reference frame image is attached, your PRIMARY job is to describe THAT image — its exact composition, framing, subject, wardrobe, props, overlays, lighting, color palette. Do NOT invent a new scene. The variation tool exists so the generated image replicates the reference as closely as possible. Textual fields (scene beat, script) are secondary context; the attached image is the ground truth.

TOOL/DEVICE FIDELITY (common failure mode): if the reference frame contains a physical tool, device, prop, or instrument — e.g. metal massager, Gua Sha scraper, electric massage gun, ultrasound probe, suction cup, foam roller, adjustable belt, medical diagram overlay on skin, red down-arrows, exploded vertebra cutaway, sparkle/product reveal — that exact object MUST appear in the prompt, by name, in the correct position in frame. Do NOT substitute it with a generic marker, pen, or hand gesture. A "metal comb massager pressing down on the lumbar with red arrows pointing at the tool" is NOT "a gloved hand holding a red marker next to a red arc". When in doubt, name the object literally as it appears in the reference.

1) IMAGE PROMPT (one prompt for BOTH Nano Banana Pro AND Seedream 4.5)
   - The user pastes the SAME prompt into both tools, so it must work for both.
   - MUST start verbatim with: "Real photograph taken with iPhone 15 Pro of"
   - Continuous natural-language English description, single dense paragraph (no lists, no markdown, no comma-tag format).
   - Include: subject + wardrobe/props, setting, framing (close-up / medium / wide), camera angle, lighting mood, color palette, photographic style.
   - TOOL/DEVICE FIDELITY: when the reference shows a specific tool, device, product, package, overlay, or anatomical diagram, describe THAT exact object — do not substitute. Anatomical overlay stays anatomical overlay; product close-up stays product close-up; do NOT convert a non-talking-head reference into a talking-head shot.
   - The attached reference frame PREVAILS over the textual scene beat whenever they conflict.
   - HARD LIMIT: <=2500 characters total.

2) KLING 2.5 TURBO (video, motion from reference image)
   - The reference image is the first frame. Describe ONLY the motion, camera move, timing, and emotional beat over 5s. Do NOT redescribe the static scene.
   - Include: camera move (dolly-in / pan-left / handheld / static), subject action, facial micro-expression change, pacing ("slow 2s build, then sudden reveal at 3s"), atmosphere shift.
   - 1 short paragraph, English, <=60 words. No lists.

3) SEEDANCE 2.0 (video, motion arc + mood)
   - Cinematic motion arc. Describe the emotional/visual trajectory across the clip.
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
          scene.image_prompt_en && `PRIOR IMAGE PROMPT (may be outdated):\n${scene.image_prompt_en}`,
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
            max_tokens: 1200,
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
