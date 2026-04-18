import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SYS_ANALYZE } from "@/lib/system-prompts";
import type { Database } from "@/integrations/supabase/types";

// ─── pricing tables (USD per 1M tokens) ───────────────────────────────
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
};

export function priceFor(model: string) {
  return PRICING[model] ?? PRICING["claude-sonnet-4-6"];
}

export function calcCost(model: string, input: number, output: number) {
  const p = priceFor(model);
  return (input * p.input + output * p.output) / 1_000_000;
}

function adminClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

export async function logUsage(opts: {
  userId: string;
  workspaceId?: string | null;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  metadata?: Record<string, unknown>;
}) {
  const cost = calcCost(opts.model, opts.inputTokens, opts.outputTokens);
  const sb = adminClient();
  const row = {
    user_id: opts.userId,
    workspace_id: opts.workspaceId ?? null,
    provider: "anthropic",
    model: opts.model,
    operation: opts.operation,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cost_usd: cost,
    metadata: opts.metadata ?? {},
  };
  await sb.from("api_usage").insert(row as never);
  return cost;
}

type FrameInput = { time: number; dataUrl: string };
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export function dataUrlToBase64(dataUrl: string): { mediaType: string; b64: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return { mediaType: "image/jpeg", b64: dataUrl };
  return { mediaType: m[1], b64: m[2] };
}

function buildAnalyzeContent(opts: {
  frames: FrameInput[];
  productPhoto?: string | null;
  transcription?: string | null;
}): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  blocks.push({
    type: "text",
    text: `Analiza este video frame por frame. Recibes ${opts.frames.length} frames extraídos a 1fps.`,
  });
  opts.frames.forEach((f) => {
    const { mediaType, b64 } = dataUrlToBase64(f.dataUrl);
    blocks.push({
      type: "text",
      text: `\nFRAME ${Math.round(f.time)}s (timestamp ${f.time.toFixed(2)}s):`,
    });
    blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
  });
  if (opts.productPhoto) {
    const { mediaType, b64 } = dataUrlToBase64(opts.productPhoto);
    blocks.push({ type: "text", text: "\n\nFOTO DEL PRODUCTO (referencia adicional, no es un frame del video):" });
    blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: b64 } });
  }
  if (opts.transcription && opts.transcription.trim()) {
    blocks.push({
      type: "text",
      text: `\n\nTRANSCRIPCIÓN PROVISTA POR EL USUARIO (úsala como verdad, completa con tu lectura de frames):\n${opts.transcription.trim()}`,
    });
  }
  blocks.push({
    type: "text",
    text: "\n\nProduce el análisis completo siguiendo EXACTAMENTE el formato definido en tu role. No omitas frames. Termina con la sección final de transcripción consolidada.",
  });
  return blocks;
}

export const anthropicAnalyze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      frames: FrameInput[];
      productPhoto?: string | null;
      transcription?: string | null;
      model?: string;
      workspaceId?: string | null;
    }) => {
      if (!Array.isArray(input.frames) || input.frames.length === 0) throw new Error("frames is required (1+ items)");
      if (input.frames.length > 60) throw new Error("max 60 frames per request");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const model = data.model || "claude-sonnet-4-5-20250929";
    const userId = (context as { userId: string }).userId;

    const content = buildAnalyzeContent({
      frames: data.frames,
      productPhoto: data.productPhoto ?? null,
      transcription: data.transcription ?? null,
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: SYS_ANALYZE,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 500)}`);
    }

    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason?: string;
    };

    const text = body.content.filter((c) => c.type === "text").map((c) => c.text || "").join("");
    const usage = body.usage ?? { input_tokens: 0, output_tokens: 0 };
    const cost = await logUsage({
      userId,
      workspaceId: data.workspaceId ?? null,
      model,
      operation: "claude_analysis",
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      metadata: { frames: data.frames.length, hasProductPhoto: !!data.productPhoto },
    });

    return {
      ok: true,
      text,
      stopReason: body.stop_reason ?? null,
      isTruncated: body.stop_reason === "max_tokens",
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd: cost,
      model,
    };
  });
