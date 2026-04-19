import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Sparkles, Package, FileText, FolderKanban, AlertTriangle, Wand2, Loader2, ImageIcon, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fileToDataUrl } from "@/lib/frame-extraction";
import { UgcPanel } from "@/components/UgcPanel";

export const Route = createFileRoute("/ugc")({
  component: UgcRoute,
});

type ProjectRow = {
  id: string;
  name: string;
  analysis_text: string | null;
  transcription: string | null;
};

type Duration = "8" | "12" | "15" | "20" | "30";

const NO_PROJECT = "__viral__";

function UgcRoute() {
  const { user, loading, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(NO_PROJECT);
  const [analysisText, setAnalysisText] = useState("");
  const [transcription, setTranscription] = useState("");

  const [productName, setProductName] = useState("");
  const [productOneLiner, setProductOneLiner] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productAudience, setProductAudience] = useState("");
  const [creativeBrief, setCreativeBrief] = useState("");
  const [productPhoto, setProductPhoto] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [duration, setDuration] = useState<Duration>("12");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "signin" } });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, analysis_text, transcription")
        .eq("workspace_id", activeWorkspaceId)
        .not("analysis_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled && data) setProjects(data as ProjectRow[]);
    })();
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (selectedProjectId === NO_PROJECT) {
      setAnalysisText("");
      setTranscription("");
      return;
    }
    const p = projects.find((x) => x.id === selectedProjectId);
    if (p) {
      setAnalysisText(p.analysis_text ?? "");
      setTranscription(p.transcription ?? "");
    }
  }, [selectedProjectId, projects]);

  const productInfo = useMemo(() => {
    const s = [
      productName && `Producto: ${productName}`,
      productOneLiner && `Qué hace: ${productOneLiner}`,
      productPrice && `Precio: ${productPrice}`,
      productAudience && `Audiencia: ${productAudience}`,
    ].filter(Boolean).join("\n");
    return s || null;
  }, [productName, productOneLiner, productPrice, productAudience]);

  const handleDetect = async () => {
    if (!productPhoto) { toast.error("Sube primero una foto del producto"); return; }
    setDetecting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("No autorizado");
      const res = await fetch("/api/detect-product", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ productPhoto, workspaceId: activeWorkspaceId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        name?: string; oneLiner?: string; price?: string; audience?: string; costUsd?: number;
      };
      if (data.name) setProductName(data.name);
      if (data.oneLiner) setProductOneLiner(data.oneLiner);
      if (data.price) setProductPrice(data.price);
      if (data.audience) setProductAudience(data.audience);
      toast.success(`Datos detectados · $${Number(data.costUsd ?? 0).toFixed(4)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al detectar");
    } finally {
      setDetecting(false);
    }
  };

  const onPickPhoto = async (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Selecciona una imagen"); return; }
    try {
      const url = await fileToDataUrl(f);
      setProductPhoto(url);
    } catch {
      toast.error("No se pudo leer la imagen");
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-mono-display text-sm text-muted-foreground">loading…</div>
      </div>
    );
  }

  const isViral = selectedProjectId === NO_PROJECT;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <div>
          <h1 className="font-mono-display text-2xl font-bold">📱 UGC Video Generator</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sube foto del producto → elegí estilo y modelo → genera prompt UGC listo para el modelo IA.
          </p>
        </div>

        <Card className="p-5 space-y-4">
          <div className="flex items-start gap-2">
            <FolderKanban className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-bold">Origen del UGC</div>
              <div className="text-[11px] text-muted-foreground">
                Casual, Testimonial y Unboxing necesitan un análisis de video.
                <span className="text-primary"> Viral</span> genera fresh sin origen.
              </div>
            </div>
          </div>

          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Selecciona un proyecto analizado…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>
                Sin proyecto — solo Hook Viral
              </SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {projects.length === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <AlertTriangle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div className="text-[11px] text-muted-foreground">
                No tienes proyectos analizados todavía. Puedes generar <span className="text-primary">Hook Viral</span> desde cero,
                o ve a <span className="font-mono-display text-primary">Variaciones</span> para subir y analizar un video primero.
              </div>
            </div>
          )}
        </Card>

        {/* Guión / Transcripción — siempre visible */}
        <Card className="p-5 space-y-2">
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-bold">Guión / Transcripción (opcional)</div>
              <div className="text-[11px] text-muted-foreground">
                Si querés que diga algo específico, pegalo aquí. Se usa palabra por palabra.
              </div>
            </div>
          </div>
          <Textarea
            value={transcription}
            onChange={(e) => setTranscription(e.target.value)}
            placeholder='Ej: "Mirá lo que me llegó… esto es X, me lo recomendó mi vecina…"'
            rows={4}
            className="text-sm"
          />
          {transcription.trim() && (
            <p className="text-[11px] text-success mt-1">
              ✓ {transcription.trim().split(/\s+/).length} palabras — se usará exacto
            </p>
          )}
        </Card>

        {/* Datos del producto — foto + auto-detect + campos */}
        <Card className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Package className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-bold">Datos del producto</div>
                <div className="text-[11px] text-muted-foreground">
                  Subí una foto del producto y dejá que Claude llene los campos.
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDetect}
              disabled={!productPhoto || detecting}
              className="flex-shrink-0"
            >
              {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
              🤖 Auto-detectar
            </Button>
          </div>

          <div className="grid md:grid-cols-[140px_1fr] gap-4">
            {/* Foto */}
            <label
              className="relative h-[140px] w-[140px] rounded-lg border-2 border-dashed border-border hover:border-primary cursor-pointer flex flex-col items-center justify-center gap-1 bg-background/50 overflow-hidden transition-colors"
              title={productPhoto ? "Cambiar foto" : "Subir foto del producto"}
            >
              {productPhoto ? (
                <>
                  <img src={productPhoto} alt="producto" className="absolute inset-0 h-full w-full object-cover" />
                  <span className="absolute bottom-1 left-1 right-1 text-center text-[10px] bg-success/80 text-success-foreground rounded px-1 py-0.5">
                    ✅ Producto
                  </span>
                </>
              ) : (
                <>
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground text-center px-1">Foto producto</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
              />
            </label>

            {/* Campos */}
            <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
              <Input
                placeholder="Nombre del producto"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Precio (ej. $89.900 COP)"
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
                placeholder="Audiencia (ej. mujeres 35+ con dolor lumbar)"
                value={productAudience}
                onChange={(e) => setProductAudience(e.target.value)}
                className="h-9 text-sm md:col-span-2"
              />
              <div className="md:col-span-2">
                <Label className="text-xs">Idea creativa (opcional)</Label>
                <Textarea
                  value={creativeBrief}
                  onChange={(e) => setCreativeBrief(e.target.value)}
                  placeholder="Ej: testimonial en el carro camino al trabajo, tono relajado, cara cansada al inicio, alivio al final."
                  rows={3}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Tono, setting, personaje, emoción. No escribas dosis ni precio — esos ya los tiene.
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Selector de duración */}
        <Card className="p-5">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" /> Duración
              </Label>
              <Select value={duration} onValueChange={(v) => setDuration(v as Duration)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8 segundos</SelectItem>
                  <SelectItem value="12">12 segundos</SelectItem>
                  <SelectItem value="15">15 segundos</SelectItem>
                  <SelectItem value="20">20 segundos</SelectItem>
                  <SelectItem value="30">30 segundos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <div className="flex items-start gap-2 mt-2">
          <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-bold">Generar UGC</div>
            <div className="text-[11px] text-muted-foreground">
              4 estilos · imagen Qwen + video (Wan / Kling / Veo 3).
              {isViral && " Solo Hook Viral está disponible sin proyecto."}
            </div>
          </div>
        </div>
        <UgcPanel
          workspaceId={activeWorkspaceId}
          projectId={isViral ? null : selectedProjectId}
          sourceVideoId={null}
          analysisText={analysisText}
          transcription={transcription}
          productInfo={productInfo}
          creativeBrief={creativeBrief.trim() || null}
          productPhoto={productPhoto}
          duration={duration}
          model="claude-sonnet-4-5-20250929"
        />
      </div>
    </AppShell>
  );
}
