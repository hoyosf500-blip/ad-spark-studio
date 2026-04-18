import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  Wand2, Sparkles, Library as LibraryIcon, FolderKanban, TrendingUp, DollarSign,
  Image as ImageIcon, Video, Plus,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

type Stats = {
  projects: number;
  variations: number;
  ugc: number;
  images: number;
  videos: number;
  costToday: number;
};

function DashboardPage() {
  const { user, loading, profile, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<{ id: string; name: string; status: string; updated_at: string }[]>([]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "signin" } });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    (async () => {
      const ws = activeWorkspaceId;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [proj, vars, ugc, imgs, vids, usage] = await Promise.all([
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
        supabase.from("variations").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
        supabase.from("ugc_generations").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
        supabase.from("image_generations").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
        supabase.from("video_generations").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
        supabase.from("api_usage").select("cost_usd").eq("workspace_id", ws).gte("created_at", since),
      ]);
      const costToday = (usage.data ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
      setStats({
        projects: proj.count ?? 0,
        variations: vars.count ?? 0,
        ugc: ugc.count ?? 0,
        images: imgs.count ?? 0,
        videos: vids.count ?? 0,
        costToday,
      });
      const { data: rec } = await supabase
        .from("projects")
        .select("id,name,status,updated_at")
        .eq("workspace_id", ws)
        .order("updated_at", { ascending: false })
        .limit(5);
      setRecent(rec ?? []);
    })();
  }, [activeWorkspaceId]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-mono-display text-sm text-muted-foreground">loading…</div>
      </div>
    );
  }

  const greet = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  })();
  const today = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const totalCost = Number(profile?.total_cost_usd ?? 0).toFixed(2);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Greeting + quick actions */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-mono-display text-3xl font-bold text-foreground">{greet}</h1>
            <p className="text-xs capitalize text-muted-foreground mt-1">{today}</p>
          </div>
          <div className="flex gap-2">
            <Button asChild className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <Link to="/variations"><Plus className="h-4 w-4" /> Nueva variación</Link>
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <Link to="/ugc"><Sparkles className="h-4 w-4" /> Nuevo UGC</Link>
            </Button>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Proyectos" value={stats?.projects ?? "—"} icon={FolderKanban} />
          <KpiCard label="Variaciones" value={stats?.variations ?? "—"} icon={Wand2} accent />
          <KpiCard label="UGC" value={stats?.ugc ?? "—"} icon={Sparkles} />
          <KpiCard label="Imágenes" value={stats?.images ?? "—"} icon={ImageIcon} />
          <KpiCard label="Videos" value={stats?.videos ?? "—"} icon={Video} />
          <KpiCard
            label="Costo total"
            value={`$${totalCost}`}
            icon={DollarSign}
            sub={stats ? `+$${stats.costToday.toFixed(3)} hoy` : "—"}
            accent
          />
        </div>

        {/* Recent projects + quick actions */}
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 bg-card border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-mono-display text-sm font-bold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Proyectos recientes
              </h2>
              <Button variant="ghost" size="sm" asChild className="text-xs">
                <Link to="/projects">Ver todos →</Link>
              </Button>
            </div>
            {recent.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center">
                <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-xs text-muted-foreground">Aún no hay proyectos</p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link to="/variations"><Plus className="h-3 w-3 mr-1" /> Crear el primero</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {recent.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(p.updated_at).toLocaleString("es-CO")}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="bg-card border-border p-4">
            <h2 className="font-mono-display text-sm font-bold mb-3">Atajos</h2>
            <div className="space-y-2">
              <ShortcutLink to="/variations" icon={Wand2} title="Variaciones" desc="6 ángulos por video ganador" />
              <ShortcutLink to="/ugc" icon={Sparkles} title="UGC Generator" desc="4 estilos testimoniales" />
              <ShortcutLink to="/library" icon={LibraryIcon} title="Library" desc="Todos tus assets" />
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function KpiCard({
  label, value, icon: Icon, sub, accent,
}: { label: string; value: string | number; icon: typeof Wand2; sub?: string; accent?: boolean }) {
  return (
    <Card className={`p-4 border ${accent ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${accent ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className={`font-mono-display text-2xl font-bold ${accent ? "text-primary" : "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function ShortcutLink({
  to, icon: Icon, title, desc,
}: { to: string; icon: typeof Wand2; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-md border border-border bg-background/40 p-2.5 hover:bg-primary/5 hover:border-primary/30 transition-colors group"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary/20">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground truncate">{desc}</div>
      </div>
    </Link>
  );
}
