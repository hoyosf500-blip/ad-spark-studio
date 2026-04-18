import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Users, UserCheck, DollarSign, Activity, Eye, Pause, Play, ShieldOff } from "lucide-react";

type Row = {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  total_cost_usd: number;
  daily_cap_usd: number;
  created_at: string;
};

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { profile, loading, user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ total: 0, active: 0, cost: 0, gensMonth: 0 });
  const [viewing, setViewing] = useState<Row | null>(null);
  const [viewAssets, setViewAssets] = useState<{ images: number; videos: number; ugc: number } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,is_admin,is_active,total_cost_usd,daily_cap_usd,created_at")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    else {
      const r = (data ?? []) as unknown as Row[];
      setRows(r);
      const since = new Date();
      since.setDate(1); since.setHours(0, 0, 0, 0);
      const [imgs, vids] = await Promise.all([
        supabase.from("image_generations").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
        supabase.from("video_generations").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
      ]);
      setStats({
        total: r.length,
        active: r.filter((x) => x.is_active).length,
        cost: r.reduce((s, x) => s + Number(x.total_cost_usd ?? 0), 0),
        gensMonth: (imgs.count ?? 0) + (vids.count ?? 0),
      });
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/auth", search: { mode: "signin" } }); return; }
    if (!profile?.is_admin) { navigate({ to: "/dashboard" }); return; }
    load();
  }, [profile, loading, user, navigate, load]);

  const toggleActive = async (row: Row) => {
    if (row.id === user?.id) {
      toast.error("No puedes desactivarte a ti mismo.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (error) toast.error(error.message);
    else {
      toast.success(row.is_active ? "Usuario suspendido" : "Usuario reactivado");
      load();
    }
  };

  const openAssets = async (row: Row) => {
    setViewing(row);
    setViewAssets(null);
    const [imgs, vids, ugc] = await Promise.all([
      supabase.from("image_generations").select("id", { count: "exact", head: true }).eq("user_id", row.id),
      supabase.from("video_generations").select("id", { count: "exact", head: true }).eq("user_id", row.id),
      supabase.from("ugc_generations").select("id", { count: "exact", head: true }),
    ]);
    setViewAssets({ images: imgs.count ?? 0, videos: vids.count ?? 0, ugc: ugc.count ?? 0 });
  };

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-mono-display text-sm text-muted-foreground">loading…</div>
      </div>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6">
          <h1 className="font-mono-display text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Gestión de usuarios, costos y generaciones globales.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Users} label="Total usuarios" value={stats.total.toString()} />
          <StatCard icon={UserCheck} label="Activos" value={stats.active.toString()} />
          <StatCard icon={DollarSign} label="Costo total" value={`$${Number(stats.cost ?? 0).toFixed(3)}`} />
          <StatCard icon={Activity} label="Generaciones (mes)" value={stats.gensMonth.toString()} />
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-mono-display text-sm font-bold">USERS</h2>
            <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
              Reload
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[11px] uppercase tracking-wider">Email</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider">Nombre</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider">Registro</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider">Costo</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider">Tope diario</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider">Estado</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider">Admin</TableHead>
                <TableHead className="text-right text-[11px] uppercase tracking-wider">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isMe = r.id === user?.id;
                return (
                  <TableRow key={r.id} className="border-border">
                    <TableCell className="font-medium">{r.email}{isMe && <span className="ml-1.5 text-[10px] text-primary">(tú)</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{r.full_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-mono-display text-xs">${Number(r.total_cost_usd).toFixed(3)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={Number(r.daily_cap_usd ?? 20).toFixed(2)}
                        onBlur={async (e) => {
                          const v = Number(e.target.value);
                          if (Number.isNaN(v) || v < 0) return;
                          if (v === Number(r.daily_cap_usd)) return;
                          const { error } = await supabase.from("profiles").update({ daily_cap_usd: v }).eq("id", r.id);
                          if (error) toast.error(error.message);
                          else { toast.success(`Tope de ${r.email}: $${v.toFixed(2)}`); load(); }
                        }}
                        className="h-7 w-20 text-xs"
                        disabled={!profile?.is_admin}
                      />
                    </TableCell>
                    <TableCell>
                      {r.is_active ? (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Activo</Badge>
                      ) : (
                        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Suspendido</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.is_admin ? (
                        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">Sí</Badge>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => openAssets(r)} title="Ver generaciones">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(r)}
                          disabled={isMe}
                          title={isMe ? "No puedes desactivarte" : (r.is_active ? "Suspender" : "Reactivar")}
                          className={r.is_active ? "text-destructive hover:text-destructive" : "text-success hover:text-success"}
                        >
                          {isMe ? <ShieldOff className="h-3.5 w-3.5 opacity-30" /> :
                            r.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && !busy && (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Sin usuarios</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground">
          Reglas: el admin no puede quitarse su propio rol ni suspenderse. Los usuarios suspendidos
          quedan bloqueados al iniciar sesión. La eliminación de usuarios no está permitida.
        </p>
      </main>

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono-display">{viewing?.email}</DialogTitle>
            <DialogDescription>Resumen de generaciones del usuario.</DialogDescription>
          </DialogHeader>
          {!viewAssets ? (
            <div className="py-8 text-center text-sm text-muted-foreground">cargando…</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 py-4">
              <MiniStat label="Imágenes" value={viewAssets.images} />
              <MiniStat label="Videos" value={viewAssets.videos} />
              <MiniStat label="UGC" value={viewAssets.ugc} />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            La galería detallada de assets se construye en Fase 5.
          </p>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-2 font-mono-display text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3 text-center">
      <div className="font-mono-display text-2xl font-bold text-primary">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
