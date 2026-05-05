import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Copy, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { handleCapResponse } from "@/lib/handle-cap";

const UGC_STYLES = [
  { key: "ugc-casual", emoji: "📱", label: "Casual dolor" },
  { key: "ugc-testimonial", emoji: "🗣️", label: "Testimonial" },
  { key: "ugc-viral", emoji: "🎯", label: "Hook viral" },
  { key: "ugc-unboxing", emoji: "📦", label: "Unboxing COD" },
] as const;

// Higgsfield video models — user generates videos manually on Higgsfield.ai.
// Backend key "wan2.6-i2v" kept because api.ugc-generate.ts already labels it "Seedance 2.0".
// "kling2.5-turbo" now means Kling 2.5 Turbo on Higgsfield.
const VIDEO_MODELS = [
  { key: "wan2.6-i2v", label: "Seedance 2.0" },
  { key: "kling2.5-turbo", label: "Kling 2.5 Turbo" },
] as const;

type StyleKey = (typeof UGC_STYLES)[number]["key"];
type ModelKey = (typeof VIDEO_MODELS)[number]["key"];

type UgcRow = {
  id: string;
  style: StyleKey;
  status: string;
  script_text: string | null;
  image_prompt_en: string | null;
  animation_prompt_en: string | null;
  video_model: string | null;
  cost_usd: number;
  data: Record<string, unknown>;
};

type StreamState = {
  active: StyleKey | null;
  text: string;
};

export function UgcPanel({
  workspaceId,
  projectId,
  sourceVideoId,
  analysisText,
  transcription,
  productInfo,
  creativeBrief,
  productPhoto,
  duration,
  model,
}: {
  workspaceId: string | null;
  projectId: string | null;
  sourceVideoId: string | null;
  analysisText: string;
  transcription: string;
  productInfo: string | null;
  creativeBrief?: string | null;
  productPhoto?: string | null;
  duration?: string;
  model: string;
}) {
  const [generations, setGenerations] = useState<UgcRow[]>([]);
  const [stream, setStream] = useState<StreamState>({ active: null, text: "" });
  const [videoModel, setVideoModel] = useState<ModelKey>("wan2.6-i2v");

  // Track in-flight SSE so unmount aborts the stream — otherwise navigating
  // away leaves the reader consuming bytes and `logUsage` still charges the
  // user for output they never see.
  const streamControllersRef = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const controllers = streamControllersRef.current;
    return () => {
      for (const c of controllers) {
        try { c.abort(); } catch { /* noop */ }
      }
      controllers.clear();
    };
  }, []);

  // Load existing UGC for this project
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      const q = supabase
        .from("ugc_generations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      const { data } = projectId
        ? await q.eq("source_project_id", projectId)
        : await q.limit(20);
      if (!cancelled && data) setGenerations(data as UgcRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, projectId]);

  // Realtime updates
  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`ugc-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ugc_generations", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setGenerations((prev) => [payload.new as UgcRow, ...prev.filter((r) => r.id !== (payload.new as UgcRow).id)]);
          } else if (payload.eventType === "UPDATE") {
            setGenerations((prev) => prev.map((r) => (r.id === (payload.new as UgcRow).id ? (payload.new as UgcRow) : r)));
          } else if (payload.eventType === "DELETE") {
            setGenerations((prev) => prev.filter((r) => r.id !== (payload.old as UgcRow).id));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  const generate = async (style: StyleKey) => {
    if (!workspaceId) {
      toast.error("Workspace no listo");
      return;
    }
    if (!analysisText && style !== "ugc-viral") {
      toast.error("Necesitas un análisis primero (ugc-viral es la excepción: no requiere análisis)");
      return;
    }
    setStream({ active: style, text: "" });
    const controller = new AbortController();
    streamControllersRef.current.add(controller);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");
      const res = await fetch("/api/ugc-generate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId,
          projectId,
          sourceVideoId,
          style,
          analysisText,
          transcription: transcription?.trim() || null,
          productInfo,
          creativeBrief: creativeBrief ?? null,
          productPhoto: productPhoto ?? null,
          duration: duration ?? "12",
          videoModel,
          model,
        }),
      });
      if (await handleCapResponse(res)) return;
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 200) || res.statusText}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let full = "";
      let cost = 0;
      let isTruncated = false;
      let streamCutEarly = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const dl = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!dl) continue;
            // Tight try/catch: only swallow JSON.parse failures. A wider catch
            // silenced the intentional `throw new Error(ev.error)` below, which
            // let upstream errors surface as silent toasts of success.
            let ev:
              | { type: "text"; text: string }
              | {
                  type: "done";
                  costUsd: number;
                  fullText: string;
                  isTruncated?: boolean;
                  inputTokens?: number;
                  outputTokens?: number;
                  cacheCreateTokens?: number;
                  cacheReadTokens?: number;
                  ugcId?: string | null;
                  persistError?: string | null;
                  scriptEs?: string | null;
                  imagePromptEn?: string | null;
                  animationPromptEn?: string | null;
                  hooks?: string[];
                }
              | { type: "error"; error: string };
            try {
              ev = JSON.parse(dl.slice(6).trim());
            } catch {
              continue;
            }
            if (ev.type === "text") {
              full += ev.text;
              setStream({ active: style, text: full });
            } else if (ev.type === "done") {
              cost = ev.costUsd;
              isTruncated = ev.isTruncated === true;
              // 2026-05-04: render the UGC from the done payload directly instead of
              // waiting for Supabase Realtime to push the INSERT. If the DB insert
              // fails (RLS, schema mismatch) or Realtime is not propagating, the
              // user previously saw an empty list after a successful generation —
              // charged credits, no visible output. The Realtime channel still
              // upserts on INSERT events; dedupe by id below avoids duplicates.
              if (ev.ugcId || ev.fullText) {
                const newRow: UgcRow = {
                  id: ev.ugcId ?? `local-${Date.now()}-${style}`,
                  style,
                  status: ev.persistError ? "ready_unsaved" : "ready",
                  script_text: ev.scriptEs ?? null,
                  image_prompt_en: ev.imagePromptEn ?? null,
                  animation_prompt_en: ev.animationPromptEn ?? null,
                  video_model: videoModel,
                  cost_usd: ev.costUsd,
                  data: { fullText: ev.fullText, hooks: ev.hooks ?? [] },
                };
                setGenerations((prev) => {
                  const filtered = prev.filter((r) => r.id !== newRow.id);
                  return [newRow, ...filtered];
                });
                if (ev.persistError) {
                  toast.warning(
                    `UGC ${style} generado pero no se guardó en la base: ${ev.persistError}`,
                    { duration: 8000 },
                  );
                }
              }
            } else if (ev.type === "error") {
              throw new Error(ev.error);
            }
          }
        }
      } catch (streamErr) {
        // Si ya tenemos texto sustancial, el backend probablemente persistió el UGC
        // antes de perder la conexión. La suscripción Realtime lo muestra igual.
        if (!full || full.length < 200) throw streamErr;
        streamCutEarly = true;
        console.warn(
          `[UgcPanel:${style}] Stream cortado tras ${full.length} chars — UGC debe estar en DB:`,
          streamErr,
        );
      }
      if (streamCutEarly) {
        toast.warning(`UGC ${style}: conexión cortada, pero el UGC debería aparecer en la lista en unos segundos`);
      } else if (isTruncated) {
        // El modelo cortó por max_tokens — el output puede estar incompleto
        // (PROMPT/HOOKS recortados). Surface al usuario en lugar de fingir éxito.
        toast.warning(
          `UGC ${style} truncado · $${cost.toFixed(4)} · revisar output, puede faltar contenido`,
          { duration: 8000 },
        );
      } else {
        toast.success(`UGC ${style} listo · $${cost.toFixed(4)}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error generando UGC");
    } finally {
      setStream({ active: null, text: "" });
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-mono-display text-lg font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> 4. UGC Generator
          </h2>
          <p className="text-xs text-muted-foreground">
            Testimonios reales · 4 estilos · scripts + prompts optimizados para Higgsfield ({VIDEO_MODELS.find((m) => m.key === videoModel)?.label})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Modelo video</span>
          <Select value={videoModel} onValueChange={(v) => setVideoModel(v as ModelKey)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_MODELS.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {UGC_STYLES.map((s) => {
          const active = stream.active === s.key;
          const needsAnalysis = s.key !== "ugc-viral";
          const blocked = !!stream.active || (needsAnalysis && !analysisText);
          return (
            <Button
              key={s.key}
              onClick={() => generate(s.key)}
              disabled={blocked}
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-1 hover:border-primary"
              title={needsAnalysis && !analysisText ? "Selecciona un proyecto con análisis primero" : undefined}
            >
              <span className="text-xl">{s.emoji}</span>
              <span className="text-xs font-mono-display">{s.label}</span>
              {active && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            </Button>
          );
        })}
      </div>

      {stream.active && stream.text && (() => {
        // Cada call genera UN solo UGC con dos secciones: PROMPT: (paragraph
        // largo) y HOOKS: (5 líneas). Estimamos progreso por:
        //   - PROMPT: emitido    → 50%
        //   - HOOKS: emitido     → 90%
        //   - Tamaño del cuerpo  → relleno fino entre los dos hitos
        // Antes el regex buscaba `UGC|ESTILO|STYLE` que no aparecen nunca en
        // el output → la barra se quedaba en 1% durante todo el stream.
        const hasPrompt = /\bPROMPT:/i.test(stream.text);
        const hasHooks = /\bHOOKS:/i.test(stream.text);
        const lengthPct = Math.min(40, Math.round(stream.text.length / 50));
        const milestonePct = (hasPrompt ? 50 : 0) + (hasHooks ? 40 : 0);
        const pct = Math.max(1, Math.min(99, milestonePct + (hasPrompt ? 0 : lengthPct)));
        return (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-primary mb-1">
              <span>Generando {stream.active}…</span>
              <span>{pct}%</span>
            </div>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed max-h-48 overflow-auto text-muted-foreground">
              {stream.text}
            </pre>
          </div>
        );
      })()}

      {generations.length > 0 && (
        <div className="space-y-3">
          {generations.map((g) => (
            <UgcRowCard key={g.id} row={g} />
          ))}
        </div>
      )}
    </Card>
  );
}

function UgcRowCard({ row }: { row: UgcRow }) {
  const styleMeta = UGC_STYLES.find((s) => s.key === row.style);
  const targetLabel = VIDEO_MODELS.find((m) => m.key === row.video_model)?.label;

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-base">{styleMeta?.emoji}</span>
          <span className="font-mono-display text-sm font-bold">{styleMeta?.label}</span>
          {targetLabel && (
            <Badge variant="outline" className="text-[10px]">{targetLabel}</Badge>
          )}
        </div>
        <Badge variant="outline" className="border-success/40 text-success text-[10px]">
          <CheckCircle2 className="h-3 w-3 mr-1" /> ${Number(row.cost_usd ?? 0).toFixed(4)}
        </Badge>
      </div>

      <div className="p-4 space-y-3">
        {row.script_text && (
          <PromptBlock label="Script (ES)" text={row.script_text} />
        )}
        {row.image_prompt_en && (
          <PromptBlock
            label="Image prompt (EN)"
            hint="Pegalo en Nano Banana Pro o Seedream 4 (Higgsfield)."
            text={row.image_prompt_en}
            mono
          />
        )}
        {row.animation_prompt_en && (
          <PromptBlock
            label="Animation prompt (EN)"
            hint={`Pegalo en ${targetLabel ?? "Kling 2.5 Turbo / Seedance 2.0"} (Higgsfield). Adjuntá la imagen como primer frame.`}
            text={row.animation_prompt_en}
            mono
          />
        )}
      </div>
    </div>
  );
}

function PromptBlock({ label, hint, text, mono }: { label: string; hint?: string; text: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  return (
    <div className="space-y-1.5 rounded border border-border bg-card/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={copy}
          className="h-6 px-2 text-[10px] gap-1"
        >
          {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <div
        className={`text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words ${
          mono ? "font-mono-display text-[11px]" : ""
        }`}
      >
        {text}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground italic">{hint}</div>}
    </div>
  );
}
