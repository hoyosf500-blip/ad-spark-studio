import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Sparkles, Package, FileText, FolderKanban, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
          <h1 className="font-mono-display text-2xl font-bold">UGC Generator</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Genera testimoniales realistas en 4 estilos. Usa un análisis existente o arranca en modo Viral desde cero.
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

          {!isViral && analysisText && (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-bold">Transcripción</div>
                  <div className="text-[11px] text-muted-foreground">
                    Palabra por palabra del video origen. La usa el UGC para sonar natural.
                  </div>
                </div>
              </div>
              <Textarea
                value={transcription}
                onChange={(e) => setTranscription(e.target.value)}
                rows={3}
                className="text-sm bg-background/60"
                placeholder="La transcripción se carga sola del proyecto — edítala si quieres afinarla."
              />
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <div className="flex items-start gap-2">
            <Package className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-bold">Datos del producto</div>
              <div className="text-[11px] text-muted-foreground">
                Todo opcional. Claude los usa para que el UGC mencione el nombre y el precio reales.
              </div>
            </div>
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
          model="claude-sonnet-4-5-20250929"
        />
      </div>
    </AppShell>
  );
}
