import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Library as LibraryIcon, Construction } from "lucide-react";

export const Route = createFileRoute("/library")({
  component: LibraryRoute,
});

function LibraryRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "signin" } });
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        <Card className="p-12 text-center border-dashed border-border bg-card">
          <LibraryIcon className="mx-auto h-12 w-12 text-primary/60 mb-3" />
          <h1 className="font-mono-display text-xl font-bold mb-2">Library</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            Aquí verás todos los assets generados (imágenes, videos, UGCs, variaciones, videos fuente)
            del workspace activo, con búsqueda y filtros.
          </p>
          <div className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary font-mono-display">
            <Construction className="h-3.5 w-3.5" />
            Bloque B en construcción
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
