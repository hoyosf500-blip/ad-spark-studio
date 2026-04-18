import { createFileRoute } from "@tanstack/react-router";
import { authenticateRequest, createDashscopeTask } from "@/lib/dashscope-async";

type Body = {
  workspaceId: string;
  imageUrl: string;
  promptEn: string;
  sceneId?: string | null;
  ugcId?: string | null;
  size?: string;
  duration?: number;
};

export const Route = createFileRoute("/api/kling-create-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateRequest(request);
        if (!auth.ok) return new Response(auth.error, { status: auth.status });

        const body = (await request.json()) as Body;
        if (!body.workspaceId || !body.imageUrl || !body.promptEn) {
          return new Response("Missing fields: workspaceId, imageUrl, promptEn", { status: 400 });
        }
        const result = await createDashscopeTask({
          modelKey: "kling2.5-turbo",
          userId: auth.userId,
          workspaceId: body.workspaceId,
          imageUrl: body.imageUrl,
          promptEn: body.promptEn,
          size: body.size,
          duration: body.duration,
          sceneId: body.sceneId ?? null,
          ugcId: body.ugcId ?? null,
        });
        if (!result.ok) return new Response(result.error, { status: result.status });
        return Response.json({ ok: true, taskId: result.taskId, externalTaskId: result.externalTaskId });
      },
    },
  },
});
