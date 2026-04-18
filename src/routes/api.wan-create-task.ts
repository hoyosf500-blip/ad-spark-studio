import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";

type Body = {
  sceneId: string;
  workspaceId: string;
  imageUrl: string;
  promptEn: string;
  size?: string;
  duration?: number;
};

type WanSubmitResponse = {
  output?: { task_id?: string; task_status?: string };
  code?: string;
  message?: string;
  request_id?: string;
};

export const Route = createFileRoute("/api/wan-create-task")({
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
        if (!body.sceneId || !body.workspaceId || !body.imageUrl || !body.promptEn) {
          return new Response("Missing fields: sceneId, workspaceId, imageUrl, promptEn", {
            status: 400,
          });
        }
        const size = body.size || "720*1280";
        const duration = body.duration || 5;

        const upstream = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-DashScope-Async": "enable",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "wan2.6-i2v",
            input: { img_url: body.imageUrl, prompt: body.promptEn },
            parameters: { size, duration },
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(
            `DashScope ${upstream.status}: ${errText.slice(0, 500)}`,
            { status: 502 },
          );
        }

        const json = (await upstream.json()) as WanSubmitResponse;
        const externalTaskId = json.output?.task_id;
        if (!externalTaskId) {
          return new Response(
            `DashScope returned no task_id. code=${json.code ?? "?"} msg=${(json.message ?? "").slice(0, 200)}`,
            { status: 502 },
          );
        }

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );

        const { data: taskRow, error: insErr } = await admin
          .from("async_tasks")
          .insert({
            workspace_id: body.workspaceId,
            user_id: userId,
            task_type: "wan_i2v",
            external_task_id: externalTaskId,
            status: "pending",
            payload: {
              sceneId: body.sceneId,
              imageUrl: body.imageUrl,
              promptEn: body.promptEn,
              size,
              duration,
              model: "wan2.6-i2v",
              provider: "dashscope",
            },
            related_scene_id: body.sceneId,
          } as never)
          .select("id")
          .single();

        if (insErr || !taskRow) {
          return new Response(`DB insert failed: ${insErr?.message ?? "unknown"}`, {
            status: 502,
          });
        }

        return Response.json({
          ok: true,
          taskId: taskRow.id,
          externalTaskId,
        });
      },
    },
  },
});
