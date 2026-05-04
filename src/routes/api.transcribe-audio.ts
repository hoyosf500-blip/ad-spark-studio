import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { checkSpendingCap, capExceededResponse } from "@/lib/spending-cap";
import type { Database } from "@/integrations/supabase/types";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB (Whisper limit)
const PRICE_PER_MIN = 0.006;

function adminClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export const Route = createFileRoute("/api/transcribe-audio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return new Response(
            "OPENAI_API_KEY not configured. Note: OpenRouter does not support audio transcription endpoints. You need a separate OpenAI API key for Whisper audio transcription, or configure an alternative STT provider (Google Speech, AssemblyAI, Deepgram).",
            { status: 500 },
          );
        }

        // Auth
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = authHeader.slice(7);
        // Pass user JWT so checkSpendingCap can read profiles under RLS as the
        // calling user (otherwise daily_cap_usd silently defaults to $20).
        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub;

        const cap = await checkSpendingCap(supabase, userId, "api.transcribe-audio");
        if (!cap.ok) return capExceededResponse(cap);
        const reservedUsd = cap.reservedUsd;

        // Helper: reconcile the daily-spend reservation with the actual cost.
        // Whisper bypasses logUsage (different pricing model — per-minute, not
        // per-token), so we settle the cap manually via reconcile_daily_spend.
        // diff = actualCost - reservedUsd; can be negative when actual < reserved
        // (refund the slack), or = -reservedUsd to fully release on upstream
        // failure. Errors 42883 / PGRST202 are silent (legacy DB w/o RPC).
        const reconcileSpend = async (actualCost: number) => {
          try {
            const sb = adminClient();
            const diff = actualCost - reservedUsd;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (sb.rpc as any)("reconcile_daily_spend", {
              p_user_id: userId,
              p_diff_usd: diff,
            });
            if (error) {
              const code = (error as { code?: string }).code;
              if (code !== "42883" && code !== "PGRST202") {
                console.error("[transcribe-audio] reconcile_daily_spend failed:", error);
              }
            }
          } catch (e) {
            console.warn("[transcribe-audio] reconcile failed:", e instanceof Error ? e.message : e);
          }
        };

        // Parse multipart
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          await reconcileSpend(0);
          return new Response("Invalid form data", { status: 400 });
        }
        const file = form.get("file");
        const workspaceId = (form.get("workspaceId") as string | null) ?? null;
        const durationSecRaw = form.get("durationSec");
        const durationSec =
          typeof durationSecRaw === "string" && durationSecRaw.length > 0
            ? Number(durationSecRaw)
            : null;

        if (!(file instanceof File)) {
          await reconcileSpend(0);
          return new Response("file required", { status: 400 });
        }
        const ftype = file.type || "";
        if (!ftype.startsWith("video/") && !ftype.startsWith("audio/")) {
          await reconcileSpend(0);
          return new Response("file must be video/* or audio/*", { status: 400 });
        }
        if (file.size > MAX_BYTES) {
          await reconcileSpend(0);
          return new Response(
            "Video supera 25 MB. Comprime o recorta antes de subir.",
            { status: 413 },
          );
        }

        // Forward to OpenAI Whisper
        const fd = new FormData();
        fd.append("file", file, file.name || "video.mp4");
        fd.append("model", "whisper-1");
        fd.append("language", "es");
        fd.append("temperature", "0");
        fd.append("response_format", "json");

        const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: fd,
        });
        if (!upstream.ok) {
          const t = await upstream.text().catch(() => "");
          await reconcileSpend(0);
          return new Response(`OpenAI ${upstream.status}: ${t.slice(0, 300)}`, { status: 502 });
        }
        const json = (await upstream.json()) as { text?: string };
        const text = (json.text ?? "").trim();

        // Cost: prefer durationSec from client; fallback to size proxy.
        const durMin =
          durationSec && Number.isFinite(durationSec) && durationSec > 0
            ? durationSec / 60
            : Math.max(0.1, file.size / (1024 * 1024) / 1.5);
        const costUsd = durMin * PRICE_PER_MIN;

        // Log usage (best-effort)
        try {
          const sb = adminClient();
          await sb.from("api_usage").insert({
            user_id: userId,
            workspace_id: workspaceId,
            provider: "openai",
            model: "whisper-1",
            operation: "audio_transcription",
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: costUsd,
            metadata: {
              duration_sec: durationSec,
              file_size: file.size,
              file_type: ftype,
            },
          } as never);
        } catch (e) {
          console.warn("api_usage insert failed:", e instanceof Error ? e.message : e);
        }
        // Reconcile the cap reservation with the actual Whisper cost (typically
        // $0.006/min, well under the $0.30 reserved). Refunds the slack so the
        // user's daily cap reflects real spend, not the over-conservative reserve.
        await reconcileSpend(costUsd);

        return new Response(
          JSON.stringify({ text, costUsd, durationSec: durationSec ?? null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
