import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Wand2, Zap, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const UGC_STYLES = [
  { key: "ugc-casual", emoji: "📱", label: "Casual dolor" },
  { key: "ugc-testimonial", emoji: "🗣️", label: "Testimonial" },
  { key: "ugc-viral", emoji: "🎯", label: "Hook viral" },
  { key: "ugc-unboxing", emoji: "📦", label: "Unboxing COD" },
] as const;

const VIDEO_MODELS = [
  { key: "wan2.6-i2v", label: "Wan 2.6", cost: 0.3 },
  { key: "kling2.5-turbo", label: "Kling 2.5 Turbo", cost: 0.4 },
  { key: "veo3", label: "Veo 3", cost: 0.75 },
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
  image_generation_id: string | null;
  video_generation_id: string | null;
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
  model,
}: {
  workspaceId: string | null;
  projectId: string | null;
  sourceVideoId: string | null;
  analysisText: string;
  transcription: string;
  productInfo: string | null;
  model: string;
}) {
  const [generations, setGenerations] = useState<UgcRow[]>([]);
  const [stream, setStream] = useState<StreamState>({ active: null, text: "" });
  const [videoModel, setVideoModel] = useState<ModelKey>("wan2.6-i2v");

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
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");
      const res = await fetch("/api/ugc-generate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          workspaceId,
          projectId,
          sourceVideoId,
          style,
          analysisText,
          transcription: transcription?.trim() || null,
          productInfo,
          videoModel,
          model,
        }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 200) || res.statusText}`);
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
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const dl = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dl) continue;
          try {
            const ev = JSON.parse(dl.slice(6).trim()) as
              | { type: "text"; text: string }
              | { type: "done"; costUsd: number; fullText: string }
              | { type: "error"; error: string };
            if (ev.type === "text") {
              full += ev.text;
              setStream({ active: style, text: full });
            } else if (ev.type === "done") {
              cost = ev.costUsd;
            } else if (ev.type === "error") {
              throw new Error(ev.error);
            }
          } catch {
            /* skip */
          }
        }
      }
      toast.success(`UGC ${style} listo · $${cost.toFixed(4)}`);
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
            Testimonios reales · 4 estilos · imagen Qwen + video {VIDEO_MODELS.find((m) => m.key === videoModel)?.label}
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
                  {m.label} · ${m.cost.toFixed(2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {UGC_STYLES.map((s) => {
          const active = stream.active === s.key;
          return (
            <Button
              key={s.key}
              onClick={() => generate(s.key)}
              disabled={!!stream.active || !analysisText}
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-1 hover:border-primary"
            >
              <span className="text-xl">{s.emoji}</span>
              <span className="text-xs font-mono-display">{s.label}</span>
              {active && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            </Button>
          );
        })}
      </div>

      {stream.active && stream.text && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-primary mb-1">
            Generando {stream.active}…
          </div>
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed max-h-48 overflow-auto text-muted-foreground">
            {stream.text}
          </pre>
        </div>
      )}

      {generations.length > 0 && (
        <div className="space-y-3">
          {generations.map((g) => (
            <UgcRowCard key={g.id} row={g} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </Card>
  );
}

function UgcRowCard({ row, workspaceId }: { row: UgcRow; workspaceId: string | null }) {
  const styleMeta = UGC_STYLES.find((s) => s.key === row.style);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generatingImg, setGeneratingImg] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoTask, setVideoTask] = useState<{
    status: "idle" | "running" | "done" | "failed";
    taskId?: string;
    elapsedSec?: number;
    error?: string;
  }>({ status: "idle" });
  const [chosenModel, setChosenModel] = useState<ModelKey>((row.video_model as ModelKey) || "wan2.6-i2v");
  const tickRef = useRef<number | null>(null);

  // Resolve existing image/video
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (row.image_generation_id) {
        const { data } = await supabase
          .from("image_generations")
          .select("public_url")
          .eq("id", row.image_generation_id)
          .maybeSingle();
        if (!cancelled && data?.public_url) setImageUrl(data.public_url);
      }
      if (row.video_generation_id) {
        const { data } = await supabase
          .from("video_generations")
          .select("public_url")
          .eq("id", row.video_generation_id)
          .maybeSingle();
        if (!cancelled && data?.public_url) {
          setVideoUrl(data.public_url);
          setVideoTask({ status: "done" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.image_generation_id, row.video_generation_id]);

  const generateImage = async () => {
    if (!workspaceId || !row.image_prompt_en) {
      toast.error("Falta image prompt");
      return;
    }
    setGeneratingImg(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");
      // We don't have a scene id; use UGC id as a synthetic key (qwen endpoint stores by sceneId path).
      // To avoid touching the qwen endpoint, create a stub scene-like record? Simpler: use a placeholder sceneId
      // by pointing to a temporary variation_scenes row would be heavy. Instead we POST without sceneId by
      // adapting the endpoint? The endpoint requires sceneId. Solution: insert a placeholder into variation_scenes
      // is intrusive — instead, reuse the row.id as the sceneId (path). This is OK because qwen endpoint uses
      // sceneId only as storage path key + later updates a scene row. We will skip the scene update by passing
      // a dummy id and tolerate the resulting RLS noop on variation_scenes.
      const fakeSceneId = row.id; // valid uuid; the .update on variation_scenes will affect 0 rows (safe)
      const res = await fetch("/api/qwen-generate-image", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sceneId: fakeSceneId,
          workspaceId,
          promptEn: row.image_prompt_en,
          size: "928*1664",
          useI2I: false,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200));
      }
      const j = (await res.json()) as { imageUrl: string; imageId: string; costUsd: number };
      setImageUrl(j.imageUrl);
      // Link image into UGC row + accumulate cost
      const newCost = Number(row.cost_usd) + Number(j.costUsd ?? 0);
      await supabase
        .from("ugc_generations")
        .update({ image_generation_id: j.imageId, cost_usd: newCost })
        .eq("id", row.id);
      toast.success(`Imagen lista · $${j.costUsd.toFixed(2)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error imagen");
    } finally {
      setGeneratingImg(false);
    }
  };

  const generateVideo = async () => {
    if (!workspaceId || !imageUrl || !row.animation_prompt_en) {
      toast.error("Falta imagen o prompt");
      return;
    }
    const endpoint =
      chosenModel === "wan2.6-i2v"
        ? "/api/wan-create-task"
        : chosenModel === "kling2.5-turbo"
          ? "/api/kling-create-task"
          : "/api/veo3-create-task";
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No auth session");
      const body: Record<string, unknown> =
        chosenModel === "wan2.6-i2v"
          ? {
              sceneId: row.id, // wan endpoint requires sceneId; fakeSceneId pattern same as image
              workspaceId,
              imageUrl,
              promptEn: row.animation_prompt_en,
              size: "720*1280",
              duration: 5,
            }
          : {
              workspaceId,
              imageUrl,
              promptEn: row.animation_prompt_en,
              ugcId: row.id,
              size: "720*1280",
              duration: 5,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200));
      }
      const j = (await res.json()) as { taskId: string };
      const startedAt = Date.now();
      setVideoTask({ status: "running", taskId: j.taskId, elapsedSec: 0 });

      // Poll loop
      const tick = window.setInterval(() => {
        setVideoTask((cur) =>
          cur.status === "running"
            ? { ...cur, elapsedSec: Math.round((Date.now() - startedAt) / 1000) }
            : cur,
        );
      }, 1000);
      tickRef.current = tick;

      const pollEndpoint =
        chosenModel === "wan2.6-i2v"
          ? "/api/wan-poll-task"
          : chosenModel === "kling2.5-turbo"
            ? "/api/kling-poll-task"
            : "/api/veo3-poll-task";

      const pollOnce = async () => {
        try {
          const r = await fetch(pollEndpoint, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ taskId: j.taskId }),
          });
          if (!r.ok) return;
          const out = (await r.json()) as
            | { status: "running" }
            | { status: "done"; videoUrl: string; videoId: string; costUsd: number }
            | { status: "failed"; error: string };
          if (out.status === "done") {
            setVideoUrl(out.videoUrl);
            setVideoTask({ status: "done" });
            window.clearInterval(tick);
            window.clearInterval(poll);
            // For wan we have to manually link the video to UGC + accumulate cost
            // (kling/veo3 helper does it server-side via ugcId)
            if (chosenModel === "wan2.6-i2v" && out.videoId) {
              const newCost = Number(row.cost_usd) + Number(out.costUsd ?? 0);
              await supabase
                .from("ugc_generations")
                .update({ video_generation_id: out.videoId, cost_usd: newCost, video_model: chosenModel })
                .eq("id", row.id);
            } else {
              await supabase
                .from("ugc_generations")
                .update({ video_model: chosenModel })
                .eq("id", row.id);
            }
            toast.success(`Video listo · $${out.costUsd.toFixed(2)}`);
          } else if (out.status === "failed") {
            setVideoTask({ status: "failed", error: out.error });
            window.clearInterval(tick);
            window.clearInterval(poll);
            toast.error(`Video falló: ${out.error}`);
          }
        } catch {
          /* ignore */
        }
      };
      pollOnce();
      const poll = window.setInterval(pollOnce, 20000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error video");
    }
  };

  useEffect(() => () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
  }, []);

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-base">{styleMeta?.emoji}</span>
          <span className="font-mono-display text-sm font-bold">{styleMeta?.label}</span>
        </div>
        <Badge variant="outline" className="border-success/40 text-success text-[10px]">
          <CheckCircle2 className="h-3 w-3 mr-1" /> ${Number(row.cost_usd ?? 0).toFixed(4)}
        </Badge>
      </div>

      <div className="p-4 space-y-3">
        {row.script_text && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Script (ES)</div>
            <p className="text-xs leading-relaxed">{row.script_text}</p>
          </div>
        )}
        {row.animation_prompt_en && (
          <details className="text-xs">
            <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground">
              Animation prompt (EN)
            </summary>
            <pre className="whitespace-pre-wrap font-mono-display text-[11px] mt-1 max-h-40 overflow-auto">
              {row.animation_prompt_en}
            </pre>
          </details>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={generateImage}
            disabled={generatingImg || !!imageUrl}
            className="h-8 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px]"
          >
            {generatingImg ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            {imageUrl ? "Imagen lista" : "Generar imagen ($0.04)"}
          </Button>

          <Select value={chosenModel} onValueChange={(v) => setChosenModel(v as ModelKey)}>
            <SelectTrigger className="h-8 w-36 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_MODELS.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label} · ${m.cost.toFixed(2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {videoTask.status === "idle" && (
            <Button
              size="sm"
              onClick={generateVideo}
              disabled={!imageUrl}
              className="h-8 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px]"
            >
              <Zap className="h-3 w-3" /> Generar video
            </Button>
          )}
          {videoTask.status === "running" && (
            <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
              <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" /> ⏱ {videoTask.elapsedSec}s
            </Badge>
          )}
          {videoTask.status === "failed" && (
            <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
              <AlertTriangle className="h-2.5 w-2.5 mr-1" /> {videoTask.error?.slice(0, 50)}
            </Badge>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {imageUrl && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Imagen</div>
              <a href={imageUrl} target="_blank" rel="noreferrer">
                <img src={imageUrl} alt="ugc" className="w-full h-auto rounded border border-border" />
              </a>
            </div>
          )}
          {videoUrl && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Video</div>
              <video controls src={videoUrl} className="w-full h-auto rounded border border-border" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
