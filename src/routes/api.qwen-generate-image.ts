import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

const QWEN_COST_USD = 0.04;
const ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

type Body = {
  sceneId: string;
  workspaceId: string;
  promptEn: string;
  size?: "1024*1024" | "928*1664" | "1280*720";
  useI2I?: boolean;
  referenceFrameDataUrl?: string | null;
};

type QwenResponse = {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ image?: string; text?: string }>;
      };
    }>;
  };
  usage?: { image_count?: number };
  code?: string;
  message?: string;
};

function extToMime(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export const Route = createFileRoute("/api/qwen-generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          return new Response("DASHSCOPE_API_KEY not configured", { status: 500 });
        }

        // Auth
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice(7);

        const userClient = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false } },
        );
        const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = claims.claims.sub;

        const cap = await checkSpendingCap(userClient, userId);
        if (!cap.ok) return capExceededResponse(cap);

        const body = (await request.json()) as Body;
        if (!body.sceneId || !body.workspaceId || !body.promptEn) {
          return new Response("Missing fields: sceneId, workspaceId, promptEn", { status: 400 });
        }
        const size = body.size || "928*1664";
        const useI2I = !!body.useI2I && !!body.referenceFrameDataUrl;

        // Build upstream payload
        const userContent = useI2I
          ? [
              { image: body.referenceFrameDataUrl as string },
              {
                text:
                  body.promptEn +
                  "\n\nReplicate the exact composition of the reference image but apply the description above.",
              },
            ]
          : [{ text: body.promptEn }];

        const upstream = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen-image-max",
            input: { messages: [{ role: "user", content: userContent }] },
            parameters: { size },
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(
            `DashScope ${upstream.status}: ${errText.slice(0, 500)}`,
            { status: 502 },
          );
        }

        const json = (await upstream.json()) as QwenResponse;
        const imageUrl = json.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image;
        if (!imageUrl) {
          return new Response(
            `DashScope returned no image. code=${json.code ?? "?"} msg=${(json.message ?? "").slice(0, 200)}`,
            { status: 502 },
          );
        }

        // Download binary from temp URL
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
          return new Response(`Failed to fetch generated image (${imgRes.status})`, { status: 502 });
        }
        const contentType = imgRes.headers.get("content-type") || "image/png";
        const ext = contentType.includes("jpeg")
          ? "jpg"
          : contentType.includes("webp")
            ? "webp"
            : "png";
        const arrayBuf = await imgRes.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);

        // Persist to Supabase storage with admin client
        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );

        const storagePath = `${userId}/${body.sceneId}_${Date.now()}.${ext}`;
        const { error: upErr } = await admin.storage
          .from("generated-images")
          .upload(storagePath, bytes, {
            contentType: extToMime(ext),
            upsert: false,
          });
        if (upErr) {
          return new Response(`Storage upload failed: ${upErr.message}`, { status: 502 });
        }

        // Signed URL valid 7 days for client display (bucket is private)
        const { data: signed } = await admin.storage
          .from("generated-images")
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
        const finalUrl = signed?.signedUrl ?? null;

        // Insert image_generations row
        const { data: imageRow, error: insErr } = await admin
          .from("image_generations")
          .insert({
            workspace_id: body.workspaceId,
            user_id: userId,
            scene_id: body.sceneId,
            prompt: body.promptEn,
            size,
            use_i2i: useI2I,
            reference_url: useI2I ? "ref_frame_inline" : null,
            storage_path: storagePath,
            public_url: finalUrl,
            provider: "qwen",
            status: "done",
            cost_usd: QWEN_COST_USD,
          } as never)
          .select("id")
          .single();
        if (insErr || !imageRow) {
          return new Response(`DB insert failed: ${insErr?.message ?? "unknown"}`, { status: 502 });
        }

        // Link to scene
        await admin
          .from("variation_scenes")
          .update({ generated_image_id: imageRow.id } as never)
          .eq("id", body.sceneId);

        // Log usage → triggers cost aggregation
        await admin.from("api_usage").insert({
          user_id: userId,
          workspace_id: body.workspaceId,
          provider: "dashscope",
          model: "qwen-image-max",
          operation: "qwen_image_generation",
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: QWEN_COST_USD,
          metadata: { sceneId: body.sceneId, useI2I, size },
        } as never);

        return Response.json({
          ok: true,
          imageId: imageRow.id,
          imageUrl: finalUrl,
          storagePath,
          costUsd: QWEN_COST_USD,
        });
      },
    },
  },
});
