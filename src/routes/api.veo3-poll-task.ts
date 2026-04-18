import { createFileRoute } from "@tanstack/react-router";
import { authenticateRequest, pollDashscopeTask } from "@/lib/dashscope-async";

export const Route = createFileRoute("/api/veo3-poll-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateRequest(request);
        if (!auth.ok) return new Response(auth.error, { status: auth.status });
        const { taskId } = (await request.json()) as { taskId: string };
        if (!taskId) return new Response("Missing taskId", { status: 400 });
        const r = await pollDashscopeTask({ taskId, userId: auth.userId, modelKey: "veo3" });
        if (!r.ok) return new Response(r.error, { status: r.status });
        return Response.json(r.result);
      },
    },
  },
});
