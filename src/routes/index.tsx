import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { Zap, Sparkles, Video, Layers } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-mono-display text-sm text-muted-foreground">loading…</div>
      </div>
    );
  }

  if (user) return <Navigate to="/dashboard" />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-mono-display text-sm font-bold">
              AD FACTORY <span className="text-primary">STUDIO</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth" search={{ mode: "signin" }}>
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                Sign up
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-24">
        <div className="text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-mono-display text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            CLAUDE · HIGGSFIELD · WHISPER
          </div>
          <h1 className="font-mono-display text-5xl font-bold leading-tight text-foreground">
            Video ads <span className="text-primary">factory</span><br />
            sin salir del dashboard.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            Sube un video ganador, Claude analiza frame-por-frame y genera 6 variaciones con
            prompts optimizados para Nano Banana Pro, Seedream 4.5, Kling 2.5 Turbo y Seedance 2.0.
            Pegás el prompt en Higgsfield y listo.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 glow-amber">
                Empezar gratis
              </Button>
            </Link>
            <Link to="/auth" search={{ mode: "signin" }}>
              <Button size="lg" variant="outline">Sign in</Button>
            </Link>
          </div>
        </div>

        <div className="mt-20 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { icon: Sparkles, t: "Claude analiza", d: "Frame-por-frame, 6 variaciones con guión + image prompts + animation prompts en español colombiano." },
            { icon: Layers, t: "Prompts listos para Higgsfield", d: "Salen optimizados para Nano Banana Pro y Seedream 4.5 — copy/paste, sin reescribir." },
            { icon: Video, t: "Kling + Seedance", d: "Animation prompts producidos para Kling 2.5 Turbo y Seedance 2.0, formato 9:16 vertical." },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border border-border bg-card p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-sm font-semibold">{f.t}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
