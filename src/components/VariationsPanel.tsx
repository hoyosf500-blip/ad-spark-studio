import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, Loader2, Search, Zap, Copy, CheckCircle2, AlertTriangle, Image as ImageIcon, X, Wand2,
  Film, FileText, Package, Sparkles,
} from "lucide-react";
import { extractFrames, fileToDataUrl, type ExtractedFrame } from "@/lib/frame-extraction";
import { parseScenes, type ParsedScene } from "@/lib/scene-parser";
import { VARIATIONS } from "@/lib/variation-defs";
import { handleCapResponse } from "@/lib/handle-cap";
import type { ScriptValidation } from "@/lib/winning-framework";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type StepId = 0 | 1 | 2 | 3;
const STEPS: ReadonlyArray<{ id: StepId; label: string }> = [
  { id: 0, label: "Subir" },
  { id: 1, label: "Analizar" },
  { id: 2, label: "Generar" },
  { id: 3, label: "Resultados" },
];

function StepperNav({ current }: { current: StepId }) {
  return (
    <div className="flex items-stretch rounded-lg border border-border bg-card overflow-hidden">
      {STEPS.map((s, i) => {
        const state: "done" | "active" | "pending" =
          s.id < current ? "done" : s.id === current ? "active" : "pending";
        return (
          <div
            key={s.id}
            className={[
              "flex-1 flex items-center justify-center gap-2 px-3 py-3 text-sm font-mono-display",
              state === "active" && "bg-primary/15 text-primary font-bold border-b-2 border-primary",
              state === "done" && "text-success/90",
              state === "pending" && "text-muted-foreground/60",
              i > 0 && "border-l border-border",
            ].filter(Boolean).join(" ")}
          >
            <span
              className={[
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                state === "active" && "bg-primary text-primary-foreground",
                state === "done" && "bg-success/20 text-success",
                state === "pending" && "bg-muted text-muted-foreground/60",
              ].filter(Boolean).join(" ")}
            >
              {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Clon sends ALL frames (beat-by-beat replica); other variations get 5 distributed (first, 25%, 50%, 75%, last).
function pickReferenceFrames(
  type: string,
  frames: ExtractedFrame[],
): Array<{ time: number; dataUrl: string }> {
  if (type === "clon" || frames.length <= 5) {
    return frames.map((f) => ({ time: f.time, dataUrl: f.dataUrl }));
  }
  const last = frames.length - 1;
  const idxs = Array.from(new Set([0, Math.round(last * 0.25), Math.round(last * 0.5), Math.round(last * 0.75), last]));
  return idxs.map((i) => ({ time: frames[i].time, dataUrl: frames[i].dataUrl }));
}

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
  validation?: ScriptValidation | null;
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export function VariationsPanel() {
  const { user, activeWorkspaceId, refreshWorkspaces, setActiveWorkspaceId } = useAuth();
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [duration, setDuration] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [productPhoto, setProductPhoto] = useState<string | null>(null);
  const [transcription, setTranscription] = useState("");

  // Product data (B2) — fed as productInfo to /api/anthropic-analyze and /api/anthropic-generate
  const [productName, setProductName] = useState("");
  const [productOneLiner, setProductOneLiner] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productAudience, setProductAudience] = useState("");
  const [creativeBrief, setCreativeBrief] = useState("");
  const [detecting, setDetecting] = useState(false);
  const productInfo = [
    productName && `Producto: ${productName}`,
    productOneLiner && `Qué hace: ${productOneLiner}`,
    productPrice && `Precio: ${productPrice}`,
    productAudience && `Audiencia: ${productAudience}`,
  ].filter(Boolean).join("\n") || null;

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

  // Resolve the workspace to use: prefer active from context, else create personal
  const ensureWorkspace = useCallback(async () => {
    if (!user) return null;
    if (activeWorkspaceId) {
      if (workspaceId !== activeWorkspaceId) setWorkspaceId(activeWorkspaceId);
      return activeWorkspaceId;
    }
    if (workspaceId) return workspaceId;
    const { data: existing } = await supabase
      .from("workspaces").select("id").eq("owner_id", user.id).limit(1).maybeSingle();
    if (existing) {
      setWorkspaceId(existing.id);
      await supabase.from("workspace_members")
        .upsert({ workspace_id: existing.id, user_id: user.id, role: "owner" }, { onConflict: "workspace_id,user_id" });
      setActiveWorkspaceId(existing.id);
      await refreshWorkspaces();
      return existing.id;
    }
    const { data: created, error } = await supabase
      .from("workspaces").insert({ name: "My workspace", owner_id: user.id }).select("id").single();
    if (error || !created) { toast.error("No se pudo crear el workspace"); return null; }
    await supabase.from("workspace_members").insert({ workspace_id: created.id, user_id: user.id, role: "owner" });
    setWorkspaceId(created.id);
    setActiveWorkspaceId(created.id);
    await refreshWorkspaces();
    return created.id;
  }, [user, workspaceId, activeWorkspaceId, refreshWorkspaces, setActiveWorkspaceId]);

  // Sync local workspaceId with active changes
  useEffect(() => {
    if (activeWorkspaceId && workspaceId !== activeWorkspaceId) {
      setWorkspaceId(activeWorkspaceId);
    }
  }, [activeWorkspaceId, workspaceId]);

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

  // ─── auto-detect product data from photo (B3) ─────────────────────
  const onAutoDetect = async () => {
    if (!productPhoto) { toast.error("Sube primero una foto del producto"); return; }
    setDetecting(true);
    try {
      const ws = await ensureWorkspace();
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");

      const res = await fetch("/api/detect-product", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ productPhoto, workspaceId: ws }),
      });
      if (await handleCapResponse(res)) { setDetecting(false); return; }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200) || res.statusText}`);
      }
      const data = (await res.json()) as {
        name?: string; oneLiner?: string; price?: string; audience?: string; costUsd?: number;
      };
      if (data.name) setProductName(data.name);
      if (data.oneLiner) setProductOneLiner(data.oneLiner);
      if (data.price) setProductPrice(data.price);
      if (data.audience) setProductAudience(data.audience);
      toast.success(`Detectado · $${Number(data.costUsd ?? 0).toFixed(4)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error detectando producto");
    } finally {
      setDetecting(false);
    }
  };

  // ─── analyze (streaming SSE) ──────────────────────────────────────
  const runAnalysis = async () => {
    if (frames.length === 0) { toast.error("Sube un video primero"); return; }
    setAnalyzing(true); setAnalysis(""); setAnalysisCost(0);
    try {
      const ws = await ensureWorkspace();
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");

      const res = await fetch("/api/anthropic-analyze", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          frames: frames.map((f) => ({ time: f.time, dataUrl: f.dataUrl })),
          productPhoto,
          transcription: transcription.trim() || null,
          productInfo,
          model,
          workspaceId: ws,
        }),
      });
      if (await handleCapResponse(res)) { setAnalyzing(false); return; }
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200) || res.statusText}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let full = "";
      let cost = 0;
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
              setAnalysis(full);
            } else if (ev.type === "done") {
              full = ev.fullText || full;
              cost = ev.costUsd;
            } else if (ev.type === "error") {
              throw new Error(ev.error);
            }
          } catch { /* skip */ }
        }
      }

      setAnalysis(full);
      setAnalysisCost(cost);
      if (!transcription.trim()) {
        const auto = extractAutoTranscription(full);
        if (auto) setTranscription(auto);
      }
      // persist project
      if (ws && user) {
        const { data: pr } = await supabase.from("projects").insert({
          workspace_id: ws,
          name: file?.name ?? "Untitled project",
          status: "analyzed",
          transcription: transcription.trim() || extractAutoTranscription(full) || null,
          analysis_text: full,
          frames_metadata: frames.map((f) => ({ time: f.time, w: f.width, h: f.height })),
        }).select("id").single();
        if (pr) setProjectId(pr.id);
        if (sourceVideoId) {
          await supabase.from("source_videos").update({
            analysis_text: full,
            transcription: transcription.trim() || extractAutoTranscription(full) || null,
          }).eq("id", sourceVideoId);
        }
      }
      toast.success(`Análisis listo. Costo: $${Number(cost ?? 0).toFixed(4)}`);
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
          productInfo,
          creativeBrief: creativeBrief.trim() || null,
          referenceFrames: pickReferenceFrames(type, frames),
          model,
          workspaceId,
          variationId,
        }),
      });
      if (await handleCapResponse(res)) return;
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let full = "";
      let cost = 0;
      let truncated = false;
      let validation: ScriptValidation | null = null;
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
              | { type: "done"; fullText: string; costUsd: number; isTruncated: boolean; validation?: ScriptValidation | null }
              | { type: "error"; error: string };
            if (ev.type === "text") {
              full += ev.text;
              setVariations((prev) =>
                prev.map((v) => v.type === type ? { ...v, text: full } : v),
              );
            } else if (ev.type === "done") {
              full = ev.fullText || full; cost = ev.costUsd; truncated = ev.isTruncated;
              validation = ev.validation ?? null;
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
          ? { ...v, status: truncated ? "truncated" : "done", text: full, scenes, elapsedSec: elapsed, costUsd: cost, variationId, validation }
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
  const currentStep: StepId =
    variations.some((v) => v.status === "done" || v.status === "truncated")
      ? (variations.every((v) => v.status === "done" || v.status === "truncated") ? 3 : 2)
      : analysis
        ? 2
        : frames.length > 0
          ? 1
          : 0;

  return (
    <div className="space-y-6">
      <StepperNav current={currentStep} />

        {/* Step 1 — Subir video + producto */}
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="font-mono-display text-xl font-bold">Sube tu video ganador + producto</h2>
            <p className="text-xs text-muted-foreground mt-1">.mp4 · extracción 1 fps · máx 1024×1820</p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <BigFilePicker
              icon={Film}
              emoji="📹"
              label="Video .mp4"
              accept="video/mp4,video/*"
              onFile={onPickVideo}
              current={file?.name ?? null}
              disabled={extracting}
              previewUrl={videoUrl}
              previewKind="video"
            />
            <BigFilePicker
              icon={ImageIcon}
              emoji="📷"
              label="Foto del producto"
              accept="image/*"
              onFile={onPickProductPhoto}
              current={productPhoto ? "imagen cargada" : null}
              onClear={() => setProductPhoto(null)}
              previewUrl={productPhoto}
              previewKind="image"
            />
          </div>

          {extracting && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Extrayendo frames {extractProgress?.done ?? 0}/{extractProgress?.total ?? 0}…
            </div>
          )}

          {/* Datos del producto (B2 + B3 auto-detect) */}
          <div className="rounded-lg border border-border bg-background/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <Package className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-bold">Datos del producto</div>
                  <div className="text-[11px] text-muted-foreground">
                    Claude los usa para el análisis y las 6 variaciones. Todo opcional, pero mejora mucho los scripts.
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                onClick={onAutoDetect}
                disabled={detecting || !productPhoto}
                title={!productPhoto ? "Sube primero una foto del producto" : "Usa Claude para rellenar los 4 campos"}
              >
                {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                <span className="text-[11px] font-mono-display">Auto-detectar</span>
              </Button>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              <Input
                placeholder="Nombre del producto"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Precio (ej. $89.900 COD)"
                value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Qué hace / beneficio principal"
                value={productOneLiner}
                onChange={(e) => setProductOneLiner(e.target.value)}
                className="h-9 text-sm md:col-span-2"
              />
              <Input
                placeholder="Audiencia (ej. mujeres 35+ con dolor de espalda)"
                value={productAudience}
                onChange={(e) => setProductAudience(e.target.value)}
                className="h-9 text-sm md:col-span-2"
              />
              <div className="md:col-span-2">
                <Label className="text-xs">Idea creativa (opcional)</Label>
                <Textarea
                  value={creativeBrief}
                  onChange={(e) => setCreativeBrief(e.target.value)}
                  placeholder="Ej: mujer al amanecer en el gym, cara de alivio tras sentir el efecto. Tono vulnerable, setting real, corte ritmo alto."
                  rows={3}
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Decí el <strong>tono, setting, personaje y emoción</strong> que querés. Claude los respeta.
                  No escribas dosis, precio ni claims — esos salen del producto y del análisis del video.
                </p>
              </div>
            </div>
          </div>

          {/* Transcripción prominente */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-bold text-primary">Transcripción del video</div>
                <div className="text-[11px] text-muted-foreground">
                  Lo que dice la persona en el video. El Clon la usa palabra por palabra.
                </div>
              </div>
            </div>
            <Textarea
              placeholder='Ejemplo: "le duele aquí, podría ser una hernia discal..."'
              value={transcription}
              onChange={(e) => setTranscription(e.target.value)}
              rows={3}
              className="text-sm bg-background/60"
            />
            <div className="text-[10px] text-muted-foreground">
              Opcional — si la dejas vacía, Claude intenta transcribir de los frames.
            </div>
          </div>

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

          {/* Botón Analizar + modelo */}
          {frames.length > 0 && (
            <div className="flex items-stretch gap-2">
              <Button
                onClick={runAnalysis}
                disabled={analyzing}
                className="flex-1 h-11 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-mono-display text-sm font-bold"
              >
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {analyzing ? "Analizando…" : "🔍 Analizar video"}
              </Button>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-44 h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-5-20250929">Sonnet 4.5 ($3/$15)</SelectItem>
                  <SelectItem value="claude-3-5-sonnet-20241022">Sonnet 3.5 ($3/$15)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </Card>

        {/* Step 2 — Análisis resultado */}
        {analysis && (
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-mono-display text-lg font-bold">Análisis de Claude</h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-success/40 text-success">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> listo
                </Badge>
                <span>${Number(analysisCost ?? 0).toFixed(4)} USD</span>
                <CopyBtn text={analysis} />
              </div>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
              {analysis}
            </pre>
          </Card>
        )}

        {/* Step 3 — Generar variaciones */}
        {analysis && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-mono-display text-lg font-bold">Variaciones</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Podés generar las 6 de una o hacer clic en "Generar solo esta" en cada tarjeta.
                </p>
              </div>
              <Button onClick={generateAll} disabled={running}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {running ? "Generando…" : "⚡ Generar las 6"}
              </Button>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              {variations.map((v) => (
                <VariationCard
                  key={v.type}
                  v={v}
                  frames={frames}
                  videoUrl={videoUrl}
                  workspaceId={workspaceId}
                  running={running}
                  onGenerate={() => runOneVariation(v.type, v.label)}
                />
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

function BigFilePicker({ icon: Icon, emoji, label, accept, onFile, current, onClear, disabled, previewUrl, previewKind }: {
  icon: typeof Upload; emoji: string; label: string; accept: string; current: string | null;
  onFile: (f: File | null) => void; onClear?: () => void; disabled?: boolean;
  previewUrl?: string | null; previewKind?: "image" | "video";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const hasFile = Boolean(current);
  const hasPreview = Boolean(previewUrl);
  return (
    <div
      className={`rounded-xl border-2 border-dashed p-4 flex flex-col items-center justify-center text-center gap-2 transition-colors cursor-pointer overflow-hidden ${
        hasFile ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:border-primary/40 hover:bg-primary/5"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      onClick={() => !disabled && ref.current?.click()}
    >
      {hasPreview ? (
        previewKind === "video" ? (
          <video
            src={previewUrl!}
            muted
            playsInline
            className="w-full max-h-40 rounded-md object-cover border border-primary/30"
            preload="metadata"
          />
        ) : (
          <img
            src={previewUrl!}
            alt={label}
            className="w-full max-h-40 rounded-md object-cover border border-primary/30"
          />
        )
      ) : (
        <div className="text-3xl leading-none">{emoji}</div>
      )}
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono-display">{label}</div>
      </div>
      <div className="truncate max-w-full text-xs">
        {current ?? <span className="text-muted-foreground">Click para elegir archivo</span>}
      </div>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {current && onClear && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
        >
          <X className="h-3 w-3 mr-1" /> Quitar
        </Button>
      )}
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

function VariationCard({ v, frames, videoUrl: _videoUrl, workspaceId, running, onGenerate }: {
  v: VariationState; frames: ExtractedFrame[]; videoUrl: string | null; workspaceId: string | null;
  running?: boolean;
  onGenerate?: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{v.emoji}</span>
          <span className="font-mono-display text-sm font-bold truncate">{v.label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(v.status === "done" || v.status === "truncated") && v.validation && !v.validation.pass && (
            <Badge
              variant="outline"
              className="h-6 gap-1 border-warning/50 bg-warning/10 text-warning text-[10px]"
              title={`Gates pendientes: ${v.validation.violations.join(" · ")}. Considerá regenerar.`}
            >
              <AlertTriangle className="h-3 w-3" />
              {v.validation.violations.length} gate{v.validation.violations.length === 1 ? "" : "s"}
            </Badge>
          )}
          {(v.status === "idle" || v.status === "error") && onGenerate && (
            <Button
              size="sm"
              variant="outline"
              onClick={onGenerate}
              disabled={running}
              className="h-7 px-2 text-[11px] gap-1"
              title="Generar solo esta variación"
            >
              <Zap className="h-3 w-3" />
              Generar solo esta
            </Button>
          )}
          <StatusPill v={v} />
        </div>
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
            <SceneRow
              key={s.orderIdx}
              s={s}
              frames={frames}
              workspaceId={workspaceId}
              variationType={v.type}
              variationId={v.variationId}
            />
          ))}
          {onGenerate && (
            <div className="px-4 py-2 flex justify-end bg-card/40">
              <Button
                size="sm"
                variant="ghost"
                onClick={onGenerate}
                disabled={running}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                title="Volver a generar esta variación"
              >
                ↻ Regenerar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type VideoTaskState =
  | { status: "idle" }
  | { status: "running"; taskId: string; startedAt: number; elapsedSec: number }
  | { status: "done"; videoUrl: string }
  | { status: "failed"; error: string };

function SceneRow({ s, frames, workspaceId, variationType, variationId }: {
  s: ParsedScene;
  frames: ExtractedFrame[];
  workspaceId: string | null;
  variationType: string;
  variationId?: string;
}) {
  const refFrameUrl = pickFrameAt(frames, s.timeStartSec);
  const [useI2I, setUseI2I] = useState<boolean>(variationType === "clon");
  const [size, setSize] = useState<string>("928*1664");
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sceneDbId, setSceneDbId] = useState<string | null>(null);

  // Video task state (Wan)
  const [video, setVideo] = useState<VideoTaskState>({ status: "idle" });
  const pollRef = useRef<number | null>(null);

  // Resolve the scene DB id (created during persist) by variation_id + order_idx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!variationId) return;
      const { data } = await supabase
        .from("variation_scenes")
        .select("id, generated_image_id, generated_video_id")
        .eq("variation_id", variationId)
        .eq("order_idx", s.orderIdx)
        .maybeSingle();
      if (cancelled || !data) return;
      setSceneDbId(data.id);
      if (data.generated_image_id) {
        const { data: img } = await supabase
          .from("image_generations")
          .select("public_url")
          .eq("id", data.generated_image_id)
          .maybeSingle();
        if (img?.public_url) setImageUrl(img.public_url);
      }
      if (data.generated_video_id) {
        const { data: vid } = await supabase
          .from("video_generations")
          .select("public_url")
          .eq("id", data.generated_video_id)
          .maybeSingle();
        if (vid?.public_url) {
          setVideo({ status: "done", videoUrl: vid.public_url });
          return;
        }
      }
      // Resume in-flight task: latest wan_i2v for this scene
      const { data: task } = await supabase
        .from("async_tasks")
        .select("id, status, result, started_at, created_at")
        .eq("related_scene_id", data.id)
        .eq("task_type", "wan_i2v")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !task) return;
      if (task.status === "pending" || task.status === "running") {
        const startedAt = new Date(task.started_at ?? task.created_at).getTime();
        setVideo({
          status: "running",
          taskId: task.id,
          startedAt,
          elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        });
      } else if (task.status === "done") {
        const r = (task.result ?? {}) as { publicUrl?: string };
        if (r.publicUrl) setVideo({ status: "done", videoUrl: r.publicUrl });
      } else if (task.status === "failed") {
        const r = (task.result ?? {}) as { error?: string };
        setVideo({ status: "failed", error: r.error ?? "unknown" });
      }
    })();
    return () => { cancelled = true; };
  }, [variationId, s.orderIdx]);

  // Live timer + polling while running
  useEffect(() => {
    if (video.status !== "running") return;
    const startedAt = video.startedAt;
    const taskId = video.taskId;

    const tick = window.setInterval(() => {
      setVideo((cur) =>
        cur.status === "running"
          ? { ...cur, elapsedSec: Math.round((Date.now() - startedAt) / 1000) }
          : cur,
      );
    }, 1000);

    const pollOnce = async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch("/api/wan-poll-task", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ taskId }),
        });
        if (!res.ok) return;
        const j = (await res.json()) as
          | { status: "running" }
          | { status: "done"; videoUrl: string }
          | { status: "failed"; error: string };
        if (j.status === "done") {
          setVideo({ status: "done", videoUrl: j.videoUrl });
          toast.success("Video listo · $0.30 USD");
        } else if (j.status === "failed") {
          setVideo({ status: "failed", error: j.error });
          toast.error(`Video falló: ${j.error}`);
        }
      } catch { /* ignore */ }
    };

    // Poll immediately, then every 20s
    pollOnce();
    const poll = window.setInterval(pollOnce, 20000);
    pollRef.current = poll;

    // Realtime: react to other tabs/cron updates
    const channel = supabase
      .channel(`wan-task-${taskId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "async_tasks", filter: `id=eq.${taskId}` },
        (payload) => {
          const row = payload.new as { status?: string; result?: { publicUrl?: string; error?: string } };
          if (row.status === "done" && row.result?.publicUrl) {
            setVideo({ status: "done", videoUrl: row.result.publicUrl });
          } else if (row.status === "failed") {
            setVideo({ status: "failed", error: row.result?.error ?? "unknown" });
          }
        },
      )
      .subscribe();

    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [video.status, video.status === "running" ? video.taskId : null, video.status === "running" ? video.startedAt : null]);

  const generateVideo = async () => {
    if (!sceneDbId || !workspaceId) { toast.error("Escena no lista"); return; }
    if (!imageUrl) { toast.error("Genera la imagen primero"); return; }
    if (!s.animationPromptEn) { toast.error("Esta escena no tiene animation prompt"); return; }
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");
      const res = await fetch("/api/wan-create-task", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sceneId: sceneDbId,
          workspaceId,
          imageUrl,
          promptEn: s.animationPromptEn,
          size: "720*1280",
          duration: 5,
        }),
      });
      if (await handleCapResponse(res)) return;
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200));
      }
      const j = (await res.json()) as { taskId: string };
      const startedAt = Date.now();
      setVideo({ status: "running", taskId: j.taskId, startedAt, elapsedSec: 0 });
      toast.success("Tarea de video creada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error creando tarea");
    }
  };

  const generate = async () => {
    if (!s.imagePromptEn) { toast.error("Esta escena no tiene image prompt"); return; }
    if (!workspaceId) { toast.error("Workspace no listo"); return; }
    if (!sceneDbId) { toast.error("Escena no persistida aún"); return; }
    setGenerating(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");
      const res = await fetch("/api/qwen-generate-image", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sceneId: sceneDbId,
          workspaceId,
          promptEn: s.imagePromptEn,
          size,
          useI2I,
          referenceFrameDataUrl: useI2I ? refFrameUrl : null,
        }),
      });
      if (await handleCapResponse(res)) { setGenerating(false); return; }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200));
      }
      const json = (await res.json()) as { imageUrl: string; costUsd: number };
      setImageUrl(json.imageUrl);
      toast.success(`Imagen lista · $${Number(json.costUsd ?? 0).toFixed(2)} USD`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error generando imagen");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-mono-display text-xs font-bold text-primary">{s.title}</h4>
        {s.toolRecommended && (
          <Badge variant="outline" className="text-[10px]">{s.toolRecommended}</Badge>
        )}
      </div>
      <div className="grid sm:grid-cols-[80px_1fr] gap-3 items-start">
        {s.timeStartSec != null && refFrameUrl && (
          <img src={refFrameUrl} alt={`ref ${s.timeStartSec}s`}
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

      {/* Image generation block */}
      {s.imagePromptEn && (
        <div className="mt-3 rounded-md border border-border bg-card/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useI2I}
                  onChange={(e) => setUseI2I(e.target.checked)}
                  disabled={!refFrameUrl}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span>i2i (frame ref)</span>
              </label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="928*1664">928×1664 (9:16)</SelectItem>
                  <SelectItem value="1024*1024">1024×1024 (1:1)</SelectItem>
                  <SelectItem value="1280*720">1280×720 (16:9)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={generate} disabled={generating || !sceneDbId}
              className="h-7 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px]">
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              {imageUrl ? "Regenerar" : "Generar con Qwen ($0.04)"}
            </Button>
          </div>
          {imageUrl && (
            <div className="flex items-start gap-3">
              <a href={imageUrl} target="_blank" rel="noreferrer">
                <img src={imageUrl} alt="generated"
                  className="w-48 h-auto rounded border border-border" />
              </a>
              <div className="flex flex-col gap-1.5">
                <CopyBtn text={imageUrl} label="Copiar URL" />
                <Button size="sm" variant="outline" className="h-6 text-[10px]" asChild>
                  <a href={imageUrl} download target="_blank" rel="noreferrer">Descargar</a>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Video generation block (Wan 2.6 i2v) */}
      {s.animationPromptEn && (
        <div className="mt-2 rounded-md border border-border bg-card/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Video · 5s · 720×1280
            </div>
            {video.status === "idle" && (
              <Button
                size="sm"
                onClick={generateVideo}
                disabled={!imageUrl || !sceneDbId}
                title={!imageUrl ? "Genera la imagen primero" : undefined}
                className="h-7 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px]"
              >
                <Zap className="h-3 w-3" />
                {imageUrl ? "Generar video ($0.30)" : "Genera la imagen primero"}
              </Button>
            )}
            {video.status === "running" && (
              <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                ⏱ {video.elapsedSec}s
              </Badge>
            )}
            {video.status === "failed" && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" /> {video.error.slice(0, 60)}
                </Badge>
                <Button
                  size="sm"
                  onClick={generateVideo}
                  disabled={!imageUrl}
                  className="h-7 gap-1.5 text-[11px]"
                  variant="outline"
                >
                  Reintentar
                </Button>
              </div>
            )}
          </div>
          {video.status === "done" && (
            <div className="flex items-start gap-3">
              <video
                controls
                src={video.videoUrl}
                className="w-48 h-auto rounded border border-border"
              />
              <div className="flex flex-col gap-1.5">
                <CopyBtn text={video.videoUrl} label="Copiar URL" />
                <Button size="sm" variant="outline" className="h-6 text-[10px]" asChild>
                  <a href={video.videoUrl} download target="_blank" rel="noreferrer">Descargar</a>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={generateVideo}
                  disabled={!imageUrl}
                >
                  Regenerar
                </Button>
              </div>
            </div>
          )}
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
  if (v.status === "truncated") return <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">truncado · {v.elapsedSec}s · ${Number(v.costUsd ?? 0).toFixed(4)}</Badge>;
  return (
    <Badge variant="outline" className="border-success/40 text-success text-[10px]">
      <Wand2 className="h-2.5 w-2.5 mr-1" />
      {v.elapsedSec}s · ${Number(v.costUsd ?? 0).toFixed(4)}
    </Badge>
  );
}
