import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Shield, LogOut, Zap } from "lucide-react";

export function AppHeader() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  if (!profile) return null;

  const cost = (profile.total_cost_usd ?? 0).toFixed(3);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="font-mono-display text-sm font-bold text-foreground">
            AD FACTORY <span className="text-primary">STUDIO</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
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
