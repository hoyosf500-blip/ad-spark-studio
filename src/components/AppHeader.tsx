import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Shield, LogOut, Zap, Library } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

export function AppHeader() {
  const { profile, signOut, refreshProfile, user } = useAuth();
  const navigate = useNavigate();
  const [dayStats, setDayStats] = useState<{ spent: number; cap: number } | null>(null);

  // Realtime: refresh profile when total_cost_usd changes
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`profile-cost-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        () => refreshProfile(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refreshProfile]);

  // Gasto del día: refresca al cambiar total_cost_usd o cada 30s.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    const load = async () => {
      const { data: cost } = await supabase.rpc("get_day_cost_usd", { p_user_id: profile.id });
      if (!cancelled) {
        setDayStats({
          spent: Number(cost ?? 0),
          cap: Number(profile.daily_cap_usd ?? 20),
        });
      }
    };
    load();
    const iv = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [profile?.id, profile?.total_cost_usd, profile?.daily_cap_usd]);

  if (!profile) return null;

  const cost = Number(profile.total_cost_usd ?? 0).toFixed(3);

  const dayPillClass =
    dayStats == null
      ? "border-border bg-card text-muted-foreground"
      : dayStats.spent >= dayStats.cap
        ? "border-destructive/50 bg-destructive/10 text-destructive"
        : dayStats.spent >= dayStats.cap * 0.8
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-mono-display text-sm font-bold text-foreground hidden md:inline">
              AD FACTORY <span className="text-primary">STUDIO</span>
            </span>
          </Link>
          <WorkspaceSwitcher />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/library" })}
            className="gap-1.5"
          >
            <Library className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Library</span>
          </Button>

          {dayStats && (
            <div
              className={`hidden items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono-display sm:flex ${dayPillClass}`}
              title="Gasto hoy / tope diario (Bogotá)"
            >
              <span className="opacity-70">HOY</span>
              <span className="font-bold">
                ${dayStats.spent.toFixed(2)} / ${dayStats.cap.toFixed(2)}
              </span>
            </div>
          )}

          <div className="hidden items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono-display sm:flex">
            <span className="text-muted-foreground">COST</span>
            <span className="font-bold text-primary">${cost} USD</span>
          </div>

          {profile.is_admin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: "/admin" })}
              className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
            >
              <Shield className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Admin</span>
            </Button>
          )}

          <div className="hidden text-right text-xs md:block">
            <div className="text-foreground">{profile.email}</div>
            <div className="text-muted-foreground">
              {profile.is_admin ? "Administrator" : "User"}
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate({ to: "/" }); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
