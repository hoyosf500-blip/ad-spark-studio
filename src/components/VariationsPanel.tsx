import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, Loader2, Search, Zap, Copy, CheckCircle2, AlertTriangle, Image as ImageIcon, X, Wand2,
} from "lucide-react";
import { extractFrames, fileToDataUrl, type ExtractedFrame } from "@/lib/frame-extraction";
import { parseScenes, type ParsedScene } from "@/lib/scene-parser";
import { VARIATIONS } from "@/lib/variation-defs";
import { anthropicAnalyze } from "@/utils/anthropic.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type VariationState = {
  type: string;
  label: string;
  emoji: string;
  status: "idle" | "running" | "done" | "error" | "truncated";
  text: string;
  scenes: ParsedScene[];
  startMs: number | null;
  elapsedSec: number | null;
  costUsd: number;
  error?: string;
  variationId?: string;
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export function VariationsPanel() {
  const { user } = useAuth();
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [duration, setDuration] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [productPhoto, setProductPhoto] = useState<string | null>(null);
  const [transcription, setTranscription] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [analysisCost, setAnalysisCost] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sourceVideoId, setSourceVideoId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const [variations, setVariations] = useState<VariationState[]>(
    VARIATIONS.map((v) => ({
      type: v.type, label: v.label, emoji: v.emoji,
      status: "idle", text: "", scenes: [], startMs: null, elapsedSec: null, costUsd: 0,
    })),
  );
  const [running, setRunning] = useState(false);
  const tickRef = useRef<number | null>(null);

  // Live timer ticker
  useEffect(() => {
    const id = window.setInterval(() => {
      setVariations((prev) =>
        prev.map((v) =>
          v.status === "running" && v.startMs
            ? { ...v, elapsedSec: Math.round((Date.now() - v.startMs) / 1000) }
            : v,
        ),
      );
    }, 500);
    tickRef.current = id;
    return () => window.clearInterval(id);
  }, []);

  // Ensure the user has a personal workspace (auto-create on first use)
  const ensureWorkspace = useCallback(async () => {
    if (!user) return null;
    if (workspaceId) return workspaceId;
    const { data: existing } = await supabase
      .from("workspaces").select("id").eq("owner_id", user.id).limit(1).maybeSingle();
    if (existing) {
      setWorkspaceId(existing.id);
      // ensure membership row
      await supabase.from("workspace_members")
        .upsert({ workspace_id: existing.id, user_id: user.id, role: "owner" }, { onConflict: "workspace_id,user_id" });
      return existing.id;
    }
    const { data: created, error } = await supabase
      .from("workspaces").insert({ name: "My workspace", owner_id: user.id }).select("id").single();
    if (error || !created) { toast.error("No se pudo crear el workspace"); return null; }
    await supabase.from("workspace_members").insert({ workspace_id: created.id, user_id: user.id, role: "owner" });
    setWorkspaceId(created.id);
    return created.id;
  }, [user, workspaceId]);

  // ─── upload + frame extraction ────────────────────────────────────
  const onPickVideo = async (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Selecciona un archivo de video (.mp4)");
      return;
    }
    setFile(f);
    setFrames([]); setAnalysis(""); setAnalysisCost(0); setProjectId(null);
    setSourceVideoId(null); setVideoUrl(null);
    setVariations((prev) => prev.map((v) => ({ ...v, status: "idle", text: "", scenes: [], elapsedSec: null, costUsd: 0 })));

    setExtracting(true); setExtractProgress({ done: 0, total: 0 });
    try {
      const ws = await ensureWorkspace();
      const { frames, durationSec, videoUrl } = await extractFrames(f, (d, t) =>
        setExtractProgress({ done: d, total: t }),
      );
      setFrames(frames); setDuration(durationSec); setVideoUrl(videoUrl);
      toast.success(`${frames.length} frames extraídos a 1fps`);

      // Upload to storage + create source_videos row (best-effort, non-blocking)
      if (ws && user) {
        const path = `${user.id}/${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("source-videos").upload(path, f, {
          contentType: f.type, upsert: false,
        });
        if (upErr) console.warn("storage upload failed:", upErr.message);
        const { data: sv, error: svErr } = await supabase.from("source_videos").insert({
          workspace_id: ws,
          filename: f.name,
          duration_seconds: durationSec,
          storage_path: upErr ? null : path,
          frames: frames.map((fr) => ({ time: fr.time, w: fr.width, h: fr.height })),
        }).select("id").single();
        if (!svErr && sv) setSourceVideoId(sv.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error extrayendo frames");
    } finally {
      setExtracting(false); setExtractProgress(null);
    }
  };

  const onPickProductPhoto = async (f: File | null) => {
    if (!f) return;
    const url = await fileToDataUrl(f);
    setProductPhoto(url);
  };

  // ─── analyze ──────────────────────────────────────────────────────
  const runAnalysis = async () => {
    if (frames.length === 0) { toast.error("Sube un video primero"); return; }
    setAnalyzing(true); setAnalysis("");
    try {
      const ws = await ensureWorkspace();
      const res = await anthropicAnalyze({
        data: {
          frames: frames.map((f) => ({ time: f.time, dataUrl: f.dataUrl })),
          productPhoto,
          transcription: transcription.trim() || null,
          model,
          workspaceId: ws,
        },
      });
      setAnalysis(res.text);
      setAnalysisCost(res.costUsd);
      // Auto-suggest transcription if user didn't provide one
      if (!transcription.trim()) {
        const auto = extractAutoTranscription(res.text);
        if (auto) setTranscription(auto);
      }
      // persist project
      if (ws && user) {
        const { data: pr } = await supabase.from("projects").insert({
          workspace_id: ws,
          name: file?.name ?? "Untitled project",
          status: "analyzed",
          transcription: transcription.trim() || extractAutoTranscription(res.text) || null,
          analysis_text: res.text,
          frames_metadata: frames.map((f) => ({ time: f.time, w: f.width, h: f.height })),
        }).select("id").single();
        if (pr) setProjectId(pr.id);
        if (sourceVideoId) {
          await supabase.from("source_videos").update({
            analysis_text: res.text,
            transcription: transcription.trim() || extractAutoTranscription(res.text) || null,
          }).eq("id", sourceVideoId);
        }
      }
      toast.success(`Análisis listo. Costo: $${res.costUsd.toFixed(4)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en análisis");
    } finally {
      setAnalyzing(false);
    }
  };

  // ─── generate all variations in series via SSE ────────────────────
  const generateAll = async () => {
    if (!analysis) { toast.error("Genera el análisis primero"); return; }
    if (!projectId) { toast.error("Falta el proyecto"); return; }
    setRunning(true);
    try {
      for (let i = 0; i < VARIATIONS.length; i++) {
        const v = VARIATIONS[i];
        await runOneVariation(v.type, v.label);
      }
      toast.success("6 variaciones completadas");
    } finally {
      setRunning(false);
    }
  };

  const runOneVariation = async (type: string, label: string) => {
    if (!projectId || !workspaceId) return;
    const startMs = Date.now();
    setVariations((prev) =>
      prev.map((v) => v.type === type
        ? { ...v, status: "running", text: "", scenes: [], startMs, elapsedSec: 0, error: undefined, costUsd: 0 }
        : v),
    );

    // Insert variation row up front so we can attach scenes after
    const { data: variationRow } = await supabase.from("variations").insert({
      workspace_id: workspaceId,
      project_id: projectId,
      source_video_id: sourceVideoId,
      variation_type: type,
      title: label,
      model,
    }).select("id").single();
    const variationId = variationRow?.id ?? undefined;

    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");

      const res = await fetch("/api/anthropic-generate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          analysis,
          transcription: transcription || null,
          variationType: type,
          variationLabel: label,
          productPhoto,
          referenceFrames: frames.slice(0, Math.min(8, frames.length)).map((f) => ({ time: f.time, dataUrl: f.dataUrl })),
          model,
          workspaceId,
          variationId,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let full = "";
      let cost = 0;
      let truncated = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine.slice(6).trim()) as
              | { type: "text"; text: string }
              | { type: "done"; fullText: string; costUsd: number; isTruncated: boolean }
              | { type: "error"; error: string };
            if (ev.type === "text") {
              full += ev.text;
              setVariations((prev) =>
                prev.map((v) => v.type === type ? { ...v, text: full } : v),
              );
            } else if (ev.type === "done") {
              full = ev.fullText || full; cost = ev.costUsd; truncated = ev.isTruncated;
            } else if (ev.type === "error") {
              throw new Error(ev.error);
            }
          } catch { /* skip */ }
        }
      }

      const scenes = parseScenes(full);
      const elapsed = Math.round((Date.now() - startMs) / 1000);

      setVariations((prev) =>
        prev.map((v) => v.type === type
          ? { ...v, status: truncated ? "truncated" : "done", text: full, scenes, elapsedSec: elapsed, costUsd: cost, variationId }
          : v),
      );

      // persist
      if (variationId) {
        await supabase.from("variations").update({
          full_text: full,
          script: full.slice(0, 4000),
          is_truncated: truncated,
          elapsed_seconds: elapsed,
        }).eq("id", variationId);
        if (scenes.length > 0) {
          await supabase.from("variation_scenes").insert(
            scenes.map((s) => ({
              workspace_id: workspaceId,
              variation_id: variationId,
              scene_index: s.orderIdx,
              order_idx: s.orderIdx,
              title: s.title,
              scene_text: s.scriptEs,
              script_es: s.scriptEs,
              image_prompt: s.imagePromptEn,
              image_prompt_en: s.imagePromptEn,
              animation_prompt: s.animationPromptEn,
              animation_prompt_en: s.animationPromptEn,
              tool_recommended: s.toolRecommended,
              attach_note: s.attachNote,
              screen_text: s.screenText,
              reference_frame_time_sec: s.timeStartSec,
              reference_frame_url: pickFrameAt(frames, s.timeStartSec),
            })),
          );
        }
      }
    } catch (e) {
      setVariations((prev) =>
        prev.map((v) => v.type === type
          ? { ...v, status: "error", error: e instanceof Error ? e.message : String(e) }
          : v),
      );
    }
  };

  // ─── render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* upload + product photo */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-mono-display text-lg font-bold">1. Sube tu video ganador</h2>
            <p className="text-xs text-muted-foreground">.mp4 · extracción 1fps · máx 1024×1820</p>
          </div>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-sonnet-4-5-20250929">Sonnet 4.5 ($3/$15)</SelectItem>
              <SelectItem value="claude-3-5-sonnet-20241022">Sonnet 3.5 ($3/$15)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <FilePicker icon={Upload} label="Video" accept="video/mp4,video/*" onFile={onPickVideo}
            current={file?.name ?? null} disabled={extracting} />
          <FilePicker icon={ImageIcon} label="Foto de producto (opcional)" accept="image/*"
            onFile={onPickProductPhoto} current={productPhoto ? "imagen cargada" : null}
            onClear={() => setProductPhoto(null)} />
        </div>

        {extracting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Extrayendo frames {extractProgress?.done ?? 0}/{extractProgress?.total ?? 0}…
          </div>
        )}

        {frames.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              {frames.length} frames · {duration}s
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-2">
              {frames.map((f) => (
                <div key={f.time} className="relative flex-shrink-0">
                  <img src={f.dataUrl} alt={`frame ${f.time}s`}
                    className="h-16 w-auto rounded border border-border" />
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] font-mono-display text-primary">
                    {f.time}s
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* analyze */}
      {frames.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-mono-display text-lg font-bold">2. Analizar con Claude</h2>
            <Button onClick={runAnalysis} disabled={analyzing}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {analyzing ? "Analizando…" : "🔍 Analizar video"}
            </Button>
          </div>
          <Textarea
            placeholder="Transcripción del usuario (opcional). Si la dejas vacía, Claude la extraerá del video."
            value={transcription}
            onChange={(e) => setTranscription(e.target.value)}
            rows={3}
            className="text-sm"
          />
          {analysis && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-success/40 text-success">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> análisis listo
                </Badge>
                <span>${analysisCost.toFixed(4)} USD</span>
                <CopyBtn text={analysis} />
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
                {analysis}
              </pre>
            </div>
          )}
        </Card>
      )}

      {/* variations */}
      {analysis && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-mono-display text-lg font-bold">3. Generar 6 variaciones</h2>
            <Button onClick={generateAll} disabled={running}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {running ? "Generando…" : "⚡ Generar TODAS"}
            </Button>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {variations.map((v) => (
              <VariationCard key={v.type} v={v} frames={frames} videoUrl={videoUrl} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── small helpers / sub-components ───────────────────────────────────

function pickFrameAt(frames: ExtractedFrame[], timeSec: number | null): string | null {
  if (timeSec == null || frames.length === 0) return null;
  let best = frames[0];
  let bestDelta = Math.abs(best.time - timeSec);
  for (const f of frames) {
    const d = Math.abs(f.time - timeSec);
    if (d < bestDelta) { best = f; bestDelta = d; }
  }
  return best.dataUrl;
}

function extractAutoTranscription(text: string): string | null {
  const m = /TRANSCRIP[CSI]ON[^\n]*\n([\s\S]*?)(?:\n\n|$)/i.exec(text);
  if (m && m[1].trim().length > 5) return m[1].trim().slice(0, 4000);
  return null;
}

function FilePicker({ icon: Icon, label, accept, onFile, current, onClear, disabled }: {
  icon: typeof Upload; label: string; accept: string; current: string | null;
  onFile: (f: File | null) => void; onClear?: () => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-dashed border-border bg-background p-3 flex items-center gap-3">
      <Icon className="h-5 w-5 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate text-sm">{current ?? <span className="text-muted-foreground">Ningún archivo</span>}</div>
      </div>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {current && onClear && (
        <Button size="sm" variant="ghost" onClick={onClear}><X className="h-3.5 w-3.5" /></Button>
      )}
      <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={disabled}>
        Elegir
      </Button>
    </div>
  );
}

function CopyBtn({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setDone(true); setTimeout(() => setDone(false), 1200);
    }}>
      <Copy className="h-3 w-3 mr-1" />{done ? "ok" : label}
    </Button>
  );
}

function VariationCard({ v, frames, videoUrl: _videoUrl }: {
  v: VariationState; frames: ExtractedFrame[]; videoUrl: string | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-base">{v.emoji}</span>
          <span className="font-mono-display text-sm font-bold">{v.label}</span>
        </div>
        <StatusPill v={v} />
      </div>

      {v.status === "running" && (
        <div className="px-4 py-2 max-h-32 overflow-auto bg-background">
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
            {v.text || "…"}
          </pre>
        </div>
      )}

      {v.status === "error" && (
        <div className="p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {v.error}
        </div>
      )}

      {(v.status === "done" || v.status === "truncated") && (
        <div className="divide-y divide-border">
          {v.scenes.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">
              Sin escenas parseadas. <CopyBtn text={v.text} label="Copiar texto crudo" />
            </div>
          )}
          {v.scenes.map((s) => (
            <div key={s.orderIdx} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-mono-display text-xs font-bold text-primary">{s.title}</h4>
                {s.toolRecommended && (
                  <Badge variant="outline" className="text-[10px]">{s.toolRecommended}</Badge>
                )}
              </div>
              <div className="grid sm:grid-cols-[80px_1fr] gap-3 items-start">
                {s.timeStartSec != null && (
                  <img src={pickFrameAt(frames, s.timeStartSec) ?? ""} alt={`ref ${s.timeStartSec}s`}
                    className="w-20 h-auto rounded border border-border" />
                )}
                <div className="space-y-2 min-w-0">
                  <PromptField label="Script (ES)" text={s.scriptEs} />
                  <PromptField label="Image prompt (EN)" text={s.imagePromptEn} mono />
                  <PromptField label="Animation prompt (EN)" text={s.animationPromptEn} mono />
                  {s.screenText && <PromptField label="Screen text" text={s.screenText} />}
                  {s.attachNote && <PromptField label="Attach note" text={s.attachNote} />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromptField({ label, text, mono }: { label: string; text: string; mono?: boolean }) {
  if (!text) return null;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <CopyBtn text={text} />
      </div>
      <div className={`text-xs leading-relaxed text-foreground ${mono ? "font-mono-display" : ""}`}>{text}</div>
    </div>
  );
}

function StatusPill({ v }: { v: VariationState }) {
  if (v.status === "idle") return <Badge variant="outline" className="text-[10px]">pendiente</Badge>;
  if (v.status === "running") {
    return (
      <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
        <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
        {v.elapsedSec ?? 0}s
      </Badge>
    );
  }
  if (v.status === "error") return <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">error</Badge>;
  if (v.status === "truncated") return <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">truncado · {v.elapsedSec}s · ${v.costUsd.toFixed(4)}</Badge>;
  return (
    <Badge variant="outline" className="border-success/40 text-success text-[10px]">
      <Wand2 className="h-2.5 w-2.5 mr-1" />
      {v.elapsedSec}s · ${v.costUsd.toFixed(4)}
    </Badge>
  );
}
