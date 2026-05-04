import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Upload, Loader2, Search, Zap, Copy, CheckCircle2, AlertTriangle, Image as ImageIcon, X, Wand2,
  Film, FileText, Package, Sparkles,
} from "lucide-react";
import { extractFrames, fileToDataUrl, type ExtractedFrame } from "@/lib/frame-extraction";
import { parseScenes, type ParsedScene } from "@/lib/scene-parser";
import { VARIATIONS } from "@/lib/variation-defs";
import { handleCapResponse } from "@/lib/handle-cap";
import { capImagePromptClient } from "@/lib/cap-prompt";
import type { ScriptValidation } from "@/lib/winning-framework";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Progress } from "@/components/ui/progress";

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

// Send ALL extracted frames to the model so each scene prompt anchors to its
// matching reference frame. Frames are already capped to MAX_FRAMES=60 by the
// extractor (1fps, 1024x1820), so input size stays bounded. Anthropic prompt
// caching is now active in api.generate-variations (cache_control: ephemeral
// on the last shared-prefix part), so the 6 variation calls share the frame
// payload: cache write on call 1 at 1.25x input, cache read on calls 2-6 at
// 0.10x input. Sampling down to 12 frames was tested but rejected: user
// prefers full quality over the marginal savings.
function pickReferenceFrames(
  _type: string,
  frames: ExtractedFrame[],
): Array<{ time: number; dataUrl: string }> {
  return frames.map((f) => ({ time: f.time, dataUrl: f.dataUrl }));
}

// Auto-generate Higgsfield prompts after scene rows are inserted.
// CONCURRENCY=6: all scenes fire simultaneously. Each call sends one reference
// frame (~1500 tokens), well within GPT-4o rate limits. Retry-once-on-5xx
// handles any transient rate-limit hit without user intervention.
//
// Retry-once-on-5xx with 2s backoff: 4xx (cap exceeded, auth) is permanent and
// not retried. Auto-gen respeta la preferencia persistida en localStorage
// (última elección del dropdown SceneRow). Sin preferencia → default backend
// (GPT-4o desde commit 173d075) ≈ $0.015/scene multimodal w/ 1 frame,
// 6 scenes ≈ $0.09. GPT-4o ≈ $0.12/scene, GPT-4o-mini ≈ $0.005/scene.

type HiggsfieldModelChoice = "sonnet" | "opus" | "haiku";
const HIGGSFIELD_MODEL_STORAGE_KEY = "ad-spark:higgsfield-model";

function readStoredHiggsfieldModel(): HiggsfieldModelChoice | undefined {
  if (typeof window === "undefined") return undefined;
  const v = window.localStorage.getItem(HIGGSFIELD_MODEL_STORAGE_KEY);
  return v === "opus" || v === "haiku" || v === "sonnet" ? v : undefined;
}

function writeStoredHiggsfieldModel(v: HiggsfieldModelChoice): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(HIGGSFIELD_MODEL_STORAGE_KEY, v); } catch { /* quota / private mode — non-fatal */ }
}

async function autoGenScenePrompts(args: {
  insertedScenes: Array<{ id: string; order_idx: number }>;
  framesByOrderIdx: Map<number, string | null>;
  workspaceId: string;
  token: string;
  onCost: (c: number) => void;
  model?: HiggsfieldModelChoice;
}) {
  const { insertedScenes, framesByOrderIdx, workspaceId, token, onCost, model } = args;

  // Model-aware concurrency + retry budget. GPT-4o has significantly lower
  // tokens-per-minute limits on standard tiers than Sonnet/Haiku, so firing 6
  // concurrent multimodal Opus calls — especially when the user runs the full
  // 6-variation batch with the parallel fan-out — cascades into 429s across
  // every worker. Lower concurrency + more attempts keeps Opus from painting
  // every scene with the "Generar prompts" manual button.
  const CONCURRENCY = model === "opus" ? 2 : 6;
  const MAX_ATTEMPTS = model === "opus" ? 6 : 4;
  const generateOne = async (sc: { id: string; order_idx: number }, attempt = 1): Promise<void> => {
    const isTransient = (status: number) => status === 429 || status >= 500;
    const backoffMs = () => {
      // Exponential + jitter so N parallel workers that all hit the same 429
      // don't re-sync on the retry and re-trigger the limit in lockstep.
      // Opus: 2s, 4s, 8s, 16s, 32s (+ 0–1s jitter). Sonnet/Haiku: 2s, 4s, 8s.
      const base = Math.pow(2, attempt) * 1000;
      const jitter = Math.random() * 1000;
      return base + jitter;
    };
    try {
      const res = await fetch("/api/generate-higgsfield-prompts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sceneId: sc.id,
          workspaceId,
          referenceFrameDataUrl: framesByOrderIdx.get(sc.order_idx) ?? null,
          ...(model ? { model } : {}),
        }),
      });
      if (!res.ok) {
        if (isTransient(res.status) && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, backoffMs()));
          return generateOne(sc, attempt + 1);
        }
        // Surface the response body for non-transient failures (401 token expired,
        // 403 RLS rejection, 400 malformed payload) so we know WHY the scene never
        // got its prompts — previously these dropped silently and the user saw
        // "Generar prompts" with no console signal to diagnose.
        const errText = await res.text().catch(() => "");
        console.error(
          `[autoGenScenePrompts] scene ${sc.id} order=${sc.order_idx} HTTP ${res.status} ` +
            `(attempt ${attempt}/${MAX_ATTEMPTS}, ${isTransient(res.status) ? "transient/exhausted" : "non-transient"}) — giving up:`,
          errText.slice(0, 300),
        );
        return;
      }
      const j = (await res.json()) as { ok: true; cached: boolean; costUsd: number };
      if (!j.cached && Number(j.costUsd) > 0) onCost(Number(j.costUsd));
    } catch (e) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, backoffMs()));
        return generateOne(sc, attempt + 1);
      }
      console.warn(`[autoGenScenePrompts] scene ${sc.id} failed after ${MAX_ATTEMPTS} attempts:`, e);
    }
  };

  // Sliding-window concurrency: pull next scene off the queue as each one
  // resolves, so we always have CONCURRENCY in flight until the queue drains.
  const queue = [...insertedScenes];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const sc = queue.shift();
      if (!sc) return;
      await generateOne(sc);
    }
  });
  await Promise.all(workers);
}

type VariationState = {
  type: string;
  label: string;
  emoji: string;
  status: "idle" | "running" | "done" | "error" | "truncated";
  text: string;
  scenes: ParsedScene[];
  costUsd: number;
  error?: string;
  variationId?: string;
  validation?: ScriptValidation | null;
};

// Estimates % by counting scene markers (0→85%) then post-scene tail sections
// (85→99%) so the bar keeps moving instead of freezing at 95% during the tail.
function progressPct(v: VariationState): number {
  if (v.status === "done") return 100;
  if (v.status === "error") return 0;
  if (v.status !== "running" && v.status !== "truncated") return 0;
  const scenes = (v.text.match(/═{3,}\s*(ESCENA|SCENE)\b/gi) ?? []).length;
  const tail = (v.text.match(/═{3,}\s*(AVATAR|HOOKS|EFFECTS|ENERGY|TIMELINE|RECOMMENDATION)\b/gi) ?? []).length;
  const scenePct = Math.min(scenes / 6, 1) * 85;
  const tailPct = Math.min(tail / 6, 1) * 14;
  return Math.max(1, Math.round(scenePct + tailPct + 1));
}

// Aligned with priceFor() table in src/utils/openrouter.functions.ts and the
// backend default in api.anthropic-{analyze,generate}. Sending the same string
// in the request body keeps cost tracking accurate end-to-end.
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

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
  const [transcribing, setTranscribing] = useState(false);

  // Product data (B2) — fed as productInfo to /api/analyze-frames and /api/generate-variations
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
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  // Acumulado de costo de prompts Higgsfield por escena (modelo variable:
  // GPT-4o default, GPT-4o o GPT-4o-mini si el usuario lo elige).
  // Se incrementa solo cuando una llamada NO viene del cache servidor.
  const [promptsCost, setPromptsCost] = useState(0);
  const addPromptsCost = useCallback((c: number) => {
    if (!Number.isFinite(c) || c <= 0) return;
    setPromptsCost((prev) => prev + c);
  }, []);
  // Whisper se cobra por cada subida de video (no se cachea).
  const [whisperCost, setWhisperCost] = useState(0);
  // Auto-detect: el usuario puede dispararlo más de una vez por proyecto si
  // cambia la foto, así que acumulamos en lugar de reemplazar.
  const [detectCost, setDetectCost] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sourceVideoId, setSourceVideoId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (analysisStartedAt === null) return;
    const id = setInterval(() => {
      setAnalysisElapsed(Math.floor((Date.now() - analysisStartedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [analysisStartedAt]);

  // Track every in-flight SSE fetch so we can abort them when the user
  // navigates away. Without this, a user who starts an analysis or variation
  // and immediately navigates leaves the stream consuming memory until it
  // ends, AND `logUsage` still runs on the server — charging the user for
  // work they never see. AbortController.abort() unwinds the fetch and the
  // reader.read() loop with an AbortError that we silently swallow.
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

  const [variations, setVariations] = useState<VariationState[]>(
    VARIATIONS.map((v) => ({
      type: v.type, label: v.label, emoji: v.emoji,
      status: "idle", text: "", scenes: [], costUsd: 0,
    })),
  );
  const [running, setRunning] = useState(false);

  // Costo total del proyecto = Whisper + detect + análisis + 6 variaciones + prompts.
  const variationsCostSum = useMemo(
    () => variations.reduce((s, v) => s + (Number(v.costUsd) || 0), 0),
    [variations],
  );
  const projectTotalCost = useMemo(
    () =>
      (Number(whisperCost) || 0) +
      (Number(detectCost) || 0) +
      (Number(analysisCost) || 0) +
      variationsCostSum +
      (Number(promptsCost) || 0),
    [whisperCost, detectCost, analysisCost, variationsCostSum, promptsCost],
  );
  const variationsDoneCount = useMemo(
    () => variations.filter((v) => v.status === "done" || v.status === "truncated").length,
    [variations],
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(VARIATIONS.map((v) => v.type)),
  );
  const toggleSelected = (type: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

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

  // Cleanup del blob URL al desmontar el panel (navegación a otra ruta).
  // Usamos ref para no re-disparar el efecto cuando videoUrl cambia — el
  // revoke en cambio se maneja inline en onPickVideo.
  const videoUrlRef = useRef<string | null>(null);
  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);
  useEffect(() => {
    return () => {
      const u = videoUrlRef.current;
      if (u?.startsWith("blob:")) {
        try { URL.revokeObjectURL(u); } catch { /* non-fatal */ }
      }
    };
  }, []);

  // ─── upload + frame extraction ────────────────────────────────────
  const transcribeAudio = async (f: File, durationSec: number, ws: string | null) => {
    setTranscribing(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth");
      const fd = new FormData();
      fd.append("file", f);
      if (ws) fd.append("workspaceId", ws);
      fd.append("durationSec", String(durationSec));
      const res = await fetch("/api/transcribe-audio", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: fd,
      });
      if (await handleCapResponse(res)) return;
      if (!res.ok) {
        const t = await res.text();
        toast.error(`Transcripción falló: ${t.slice(0, 200)}`);
        return;
      }
      const { text, costUsd } = (await res.json()) as { text: string; costUsd?: number };
      if (Number.isFinite(costUsd) && (costUsd ?? 0) > 0) {
        setWhisperCost(Number(costUsd));
      }
      if (text?.trim()) {
        setTranscription(text.trim());
        toast.success(`Transcripción lista · $${Number(costUsd ?? 0).toFixed(4)} USD`);
      }
    } catch (e) {
      toast.error(`Transcripción falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTranscribing(false);
    }
  };

  const onPickVideo = async (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Selecciona un archivo de video (.mp4)");
      return;
    }
    // Liberá el blob URL del video anterior antes de crear uno nuevo. Sin esto
    // cada upload deja un blob colgando en memoria — usuarios que prueban 5+
    // videos sin recargar acumulan cientos de MB de blobs huérfanos.
    if (videoUrl?.startsWith("blob:")) {
      try { URL.revokeObjectURL(videoUrl); } catch { /* non-fatal */ }
    }
    setFile(f);
    setFrames([]); setAnalysis(""); setAnalysisCost(0); setProjectId(null);
    setSourceVideoId(null); setVideoUrl(null); setTranscription("");
    setPromptsCost(0); setWhisperCost(0); setDetectCost(0);
    setVariations((prev) => prev.map((v) => ({ ...v, status: "idle", text: "", scenes: [], costUsd: 0 })));

    setExtracting(true); setExtractProgress({ done: 0, total: 0 });
    try {
      const ws = await ensureWorkspace();
      const { frames, durationSec, videoUrl } = await extractFrames(f, (d, t) =>
        setExtractProgress({ done: d, total: t }),
      );
      setFrames(frames); setDuration(durationSec); setVideoUrl(videoUrl);
      toast.success(`${frames.length} frames extraídos a 1fps`);

      // Whisper transcription in parallel with the upload below
      void transcribeAudio(f, durationSec, ws);

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
      const dc = Number(data.costUsd ?? 0);
      if (Number.isFinite(dc) && dc > 0) setDetectCost((prev) => prev + dc);
      toast.success(`Detectado · $${dc.toFixed(4)}`);
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
    setAnalysisStartedAt(Date.now());
    setAnalysisElapsed(0);
    // Hoisted so the catch/finally can clean it up even when the fetch itself
    // throws (network error before the request is dispatched).
    const controller = new AbortController();
    streamControllersRef.current.add(controller);
    try {
      const ws = await ensureWorkspace();
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");

      const res = await fetch("/api/analyze-frames", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        signal: controller.signal,
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
      let streamCutEarly = false;

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            // IMPORTANT: keep the try/catch tight around JSON.parse only.
            // A wider catch silently swallows the intentional `throw` from the
            // error branch below, which let empty `done` events from a failed
            // upstream overwrite the error state ("done $0 sin escenas").
            let ev:
              | { type: "text"; text: string }
              | { type: "done"; fullText: string; costUsd: number; isTruncated: boolean }
              | { type: "error"; error: string };
            try {
              ev = JSON.parse(dataLine.slice(6).trim());
            } catch {
              continue;
            }
            if (ev.type === "text") {
              full += ev.text;
              setAnalysis(full);
            } else if (ev.type === "done") {
              full = ev.fullText || full;
              cost = ev.costUsd;
            } else if (ev.type === "error") {
              throw new Error(ev.error);
            }
          }
        }
      } catch (streamErr) {
        // CRÍTICO: si ya tenemos texto sustancial, NO descartamos el trabajo.
        // El stream se cortó antes del evento "done" pero el análisis vino completo.
        if (!full || full.length < 200) throw streamErr;
        streamCutEarly = true;
        console.warn(
          `[runAnalysis] Stream cortado tras ${full.length} chars — persistiendo igual:`,
          streamErr,
        );
      }

      setAnalysis(full);
      setAnalysisCost(cost);

      // Persistir SIEMPRE que tengamos texto, aunque el done no haya llegado.
      if (ws && user && full.length > 200) {
        const { data: pr, error: prErr } = await supabase.from("projects").insert({
          workspace_id: ws,
          name: file?.name ?? "Untitled project",
          status: "analyzed",
          transcription: transcription.trim() || null,
          analysis_text: full,
          frames_metadata: frames.map((f) => ({ time: f.time, w: f.width, h: f.height })),
        }).select("id").single();

        if (prErr) {
          toast.error(`No se pudo guardar el proyecto: ${prErr.message}`);
        } else if (pr) {
          setProjectId(pr.id);
        }

        if (sourceVideoId) {
          await supabase.from("source_videos").update({
            analysis_text: full,
            transcription: transcription.trim() || null,
          }).eq("id", sourceVideoId);
        }
      }

      if (streamCutEarly) {
        toast.warning("Conexión cortada al final, pero el análisis se guardó completo");
      } else {
        toast.success(`Análisis listo. Costo: $${Number(cost ?? 0).toFixed(4)}`);
      }
    } catch (e) {
      // Aborts come from unmount cleanup — silent, expected.
      const isAbort =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      if (!isAbort) {
        toast.error(e instanceof Error ? e.message : "Error en análisis");
      }
    } finally {
      streamControllersRef.current.delete(controller);
      setAnalyzing(false);
      setAnalysisStartedAt(null);
    }
  };

  // ─── generate all variations: warm-up + parallel fan-out ────────────
  // Strategy: run the FIRST variation alone so OpenAI prompt caching
  // (frames + analysis + transcription + product info, ~150k tokens marked
  // cache_control: ephemeral in api.generate-variations) is fully populated.
  // Then fire the remaining variations in parallel — they all hit the cache
  // as cache_read (0.10x input price) instead of each paying cache_creation
  // (1.25x). This preserves the ~65% input-cost savings while collapsing the
  // wall-clock time from N×T (serial) to ~2T (one warm + one parallel batch).
  // cap_exceeded still aborts cleanly: if the warm-up hits the cap, we skip
  // the fan-out; if a parallel call hits the cap, the rest of the batch has
  // already been dispatched and either hits the cap too (no real work done
  // on the server beyond the cap check) or completes harmlessly.
  const generateAll = async () => {
    if (!analysis) { toast.error("Genera el análisis primero"); return; }
    if (!projectId) { toast.error("Falta el proyecto"); return; }
    const toRun = VARIATIONS.filter((v) => selected.has(v.type));
    if (toRun.length === 0) { toast.error("Seleccioná al menos una variación"); return; }
    setRunning(true);
    let ok = 0;
    let failed = 0;
    let aborted = false;
    try {
      const [warmup, ...rest] = toRun;
      try {
        await runOneVariation(warmup.type, warmup.label);
        ok++;
      } catch (e) {
        failed++;
        if (e instanceof Error && e.message === "cap_exceeded") {
          aborted = true;
          toast.error("Tope diario alcanzado — batch detenido");
        }
      }
      if (!aborted && rest.length > 0) {
        const results = await Promise.allSettled(
          rest.map((v) => runOneVariation(v.type, v.label)),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            ok++;
          } else {
            failed++;
            if (r.reason instanceof Error && r.reason.message === "cap_exceeded") {
              aborted = true;
            }
          }
        }
        if (aborted) toast.error("Tope diario alcanzado durante el batch");
      }
      if (!aborted) {
        if (failed === 0) toast.success(`${ok} variaciones completadas`);
        else toast.warning(`${ok}/${toRun.length} completadas · ${failed} con error`);
      }
    } finally {
      setRunning(false);
    }
  };

  const runOneVariation = async (type: string, label: string) => {
    if (!workspaceId) {
      toast.error("Falta el workspace");
      return;
    }
    if (!projectId) {
      toast.error("Falta el proyecto. Vuelve a hacer click en 'Analizar video'.");
      return;
    }
    setVariations((prev) =>
      prev.map((v) => v.type === type
        ? { ...v, status: "running", text: "", scenes: [], error: undefined, costUsd: 0 }
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

    // Hoisted so catch/finally can clean up the controller registration.
    const controller = new AbortController();
    streamControllersRef.current.add(controller);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");

      const res = await fetch("/api/generate-variations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        signal: controller.signal,
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
      if (await handleCapResponse(res)) {
        setVariations((prev) =>
          prev.map((v) => v.type === type
            ? { ...v, status: "error", error: "Tope diario alcanzado" }
            : v),
        );
        throw new Error("cap_exceeded");
      }
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let full = "";
      let cost = 0;
      let truncated = false;
      let validation: ScriptValidation | null = null;
      let streamCutEarly = false;

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            // Tight try/catch: only swallow JSON.parse failures. A wider
            // catch silences the intentional `throw` on the error branch,
            // which caused upstream 429s to surface as "done $0 sin escenas".
            let ev:
              | { type: "text"; text: string }
              | { type: "done"; fullText: string; costUsd: number; isTruncated: boolean; validation?: ScriptValidation | null }
              | { type: "error"; error: string };
            try {
              ev = JSON.parse(dataLine.slice(6).trim());
            } catch {
              continue;
            }
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
          }
        }
      } catch (streamErr) {
        // Si ya tenemos al menos 3 escenas, no descartamos el trabajo.
        const sceneCount = (full.match(/═{3,}\s*(ESCENA|SCENE)\b/gi) ?? []).length;
        if (sceneCount < 3) throw streamErr;
        streamCutEarly = true;
        console.warn(
          `[runOneVariation:${type}] Stream cortado tras ${sceneCount} escenas — persistiendo igual:`,
          streamErr,
        );
      }

      const scenes = parseScenes(full);

      setVariations((prev) =>
        prev.map((v) => v.type === type
          ? { ...v, status: truncated ? "truncated" : "done", text: full, scenes, costUsd: cost, variationId, validation }
          : v),
      );

      if (streamCutEarly) {
        toast.warning(`${label}: conexión cortada, pero ${scenes.length} escenas se guardaron`);
      }

      // Avisa cuando una variación se sale del rango esperado (~$0.10–$0.30).
      // Si pasa $0.50 algo raro paso (loop largo, retry costoso); muestralo.
      if (Number(cost) > 0.5) {
        toast.warning(
          `${label}: $${Number(cost).toFixed(3)} USD — costo más alto de lo normal (esperado ~$0.10–$0.30). Avisá si se repite.`,
          { duration: 8000 },
        );
      }

      // persist
      if (variationId) {
        await supabase.from("variations").update({
          full_text: full,
          script: full.slice(0, 4000),
          is_truncated: truncated,
        }).eq("id", variationId);
        if (scenes.length > 0) {
          const frameAssignments = assignUniqueFrames(scenes, frames);
          // Capture inserted ids + order_idx so we can auto-fire Higgsfield
          // prompt generation in parallel without making the user click
          // "Generar prompts" on every scene.
          const { data: insertedScenes } = await supabase
            .from("variation_scenes")
            .insert(
              scenes.map((s, idx) => ({
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
                reference_frame_time_sec: frameAssignments[idx]?.time ?? null,
                reference_frame_url: frameAssignments[idx]?.dataUrl ?? null,
              })),
            )
            .select("id, order_idx");

          // Narrow the Supabase return type: order_idx en el schema es
          // number|null, pero insertamos siempre con s.orderIdx (number), así
          // que en la práctica viene no-null. Filtramos defensivamente para
          // cerrar el type error sin cambiar semántica runtime.
          const validInserted = (insertedScenes ?? []).filter(
            (r): r is { id: string; order_idx: number } => r.order_idx != null,
          );
          if (validInserted.length > 0) {
            // Fire-and-forget: auto-generate Higgsfield prompts (default
            // GPT-4o multimodal, ~$0.015/scene) for all 6 scenes so the
            // user doesn't have to click "Generar prompts" on each one.
            // SceneRow's useEffect polls the DB and picks them up as they land.
            // Errors here are non-fatal — the manual button still works.
            const framesByOrderIdx = new Map<number, string | null>(
              scenes.map((s, idx) => [s.orderIdx, frameAssignments[idx]?.dataUrl ?? null]),
            );
            void autoGenScenePrompts({
              insertedScenes: validInserted,
              framesByOrderIdx,
              workspaceId,
              token,
              onCost: addPromptsCost,
              // Respeta la última elección del dropdown SceneRow persistida
              // en localStorage. Sin elección previa → backend usa su default
              // (GPT-4o). Esto resuelve el caso: user regenera escena 1 con
              // Opus, luego crea una nueva variación → sus 6 escenas arrancan
              // con Opus auto-gen (consistente con su preferencia reciente).
              model: readStoredHiggsfieldModel(),
            });
          }
        }
      }
    } catch (e) {
      const isAbort =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      setVariations((prev) =>
        prev.map((v) => v.type === type
          ? { ...v, status: "error", error: isAbort ? "Cancelado" : (e instanceof Error ? e.message : String(e)) }
          : v),
      );
      throw e;
    } finally {
      streamControllersRef.current.delete(controller);
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
              placeholder={transcribing ? "Transcribiendo audio…" : "Se llena automáticamente al cargar el video. Puedes editarla."}
              value={transcription}
              onChange={(e) => setTranscription(e.target.value)}
              rows={3}
              className="text-sm bg-background/60"
              disabled={transcribing}
            />
            <div className="text-[10px] text-muted-foreground">
              {transcribing
                ? "Whisper está extrayendo el audio exacto del video…"
                : "Generada con Whisper a partir del audio real del video. Edítala si hay errores."}
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
                <SelectTrigger className="w-52 h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic/claude-sonnet-4.5">Sonnet 4.5 ($3/$15)</SelectItem>
                  <SelectItem value="anthropic/claude-opus-4.5">Opus 4.5 ($5/$25) — Max calidad</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </Card>

        {/* Step 2 — Análisis resultado */}
        {(analyzing || analysis) && (
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-mono-display text-lg font-bold">Análisis de Claude</h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {analyzing ? (
                  <div className="flex items-center gap-2 min-w-[200px]">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <Progress
                      value={
                        analysis.length === 0
                          ? 2
                          : Math.min(95, Math.round((analysis.length / 22000) * 100))
                      }
                      className="h-2 w-32"
                    />
                    <span className="font-mono-display text-[11px] text-primary whitespace-nowrap">
                      {analysis.length === 0
                        ? `${analysisElapsed}s`
                        : `${Math.min(95, Math.round((analysis.length / 22000) * 100))}% · ${analysisElapsed}s`}
                    </span>
                  </div>
                ) : (
                  <Badge variant="outline" className="border-success/40 text-success">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> listo
                  </Badge>
                )}
                <span>${Number(analysisCost ?? 0).toFixed(4)} USD</span>
                {analysis && <CopyBtn text={analysis} />}
              </div>
            </div>
            {analysis ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
                {analysis}
              </pre>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-background/50 p-6 text-center text-xs text-muted-foreground">
                Claude está leyendo los {frames.length} frames… esto suele tardar 20-60 segundos.
              </div>
            )}
          </Card>
        )}

        {/* Costo del proyecto — desglose en vivo */}
        {(analysis || projectTotalCost > 0) && (
          <Card className="p-4 bg-card/60">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono-display text-xs uppercase tracking-wider text-muted-foreground">
                  Costo del proyecto
                </span>
              </div>
              <div className="font-mono-display text-lg font-bold text-primary">
                ${projectTotalCost.toFixed(4)} USD
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[11px] font-mono-display">
              <div className="rounded-md border border-border bg-background p-2">
                <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Whisper</div>
                <div className="text-foreground mt-0.5">${whisperCost.toFixed(4)}</div>
              </div>
              <div className="rounded-md border border-border bg-background p-2">
                <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Detect producto</div>
                <div className="text-foreground mt-0.5">${detectCost.toFixed(4)}</div>
              </div>
              <div className="rounded-md border border-border bg-background p-2">
                <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Análisis</div>
                <div className="text-foreground mt-0.5">${Number(analysisCost ?? 0).toFixed(4)}</div>
              </div>
              <div className="rounded-md border border-border bg-background p-2">
                <div className="text-muted-foreground uppercase tracking-wider text-[9px]">
                  Variaciones ({variationsDoneCount}/{variations.length})
                </div>
                <div className="text-foreground mt-0.5">${variationsCostSum.toFixed(4)}</div>
              </div>
              <div className="rounded-md border border-border bg-background p-2">
                <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Prompts Higgsfield</div>
                <div className="text-foreground mt-0.5">${promptsCost.toFixed(4)}</div>
              </div>
            </div>
          </Card>
        )}

        {/* Step 3 — Generar variaciones */}
        {analysis && (
          <Card className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-mono-display text-lg font-bold">Variaciones</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Marcá cuáles querés generar y tocá el botón. O usá "Generar solo esta" en cada tarjeta.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {VARIATIONS.map((vdef) => {
                    const isOn = selected.has(vdef.type);
                    return (
                      <button
                        key={vdef.type}
                        type="button"
                        onClick={() => toggleSelected(vdef.type)}
                        className={[
                          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-mono-display transition-colors",
                          isOn
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/40",
                        ].join(" ")}
                      >
                        <span>{vdef.emoji}</span>
                        <span>{vdef.label}</span>
                        {isOn ? <CheckCircle2 className="h-3 w-3" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button onClick={generateAll} disabled={running || selected.size === 0}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {running
                  ? "Generando…"
                  : selected.size === VARIATIONS.length
                    ? `⚡ Generar las ${VARIATIONS.length}`
                    : `⚡ Generar ${selected.size}`}
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
                  onPromptsCost={addPromptsCost}
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

// Distinct-shot frame assignment: for each scene (in order), pick the closest
// unused frame to its timeStartSec — BUT only if that frame's timestamp is at
// least MIN_GAP_SEC away from any previously-assigned frame's timestamp. If the
// closest unused frame is too close in time to a frame already used by an
// earlier scene, the visual content is nearly identical (e.g. talking-head at
// 1 FPS — adjacent frames look duplicated), so we return null and let the
// Higgsfield endpoint switch to B-roll mode for that scene.
// This prevents user-visible frame duplication where scenes 1 and 3 both get
// A-roll frames one second apart of the same shot. Frames extracted at 1 FPS
// make MIN_GAP_SEC = 2 a safe default — shots shorter than 2s are rare in COD
// UGC ads and we prefer losing a marginal A-roll over a duplicated-looking one.
const MIN_FRAME_GAP_SEC = 2;
// Allow a frame to be reused by a later scene if at least this many scenes
// have passed since the last assignment. In short videos (10s, 5 frames) with
// many scenes (8), the previous strict-uniqueness rule pushed the tail half of
// the script into B-ROLL even when reusing frame 0 in scene 5 would be
// visually safe (scenes far apart in narrative). 3 is conservative — adjacent
// or near-adjacent reuse is still rejected.
const MIN_SCENE_GAP_FOR_REUSE = 3;
function assignUniqueFrames(
  scenes: ParsedScene[],
  frames: ExtractedFrame[],
): Array<{ time: number; dataUrl: string } | null> {
  if (frames.length === 0) return scenes.map(() => null);
  // Track the last sceneIdx that consumed each frame index so we can reuse it
  // later if enough scenes have passed.
  const lastSceneByFrameIdx = new Map<number, number>();
  const usedTimes: number[] = [];
  const out: Array<{ time: number; dataUrl: string } | null> = [];
  for (let sceneIdx = 0; sceneIdx < scenes.length; sceneIdx++) {
    const s = scenes[sceneIdx];
    const target = s.timeStartSec ?? 0;
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const lastUsed = lastSceneByFrameIdx.get(i);
      // Skip frames used too recently (within the LRU gap). On first pass the
      // map has no entry; subsequent reuse must respect MIN_SCENE_GAP_FOR_REUSE.
      if (lastUsed != null && sceneIdx - lastUsed < MIN_SCENE_GAP_FOR_REUSE) continue;
      const d = Math.abs(frames[i].time - target);
      if (d < bestDelta) { bestDelta = d; bestIdx = i; }
    }
    if (bestIdx === -1) {
      out.push(null); // No usable frame — Higgsfield endpoint will use B-roll mode
      continue;
    }
    const frameTime = frames[bestIdx].time;
    // Visual-duplicate guard: if this frame sits within MIN_FRAME_GAP_SEC of
    // any frame assigned to a recent scene, mark this scene as B-roll instead.
    const tooClose = usedTimes.some((t) => Math.abs(t - frameTime) < MIN_FRAME_GAP_SEC);
    if (tooClose) {
      out.push(null);
    } else {
      lastSceneByFrameIdx.set(bestIdx, sceneIdx);
      usedTimes.push(frameTime);
      out.push({ time: frameTime, dataUrl: frames[bestIdx].dataUrl });
    }
  }
  return out;
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

function VariationCard({ v, frames, videoUrl: _videoUrl, workspaceId, running, onGenerate, onPromptsCost }: {
  v: VariationState; frames: ExtractedFrame[]; videoUrl: string | null; workspaceId: string | null;
  running?: boolean;
  onGenerate?: () => void | Promise<void>;
  onPromptsCost?: (c: number) => void;
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
              onPromptsCost={onPromptsCost}
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

type HiggsfieldPrompts = {
  image_prompt: string;
  kling: string;
  seedance: string;
};

function SceneRow({ s, frames, workspaceId, variationId, onPromptsCost }: {
  s: ParsedScene;
  frames: ExtractedFrame[];
  workspaceId: string | null;
  variationType: string;
  variationId?: string;
  onPromptsCost?: (c: number) => void;
}) {
  const [sceneDbId, setSceneDbId] = useState<string | null>(null);
  const [assignedFrameTime, setAssignedFrameTime] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<HiggsfieldPrompts | null>(null);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  // Row never appeared in the DB after SCENE_FIND_BUDGET retries — an upstream
  // persist failure the user can only fix by reloading. Differs from "prompts
  // still auto-generating" which is handled silently by self-heal.
  const [rowMissing, setRowMissing] = useState(false);
  // Scene was assigned a B-roll slot by assignUniqueFrames (reference_frame_time_sec
  // is null in DB because the video had no distinct visual moment for this beat).
  // Rendered as a small badge next to the scene title so the user can see at a
  // glance which scenes will be support / cutaway shots.
  const [isBroll, setIsBroll] = useState(false);
  // Self-heal state: when the initial worker-pool auto-gen fails (tab closed
  // mid-run, permanent 4xx, DB update 500, page reload), SceneRow itself fires
  // a recovery request — with Haiku fallback — so the user never has to click
  // the "Generar prompts" button. Rotating infinite exponential backoff means
  // we never give up silently.
  const [selfHealInFlight, setSelfHealInFlight] = useState(false);
  const selfHealAttemptsRef = useRef(0);
  const selfHealTimerRef = useRef<number | null>(null);
  // Modelo Claude para regenerar prompts de esta escena. Default GPT-4o:
  // mejor fidelidad multimodal que Haiku (Haiku se saltaba detalles críticos
  // tipo "liendrera" vs "peine" o vértebras dramáticas vs genéricas). GPT-4o
  // queda como fallback cuando ni Sonnet acierta (composites anatómicos, 3D).
  // Se inicializa desde localStorage para que la elección del user persista
  // entre sesiones y aplique también al auto-gen de nuevas variaciones.
  const [higgsfieldModel, setHiggsfieldModel] = useState<HiggsfieldModelChoice>(
    () => readStoredHiggsfieldModel() ?? "sonnet",
  );

  const refFrameUrl = useMemo(
    () => pickFrameAt(frames, assignedFrameTime),
    [frames, assignedFrameTime],
  );

  // Resolve the scene DB id (created during persist) by variation_id + order_idx.
  // Row is inserted AFTER setVariations fires, so retry briefly until it shows up.
  // After the row exists, KEEP polling (with a longer interval and budget) so we
  // pick up the auto-generated Higgsfield prompts as they land — those are
  // written async by autoGenScenePrompts firing immediately after persist.
  // When the polling grace period elapses without prompts landing, we stop
  // polling and trigger selfHealPrompts() instead of surfacing a manual CTA —
  // SceneRow owns its own recovery so the user never sees a "Generar prompts"
  // button for missing prompts (the button remains as a voluntary regenerate
  // action for scenes that already succeeded).
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    // Reset the self-heal attempt counter whenever this row gets a new
    // variation/order to track. Without this, navigating between variations or
    // remounting after an error left the ref at its terminal value (e.g. 5),
    // which made the next backoff schedule fire ~10min later instead of the
    // 30s baseline — UI looked frozen even though the row was healthy.
    selfHealAttemptsRef.current = 0;
    if (selfHealTimerRef.current !== null) {
      window.clearTimeout(selfHealTimerRef.current);
      selfHealTimerRef.current = null;
    }
    const SCENE_FIND_BUDGET = 8;       // ~4s @ 500ms — find the inserted row
    // 240s @ 1.5s = 360s grace window. Covers Opus worst case (~300s end-to-end
    // with 6-attempt retry chain). After this window, self-heal kicks in with
    // its own retry cascade and Haiku fallback — we never give up.
    const PROMPTS_WAIT_BUDGET = 240;
    const tryFetch = async (): Promise<void> => {
      if (!variationId || cancelled) return;
      const { data } = await supabase
        .from("variation_scenes")
        .select("id, prompt_nano_banana, prompt_seedream, prompt_kling, prompt_seedance, reference_frame_time_sec")
        .eq("variation_id", variationId)
        .eq("order_idx", s.orderIdx)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setSceneDbId(data.id);
        // Prefer the unique-assigned frame time from DB over the script-parsed one
        if (data.reference_frame_time_sec != null) {
          setAssignedFrameTime(Number(data.reference_frame_time_sec));
          setIsBroll(false);
        } else {
          // assignUniqueFrames parked this scene in B-roll mode — no distinct
          // frame was available at this beat. Flag it so the title can show a
          // "B-ROLL" badge and the user knows this is a creative support shot.
          setIsBroll(true);
        }
        const hasPrompts = data.prompt_nano_banana && data.prompt_kling && data.prompt_seedance;
        if (hasPrompts) {
          setPrompts({
            image_prompt: capImagePromptClient(data.prompt_nano_banana!),
            kling: data.prompt_kling ?? "",
            seedance: data.prompt_seedance ?? "",
          });
          return; // done — prompts present, no more polling needed
        }
        // Row exists but auto-generated prompts haven't landed yet. Keep
        // polling at a slower cadence within the prompts-wait budget.
        if (tries++ < SCENE_FIND_BUDGET + PROMPTS_WAIT_BUDGET) {
          pollTimer = setTimeout(() => { if (!cancelled) void tryFetch(); }, 1500);
        } else {
          // Budget exhausted. The worker pool either failed, was killed by a
          // tab close, or the user reopened a stale variation. Trigger the
          // self-heal cascade instead of surfacing a manual CTA.
          void selfHealPrompts();
        }
      } else if (tries++ < SCENE_FIND_BUDGET) {
        pollTimer = setTimeout(() => { if (!cancelled) void tryFetch(); }, 500);
      } else {
        // Scene row never appeared (insert failed or RLS mismatch). This is a
        // DB-level problem self-heal cannot fix — expose a reload hint.
        setRowMissing(true);
      }
    };
    void tryFetch();
    // Cleanup: cancelar el flag Y matar el setTimeout pendiente. Sin clearTimeout
    // los polls fantasma seguían pegándole a Supabase después de unmount —
    // visible en la consola del browser al navegar entre variaciones rápido.
    return () => {
      cancelled = true;
      if (pollTimer != null) clearTimeout(pollTimer);
    };
    // selfHealPrompts is declared below with useCallback — TypeScript warns
    // about the forward reference but the closure captures the stable ref via
    // React's state model. Intentional: we want tryFetch to invoke the latest
    // selfHealPrompts at call time, not bind it at effect setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variationId, s.orderIdx]);

  // Cleanup the self-heal retry timer on unmount to avoid leaked timers firing
  // after the user navigates away from this variation.
  useEffect(() => {
    return () => {
      if (selfHealTimerRef.current !== null) {
        window.clearTimeout(selfHealTimerRef.current);
        selfHealTimerRef.current = null;
      }
    };
  }, []);

  // Silent auto-recovery: invoked when the polling grace window elapses without
  // prompts landing. Tries the user's selected model first, then falls back to
  // Haiku (cheapest + most rate-limit-tolerant). On total failure, reschedules
  // itself with exponential backoff (30s, 60s, 120s, 240s, 480s, cap 600s) so
  // the scene eventually succeeds without the user clicking anything. A 402
  // spending-cap response is the only terminal state — we log and abandon
  // because retrying would just hit the cap again.
  const selfHealPrompts = useCallback(async (): Promise<void> => {
    if (prompts || loadingPrompts || selfHealInFlight) return;
    if (!sceneDbId || !workspaceId) return;
    setSelfHealInFlight(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) return;
      const modelsToTry: HiggsfieldModelChoice[] =
        higgsfieldModel === "haiku" ? ["haiku"] : [higgsfieldModel, "haiku"];
      // Track whether ANY attempt was a transient failure. If every failure was
      // permanent (4xx other than 429), retrying later just burns the same 4xx
      // again — abandon instead of scheduling another self-heal.
      let sawTransient = false;
      for (const m of modelsToTry) {
        try {
          const res = await fetch("/api/generate-higgsfield-prompts", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({
              sceneId: sceneDbId,
              workspaceId,
              referenceFrameDataUrl: refFrameUrl ?? null,
              model: m,
            }),
          });
          if (res.status === 402 || res.status === 429) {
            // Drain body to release the connection before bailing.
            await res.text().catch(() => "");
            console.warn("[self-heal] spending cap reached — abandoning scene", sceneDbId);
            return;
          }
          if (!res.ok) {
            // Drain body so the underlying connection is released back to the
            // pool before we move on to the fallback model.
            await res.text().catch(() => "");
            // 5xx is transient; 4xx (other than 429 handled above) is permanent
            // — malformed payload, RLS rejection, missing scene. Permanent
            // errors won't fix themselves on the next backoff tick, so don't
            // schedule another self-heal if every attempt was permanent.
            if (res.status >= 500) sawTransient = true;
            continue;
          }
          const j = (await res.json()) as {
            ok: true;
            cached: boolean;
            costUsd: number;
            prompts: HiggsfieldPrompts;
          };
          setPrompts(j.prompts);
          if (!j.cached && Number(j.costUsd) > 0) onPromptsCost?.(Number(j.costUsd));
          selfHealAttemptsRef.current = 0;
          return;
        } catch (e) {
          // Network exception — treat as transient.
          sawTransient = true;
          console.warn("[self-heal] model failed, trying next", m, e);
        }
      }
      if (!sawTransient) {
        console.warn(
          "[self-heal] all attempts returned permanent 4xx — abandoning scene",
          sceneDbId,
        );
        return;
      }
      selfHealAttemptsRef.current += 1;
      const nextDelay = Math.min(
        30_000 * Math.pow(2, selfHealAttemptsRef.current - 1),
        600_000,
      );
      selfHealTimerRef.current = window.setTimeout(() => {
        selfHealTimerRef.current = null;
        void selfHealPrompts();
      }, nextDelay);
    } finally {
      setSelfHealInFlight(false);
    }
  }, [
    prompts,
    loadingPrompts,
    selfHealInFlight,
    sceneDbId,
    workspaceId,
    higgsfieldModel,
    refFrameUrl,
    onPromptsCost,
  ]);

  const generatePrompts = async () => {
    if (!sceneDbId) { toast.error("Escena no persistida aún"); return; }
    if (!workspaceId) { toast.error("Workspace no listo"); return; }
    // Manual regenerate cancels any pending self-heal cycle and resets the
    // backoff counter — otherwise a row that exhausted its retries stays
    // "envenenada" and the next manual click does nothing visible until reload.
    if (selfHealTimerRef.current !== null) {
      window.clearTimeout(selfHealTimerRef.current);
      selfHealTimerRef.current = null;
    }
    selfHealAttemptsRef.current = 0;
    setLoadingPrompts(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");
      const res = await fetch("/api/generate-higgsfield-prompts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sceneId: sceneDbId,
          workspaceId,
          referenceFrameDataUrl: refFrameUrl ?? null,
          // If the user already has prompts loaded, clicking the button again
          // means "regenerate" — bypass the server cache so stale compositions
          // (e.g. a prompt that ignored the reference frame) get replaced.
          forceRegenerate: !!prompts,
          model: higgsfieldModel,
        }),
      });
      if (await handleCapResponse(res)) { setLoadingPrompts(false); return; }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200));
      }
      const j = (await res.json()) as {
        ok: true;
        cached: boolean;
        costUsd: number;
        prompts: HiggsfieldPrompts;
      };
      setPrompts(j.prompts);
      // Solo acumular en el total del proyecto cuando NO viene del cache:
      // un hit cacheado cuesta $0 real (ya se pagó antes y se logueó allí).
      if (!j.cached && Number(j.costUsd) > 0) {
        onPromptsCost?.(Number(j.costUsd));
      }
      toast.success(
        j.cached
          ? "Prompts recuperados del caché"
          : `Prompts listos · $${Number(j.costUsd ?? 0).toFixed(4)} USD`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error generando prompts");
    } finally {
      setLoadingPrompts(false);
    }
  };

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="font-mono-display text-xs font-bold text-primary truncate">{s.title}</h4>
          {isBroll && (
            <Badge
              variant="secondary"
              className="text-[9px] shrink-0 bg-accent/20 text-accent-foreground border-accent/40"
              title="Esta escena no tenía un frame único en el video de referencia. El generador la trata como B-roll: un plano de apoyo creativo (producto, zona objetivo, aplicación o detalle ambiental)."
            >
              B-ROLL
            </Badge>
          )}
        </div>
        {s.toolRecommended && (
          <Badge variant="outline" className="text-[10px] shrink-0">{s.toolRecommended}</Badge>
        )}
      </div>
      {/* Flex layout: frame fijo 80px a la izquierda si existe; si no, el
          contenido ocupa el ancho completo. El grid 2-col anterior dejaba una
          columna fantasma de 80px cuando no había refFrameUrl y empujaba todo
          el texto a una columna ultra-angosta. */}
      <div className="flex gap-3 items-start flex-wrap sm:flex-nowrap">
        {s.timeStartSec != null && refFrameUrl && (
          <img
            src={refFrameUrl}
            alt={`ref ${s.timeStartSec}s`}
            className="w-20 h-auto rounded border border-border shrink-0"
          />
        )}
        <div className="space-y-2 min-w-0 flex-1">
          <PromptField label="Script (ES)" text={s.scriptEs} />
          {s.screenText && <PromptField label="Screen text" text={s.screenText} />}
          {s.attachNote && <PromptField label="Attach note" text={s.attachNote} />}
          {/* Los prompts RAW del script (image/animation en inglés) NO se
              muestran: son input interno para el generador Claude que produce
              los prompts optimizados y capped en el bloque Higgsfield de abajo.
              Ver el prompt raw confundía al usuario — intentaba pegarlo en
              Seedream (que tiene cap de 3000 chars) y no funcionaba. */}
        </div>
      </div>

      {/* Higgsfield Prompts block — bordeado con color primario para que sea
          el ancla visual obvia: acá salen los prompts capped a 2500 chars
          listos para pegar en Higgsfield.ai. */}
      <div className="mt-3 rounded-md border-2 border-primary/40 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] uppercase tracking-wider font-bold text-primary">
              Prompts para Higgsfield (listos para pegar)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={higgsfieldModel}
              onChange={(e) => {
                const v = e.target.value as HiggsfieldModelChoice;
                setHiggsfieldModel(v);
                writeStoredHiggsfieldModel(v);
              }}
              disabled={loadingPrompts}
              aria-label="Modelo Claude para generar prompts Higgsfield"
              className="h-7 rounded-md border border-border bg-background px-2 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              title="Modelo Claude para generar los prompts de esta escena. Se recuerda entre sesiones."
            >
              <option value="sonnet">GPT-4o · recomendado</option>
              <option value="opus">GPT-4o · máxima fidelidad</option>
              <option value="haiku">GPT-4o-mini · más barato</option>
            </select>
            <Button
              size="sm"
              onClick={generatePrompts}
              disabled={loadingPrompts || !sceneDbId}
              className="h-7 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px]"
            >
              {loadingPrompts ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              {prompts ? "Regenerar prompts" : "Generar prompts"}
            </Button>
          </div>
        </div>
        {!prompts && !loadingPrompts && !rowMissing && (
          <div className="text-[11px] text-muted-foreground leading-relaxed flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span>
              {selfHealInFlight
                ? "Recuperando prompts automáticamente (fallback Haiku si hace falta)…"
                : selfHealAttemptsRef.current > 0
                  ? `Reintentando auto-generación (intento ${selfHealAttemptsRef.current + 1})… aparecen acá cuando terminan.`
                  : "Auto-generando prompts Higgsfield en segundo plano con reintentos automáticos… aparecen acá cuando terminan."}
            </span>
          </div>
        )}
        {!prompts && !loadingPrompts && rowMissing && (
          <div className="text-[11px] text-red-500 leading-relaxed">
            La escena no se guardó en la base de datos. Recargá la página para reintentar.
          </div>
        )}

        {prompts && (
          <Tabs defaultValue="image_prompt" className="w-full">
            <TabsList className="grid w-full grid-cols-3 h-8">
              <TabsTrigger value="image_prompt" className="text-[10px] py-1">Imagen (Nano Banana / Seedream)</TabsTrigger>
              <TabsTrigger value="kling" className="text-[10px] py-1">Kling 2.5</TabsTrigger>
              <TabsTrigger value="seedance" className="text-[10px] py-1">Seedance 2.0</TabsTrigger>
            </TabsList>
            <TabsContent value="image_prompt" className="mt-2">
              <HiggsPromptBlock
                label="Prompt imagen (Nano Banana Pro / Seedream 4.5)"
                hint="Pegalo igual en Nano Banana Pro o Seedream 4.5 dentro de Higgsfield."
                text={prompts.image_prompt}
              />
            </TabsContent>
            <TabsContent value="kling" className="mt-2">
              <HiggsPromptBlock
                label="Video · motion-from-reference"
                hint="Adjuntá la imagen generada como primer frame en Kling 2.5 Turbo. Este prompt describe sólo el movimiento."
                text={prompts.kling}
              />
            </TabsContent>
            <TabsContent value="seedance" className="mt-2">
              <HiggsPromptBlock
                label="Video · motion arc"
                hint="Pegalo en Seedance 2.0 (Higgsfield). Arco cinematográfico."
                text={prompts.seedance}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function HiggsPromptBlock({ label, hint, text }: { label: string; hint: string; text: string }) {
  return (
    <div className="space-y-1.5 rounded border border-border bg-background/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <CopyBtn text={text} label="Copiar" />
      </div>
      <div className="font-mono-display text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
        {text}
      </div>
      <div className="text-[10px] text-muted-foreground italic">{hint}</div>
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
        {progressPct(v)}%
      </Badge>
    );
  }
  if (v.status === "error") return <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">error</Badge>;
  if (v.status === "truncated") return <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">truncado · {progressPct(v)}% · ${Number(v.costUsd ?? 0).toFixed(4)}</Badge>;
  return (
    <Badge variant="outline" className="border-success/40 text-success text-[10px]">
      <Wand2 className="h-2.5 w-2.5 mr-1" />
      ${Number(v.costUsd ?? 0).toFixed(4)}
    </Badge>
  );
}
