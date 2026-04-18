import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Wand2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/ugc")({
  component: UgcRoute,
});

function UgcRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "signin" } });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-mono-display text-sm text-muted-foreground">loading…</div>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-6">
        <Card className="p-8 border-border bg-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-mono-display text-xl font-bold">UGC Generator</h1>
              <p className="text-xs text-muted-foreground">4 estilos · 3 modelos de video</p>
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/5 p-4 mb-4">
            <p className="text-sm text-foreground">
              El UGC Generator usa el <span className="font-semibold text-primary">análisis de video</span> que produces
              en <span className="font-mono-display">Variaciones</span> para generar testimoniales realistas estilo iPhone selfie,
              kitchen chat, walk &amp; talk y couch testimonial.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Por ahora vive dentro de la pantalla de Variaciones (aparece automáticamente cuando hay un análisis listo).
              Una ruta dedicada con histórico llegará pronto.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Card className="p-4 bg-background/40 border-border">
              <div className="flex items-center gap-2 mb-2">
                <Wand2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Empezar desde cero</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Sube un video, deja que Claude lo analice y genera UGC en cualquier escena.
              </p>
              <Button asChild className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <Link to="/variations">Ir a Variaciones <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </Card>

            <Card className="p-4 bg-background/40 border-border">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Ver UGCs generados</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Tus UGCs viven en la Library junto al resto de assets del workspace.
              </p>
              <Button asChild variant="outline" className="w-full gap-2">
                <Link to="/library">Ir a Library <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </Card>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
