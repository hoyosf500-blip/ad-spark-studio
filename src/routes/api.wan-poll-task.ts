import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const WAN_COST_USD = 0.3;

type Body = { taskId: string };

type WanPollResponse = {
  output?: {
    task_id?: string;
    task_status?: string; // PENDING | RUNNING | SUCCEEDED | FAILED | UNKNOWN
    video_url?: string;
    message?: string;
    code?: string;
  };
  code?: string;
  message?: string;
};

export const Route = createFileRoute("/api/wan-poll-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          return new Response("DASHSCOPE_API_KEY not configured", { status: 500 });
        }

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

        const body = (await request.json()) as Body;
        if (!body.taskId) return new Response("Missing taskId", { status: 400 });

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );

        const { data: task, error: taskErr } = await admin
          .from("async_tasks")
          .select("*")
          .eq("id", body.taskId)
          .eq("user_id", userId)
          .maybeSingle();

        if (taskErr || !task) {
          return new Response("Task not found", { status: 404 });
        }

        const startedAt = new Date(task.started_at ?? task.created_at).getTime();
        const elapsedMs = Date.now() - startedAt;

        // Cached terminal states
        if (task.status === "done") {
          const result = (task.result ?? {}) as { videoId?: string; publicUrl?: string };
          return Response.json({
            status: "done",
            videoUrl: result.publicUrl ?? null,
            videoId: result.videoId ?? null,
            costUsd: WAN_COST_USD,
            elapsedMs,
          });
        }
        if (task.status === "failed") {
          const result = (task.result ?? {}) as { error?: string };
          return Response.json({
            status: "failed",
            error: result.error ?? "unknown",
            elapsedMs,
          });
        }

        const externalId = task.external_task_id;
        if (!externalId) {
          return new Response("Task missing external id", { status: 500 });
        }

        const pollRes = await fetch(
          `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(externalId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!pollRes.ok) {
          const t = await pollRes.text();
          return new Response(`DashScope ${pollRes.status}: ${t.slice(0, 300)}`, {
            status: 502,
          });
        }
        const json = (await pollRes.json()) as WanPollResponse;
        const status = (json.output?.task_status || "UNKNOWN").toUpperCase();

        if (status === "PENDING" || status === "RUNNING") {
          await admin
            .from("async_tasks")
            .update({ status: "running", updated_at: new Date().toISOString() } as never)
            .eq("id", task.id);
          return Response.json({ status: "running", elapsedMs });
        }

        if (status === "SUCCEEDED") {
          const videoUrl = json.output?.video_url;
          if (!videoUrl) {
            await admin
              .from("async_tasks")
              .update({
                status: "failed",
                result: { error: "No video_url in SUCCEEDED response" },
                completed_at: new Date().toISOString(),
              } as never)
              .eq("id", task.id);
            return Response.json({ status: "failed", error: "No video_url returned" });
          }

          const payload = (task.payload ?? {}) as {
            sceneId?: string;
            duration?: number;
            size?: string;
            promptEn?: string;
          };
          const sceneId = payload.sceneId ?? task.related_scene_id ?? null;
          const duration = payload.duration ?? 5;
          const size = payload.size ?? "720*1280";

          // Download mp4 from temp URL
          const dl = await fetch(videoUrl);
          if (!dl.ok) {
            return new Response(`Failed to download video (${dl.status})`, { status: 502 });
          }
          const bytes = new Uint8Array(await dl.arrayBuffer());

          const storagePath = `${userId}/${sceneId ?? task.id}_${Date.now()}.mp4`;
          const { error: upErr } = await admin.storage
            .from("generated-videos")
            .upload(storagePath, bytes, { contentType: "video/mp4", upsert: false });
          if (upErr) {
            return new Response(`Storage upload failed: ${upErr.message}`, { status: 502 });
          }
          const { data: signed } = await admin.storage
            .from("generated-videos")
            .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
          const finalUrl = signed?.signedUrl ?? null;

          const { data: videoRow, error: vgErr } = await admin
            .from("video_generations")
            .insert({
              workspace_id: task.workspace_id,
              user_id: userId,
              scene_id: sceneId,
              provider: "wan",
              prompt: payload.promptEn ?? null,
              task_id: externalId,
              storage_path: storagePath,
              public_url: finalUrl,
              external_url: videoUrl,
              size,
              duration_seconds: duration,
              cost_usd: WAN_COST_USD,
              status: "done",
            } as never)
            .select("id")
            .single();
          if (vgErr || !videoRow) {
            return new Response(`DB insert failed: ${vgErr?.message ?? "unknown"}`, {
              status: 502,
            });
          }

          if (sceneId) {
            await admin
              .from("variation_scenes")
              .update({ generated_video_id: videoRow.id } as never)
              .eq("id", sceneId);
          }

          await admin
            .from("async_tasks")
            .update({
              status: "done",
              result: { videoId: videoRow.id, publicUrl: finalUrl, storagePath },
              completed_at: new Date().toISOString(),
            } as never)
            .eq("id", task.id);

          await admin.from("api_usage").insert({
            user_id: userId,
            workspace_id: task.workspace_id,
            provider: "dashscope",
            model: "wan2.6-i2v",
            operation: "wan_video_generation",
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: WAN_COST_USD,
            metadata: { sceneId, duration, size, externalTaskId: externalId },
          } as never);

          return Response.json({
            status: "done",
            videoUrl: finalUrl,
            videoId: videoRow.id,
            costUsd: WAN_COST_USD,
            elapsedMs,
          });
        }

        // FAILED / UNKNOWN
        const errMsg = json.output?.message ?? json.message ?? `status=${status}`;
        await admin
          .from("async_tasks")
          .update({
            status: "failed",
            result: { error: errMsg },
            completed_at: new Date().toISOString(),
          } as never)
          .eq("id", task.id);
        return Response.json({ status: "failed", error: errMsg, elapsedMs });
      },
    },
  },
});
