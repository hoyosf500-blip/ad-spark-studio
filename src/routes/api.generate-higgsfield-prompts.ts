import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { logUsage } from "@/utils/anthropic.functions";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

type Body = { sceneId: string; workspaceId?: string | null };

type Prompts = {
  nano_banana: string;
  seedream: string;
  kling: string;
  seedance: string;
};

const SYS = `You translate a single ad-script SCENE into 4 production-ready prompts for Higgsfield.ai, one per model:

1) NANO BANANA PRO (image, conversational)
   - Natural language, like describing the shot to a cinematographer.
   - Include: subject + wardrobe/props, setting, framing (close-up / medium / wide), camera angle, lighting mood, color palette, photographic style ("shot on 50mm", "natural light", "documentary", etc).
   - 1 dense paragraph, English, <=80 words. No markdown, no lists.

2) SEEDREAM 4 (image, structured photoreal)
   - Comma-separated structured tags. Photorealism first.
   - Order: subject -> action -> wardrobe -> setting -> framing -> camera/lens -> lighting -> color -> style keywords -> quality tags ("highly detailed, 8k, photorealistic").
   - 1 line, English, <=60 tags. No sentences.

3) KLING 2.5 TURBO (video, motion from reference image)
   - The reference image is the first frame. Describe ONLY the motion, camera move, timing, and emotional beat over 5s. Do NOT redescribe the static scene.
   - Include: camera move (dolly-in / pan-left / handheld / static), subject action, facial micro-expression change, pacing ("slow 2s build, then sudden reveal at 3s"), atmosphere shift.
   - 1 short paragraph, English, <=60 words. No lists.

4) SEEDANCE 2.0 (video, motion arc + mood)
   - Cinematic motion arc. Describe the emotional/visual trajectory across the clip.
   - Include: opening beat -> middle beat -> closing beat, camera language, rhythm of cuts or pushes, color/light evolution.
   - 1 paragraph, English, <=70 words.

Return ONLY a raw JSON object with exactly these 4 keys: nano_banana, seedream, kling, seedance. No preamble, no markdown fences, no code block. Each value must be a non-empty string. All prompts in English -- Higgsfield performs better in English even for Spanish ads.`;

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
          scene.prompt_nano_banana &&
          scene.prompt_seedream &&
          scene.prompt_kling &&
          scene.prompt_seedance
        ) {
          return new Response(
            JSON.stringify({
              ok: true,
              cached: true,
              costUsd: 0,
              prompts: {
                nano_banana: scene.prompt_nano_banana,
                seedream: scene.prompt_seedream,
                kling: scene.prompt_kling,
                seedance: scene.prompt_seedance,
              } satisfies Prompts,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        const { data: variation } = await sb
          .from("variations")
          .select("id, type, label, project_id")
          .eq("id", scene.variation_id)
          .maybeSingle();

        let productInfo = "";
        let analysisExcerpt = "";
        if (variation?.project_id) {
          const { data: project } = await sb
            .from("projects")
            .select("product_name, product_one_liner, product_price, product_audience, analysis_text")
            .eq("id", variation.project_id)
            .maybeSingle();
          if (project) {
            const parts = [
              project.product_name && `Product: ${project.product_name}`,
              project.product_one_liner && `One-liner: ${project.product_one_liner}`,
              project.product_price && `Price: ${project.product_price}`,
              project.product_audience && `Audience: ${project.product_audience}`,
            ].filter(Boolean);
            productInfo = parts.join("\n");
            if (project.analysis_text) analysisExcerpt = project.analysis_text.slice(0, 1500);
          }
        }

        const userMsg = [
          variation && `Variation: ${variation.type} -- "${variation.label}"`,
          `Scene order: ${scene.order_idx}${scene.title ? ` -- ${scene.title}` : ""}`,
          scene.reference_frame_time_sec != null &&
            `Reference frame at: ${scene.reference_frame_time_sec}s of the source ad`,
          scene.scene_text && `=== SCENE BEAT ===\n${scene.scene_text}`,
          scene.script_es && `=== SPOKEN LINE (Spanish) ===\n${scene.script_es}`,
          scene.screen_text && `=== SCREEN TEXT ===\n${scene.screen_text}`,
          scene.image_prompt_en && `=== ORIGINAL IMAGE PROMPT (rewrite/enrich) ===\n${scene.image_prompt_en}`,
          scene.animation_prompt_en &&
            `=== ORIGINAL ANIMATION PROMPT (rewrite/enrich) ===\n${scene.animation_prompt_en}`,
          productInfo && `=== PRODUCT CONTEXT ===\n${productInfo}`,
          analysisExcerpt && `=== ANALYSIS EXCERPT ===\n${analysisExcerpt}`,
          `Return ONLY the JSON with keys nano_banana, seedream, kling, seedance.`,
        ]
          .filter(Boolean)
          .join("\n\n");

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
            messages: [{ role: "user", content: userMsg }],
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
            typeof obj.nano_banana !== "string" ||
            typeof obj.seedream !== "string" ||
            typeof obj.kling !== "string" ||
            typeof obj.seedance !== "string" ||
            !obj.nano_banana.trim() ||
            !obj.seedream.trim() ||
            !obj.kling.trim() ||
            !obj.seedance.trim()
          ) {
            return new Response("Incomplete prompts in response", { status: 502 });
          }
          prompts = {
            nano_banana: obj.nano_banana.trim(),
            seedream: obj.seedream.trim(),
            kling: obj.kling.trim(),
            seedance: obj.seedance.trim(),
          };
        } catch {
          return new Response("Malformed JSON in response", { status: 502 });
        }

        await sb
          .from("variation_scenes")
          .update({
            prompt_nano_banana: prompts.nano_banana,
            prompt_seedream: prompts.seedream,
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
