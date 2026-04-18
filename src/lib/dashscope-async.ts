// Shared helpers for DashScope async video generation (Wan, Kling, Veo3).
// Keeps the per-model file routes tiny by centralizing the create-task and
// poll-task logic. Each model differs only in: model id, task_type, cost.

import { createClient } from "@supabase/supabase-js";
import { checkSpendingCap } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

export const VIDEO_MODELS = {
  "wan2.6-i2v": { dashscopeModel: "wan2.6-i2v", taskType: "wan_i2v", costUsd: 0.3 },
  "kling2.5-turbo": { dashscopeModel: "kling-v2.5-turbo-i2v", taskType: "kling_i2v", costUsd: 0.4 },
  "veo3": { dashscopeModel: "wanx-veo-3-i2v", taskType: "veo3_i2v", costUsd: 0.75 },
} as const;

export type VideoModelKey = keyof typeof VIDEO_MODELS;

const SUBMIT_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";

export type CreateTaskInput = {
  modelKey: VideoModelKey;
  userId: string;
  workspaceId: string;
  imageUrl: string;
  promptEn: string;
  size?: string;
  duration?: number;
  // Optional links — at least one is recommended for back-references
  sceneId?: string | null;
  ugcId?: string | null;
};

export async function createDashscopeTask(input: CreateTaskInput): Promise<
  | { ok: true; taskId: string; externalTaskId: string }
  | { ok: false; status: number; error: string }
> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return { ok: false, status: 500, error: "DASHSCOPE_API_KEY not configured" };

  const cfg = VIDEO_MODELS[input.modelKey];
  const size = input.size || "720*1280";
  const duration = input.duration || 5;

  const upstream = await fetch(SUBMIT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.dashscopeModel,
      input: { img_url: input.imageUrl, prompt: input.promptEn },
      parameters: { size, duration },
    }),
  });
  if (!upstream.ok) {
    const t = await upstream.text();
    return { ok: false, status: 502, error: `DashScope ${upstream.status}: ${t.slice(0, 500)}` };
  }
  const json = (await upstream.json()) as {
    output?: { task_id?: string };
    code?: string;
    message?: string;
  };
  const externalTaskId = json.output?.task_id;
  if (!externalTaskId) {
    return {
      ok: false,
      status: 502,
      error: `DashScope no task_id. code=${json.code ?? "?"} msg=${(json.message ?? "").slice(0, 200)}`,
    };
  }

  const admin = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: row, error } = await admin
    .from("async_tasks")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      task_type: cfg.taskType,
      external_task_id: externalTaskId,
      status: "pending",
      payload: {
        sceneId: input.sceneId ?? null,
        ugcId: input.ugcId ?? null,
        imageUrl: input.imageUrl,
        promptEn: input.promptEn,
        size,
        duration,
        model: cfg.dashscopeModel,
        modelKey: input.modelKey,
        provider: "dashscope",
      },
      related_scene_id: input.sceneId ?? null,
    } as never)
    .select("id")
    .single();
  if (error || !row) {
    return { ok: false, status: 502, error: `DB insert failed: ${error?.message ?? "unknown"}` };
  }
  return { ok: true, taskId: row.id, externalTaskId };
}

export type PollTaskOutput =
  | { status: "running"; elapsedMs: number }
  | { status: "done"; videoUrl: string | null; videoId: string | null; costUsd: number; elapsedMs: number }
  | { status: "failed"; error: string; elapsedMs: number };

export async function pollDashscopeTask(opts: {
  taskId: string;
  userId: string;
  modelKey: VideoModelKey;
}): Promise<{ ok: true; result: PollTaskOutput } | { ok: false; status: number; error: string }> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return { ok: false, status: 500, error: "DASHSCOPE_API_KEY not configured" };

  const cfg = VIDEO_MODELS[opts.modelKey];
  const admin = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: task, error: taskErr } = await admin
    .from("async_tasks")
    .select("*")
    .eq("id", opts.taskId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (taskErr || !task) return { ok: false, status: 404, error: "Task not found" };

  const startedAt = new Date(task.started_at ?? task.created_at).getTime();
  const elapsedMs = Date.now() - startedAt;

  if (task.status === "done") {
    const r = (task.result ?? {}) as { videoId?: string; publicUrl?: string };
    return {
      ok: true,
      result: {
        status: "done",
        videoUrl: r.publicUrl ?? null,
        videoId: r.videoId ?? null,
        costUsd: cfg.costUsd,
        elapsedMs,
      },
    };
  }
  if (task.status === "failed") {
    const r = (task.result ?? {}) as { error?: string };
    return { ok: true, result: { status: "failed", error: r.error ?? "unknown", elapsedMs } };
  }

  const externalId = task.external_task_id;
  if (!externalId) return { ok: false, status: 500, error: "Task missing external id" };

  const pollRes = await fetch(
    `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(externalId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!pollRes.ok) {
    const t = await pollRes.text();
    return { ok: false, status: 502, error: `DashScope ${pollRes.status}: ${t.slice(0, 300)}` };
  }
  const json = (await pollRes.json()) as {
    output?: { task_status?: string; video_url?: string; message?: string };
    message?: string;
  };
  const status = (json.output?.task_status || "UNKNOWN").toUpperCase();

  if (status === "PENDING" || status === "RUNNING") {
    await admin
      .from("async_tasks")
      .update({ status: "running", updated_at: new Date().toISOString() } as never)
      .eq("id", task.id);
    return { ok: true, result: { status: "running", elapsedMs } };
  }

  if (status === "SUCCEEDED") {
    const videoUrl = json.output?.video_url;
    if (!videoUrl) {
      await admin
        .from("async_tasks")
        .update({
          status: "failed",
          result: { error: "No video_url in SUCCEEDED" },
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id", task.id);
      return { ok: true, result: { status: "failed", error: "No video_url returned", elapsedMs } };
    }

    const payload = (task.payload ?? {}) as {
      sceneId?: string | null;
      ugcId?: string | null;
      duration?: number;
      size?: string;
      promptEn?: string;
    };
    const sceneId = payload.sceneId ?? task.related_scene_id ?? null;
    const ugcId = payload.ugcId ?? null;
    const duration = payload.duration ?? 5;
    const size = payload.size ?? "720*1280";

    const dl = await fetch(videoUrl);
    if (!dl.ok) return { ok: false, status: 502, error: `Failed to download video (${dl.status})` };
    const bytes = new Uint8Array(await dl.arrayBuffer());

    const storagePath = `${opts.userId}/${sceneId ?? ugcId ?? task.id}_${Date.now()}.mp4`;
    const { error: upErr } = await admin.storage
      .from("generated-videos")
      .upload(storagePath, bytes, { contentType: "video/mp4", upsert: false });
    if (upErr) return { ok: false, status: 502, error: `Storage upload failed: ${upErr.message}` };
    const { data: signed } = await admin.storage
      .from("generated-videos")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    const finalUrl = signed?.signedUrl ?? null;

    const { data: videoRow, error: vgErr } = await admin
      .from("video_generations")
      .insert({
        workspace_id: task.workspace_id,
        user_id: opts.userId,
        scene_id: sceneId,
        provider: opts.modelKey,
        prompt: payload.promptEn ?? null,
        task_id: externalId,
        storage_path: storagePath,
        public_url: finalUrl,
        external_url: videoUrl,
        size,
        duration_seconds: duration,
        cost_usd: cfg.costUsd,
        status: "done",
      } as never)
      .select("id")
      .single();
    if (vgErr || !videoRow) {
      return { ok: false, status: 502, error: `DB insert failed: ${vgErr?.message ?? "unknown"}` };
    }

    if (sceneId) {
      await admin
        .from("variation_scenes")
        .update({ generated_video_id: videoRow.id } as never)
        .eq("id", sceneId);
    }
    if (ugcId) {
      const { data: ugcRow } = await admin
        .from("ugc_generations")
        .select("cost_usd")
        .eq("id", ugcId)
        .maybeSingle();
      const prev = Number(ugcRow?.cost_usd ?? 0);
      await admin
        .from("ugc_generations")
        .update({
          video_generation_id: videoRow.id,
          cost_usd: prev + cfg.costUsd,
        } as never)
        .eq("id", ugcId);
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
      user_id: opts.userId,
      workspace_id: task.workspace_id,
      provider: "dashscope",
      model: cfg.dashscopeModel,
      operation: `${opts.modelKey}_video_generation`,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: cfg.costUsd,
      metadata: { sceneId, ugcId, duration, size, externalTaskId: externalId },
    } as never);

    return {
      ok: true,
      result: {
        status: "done",
        videoUrl: finalUrl,
        videoId: videoRow.id,
        costUsd: cfg.costUsd,
        elapsedMs,
      },
    };
  }

  const errMsg = json.output?.message ?? json.message ?? `status=${status}`;
  await admin
    .from("async_tasks")
    .update({
      status: "failed",
      result: { error: errMsg },
      completed_at: new Date().toISOString(),
    } as never)
    .eq("id", task.id);
  return { ok: true, result: { status: "failed", error: errMsg, elapsedMs } };
}

export async function authenticateRequest(
  request: Request,
): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }
> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return { ok: false, status: 401, error: "Unauthorized" };
  const token = authHeader.slice(7);
  const sb = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: claims, error } = await sb.auth.getClaims(token);
  if (error || !claims?.claims?.sub) return { ok: false, status: 401, error: "Unauthorized" };
  const userId = claims.claims.sub;

  const cap = await checkSpendingCap(sb, userId);
  if (!cap.ok) {
    // Devolvemos un error con status 429 y el JSON serializado para que el caller lo retorne tal cual.
    return {
      ok: false,
      status: 429,
      error: JSON.stringify({ error: cap.error, spentToday: cap.spentToday, cap: cap.cap }),
    };
  }

  return { ok: true, userId };
}
