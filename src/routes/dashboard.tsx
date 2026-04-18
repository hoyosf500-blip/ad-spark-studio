import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
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
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-12">
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <Construction className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 font-mono-display text-xl font-bold">Dashboard</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Las pestañas <span className="text-primary">Variaciones</span> y{" "}
            <span className="text-primary">UGC Generator</span> se construyen en la Fase 1.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Por ahora puedes verificar el flujo de auth y el panel de admin.
          </p>
        </div>
      </main>
    </div>
  );
}
