import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { VariationsPanel } from "@/components/VariationsPanel";

export const Route = createFileRoute("/variations")({
  component: VariationsRoute,
});

function VariationsRoute() {
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
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <div>
          <h1 className="font-mono-display text-2xl font-bold">Variaciones</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sube un video ganador → analiza con Claude → genera 6 variaciones con escenas listas para producción.
            Genera también <span className="text-primary">UGC testimoniales</span> debajo del análisis.
          </p>
        </div>
        <VariationsPanel />
      </div>
    </AppShell>
  );
}
