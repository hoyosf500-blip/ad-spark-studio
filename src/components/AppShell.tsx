import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  SidebarProvider, SidebarTrigger, SidebarInset, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, Wand2, Sparkles, Library, FolderKanban, Shield, LogOut,
  Zap,
} from "lucide-react";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

const NAV_MAIN = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/variations", label: "Variaciones", icon: Wand2 },
  { to: "/ugc", label: "UGC", icon: Sparkles },
] as const;

const NAV_LIBRARY = [
  { to: "/library", label: "Library", icon: Library },
  { to: "/projects", label: "Proyectos", icon: FolderKanban },
] as const;

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof LayoutDashboard }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={label}>
        <Link
          to={to}
          activeProps={{
            className:
              "bg-primary/15 text-primary font-semibold border-l-2 border-primary",
          }}
          inactiveProps={{
            className:
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground border-l-2 border-transparent",
          }}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors"
        >
          <Icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{label}</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppSidebar() {
  const { profile, user, signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();

  const initials = (profile?.full_name || profile?.email || "U")
    .split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate font-mono-display text-sm font-bold text-sidebar-foreground">
                Ad Factory
              </div>
              <div className="truncate text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                Studio
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
              Crear
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV_MAIN.map((item) => <NavItem key={item.to} {...item} />)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
              Workspace
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV_LIBRARY.map((item) => <NavItem key={item.to} {...item} />)}
              {profile?.is_admin && (
                <NavItem to="/admin" label="Admin" icon={Shield} />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-sidebar-accent/40 px-2 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/20 text-xs font-bold text-primary">
                {initials}
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-xs font-medium text-sidebar-foreground">
                  {profile?.full_name || profile?.email?.split("@")[0]}
                </div>
                <div className="truncate text-[10px] text-sidebar-foreground/60">
                  {profile?.is_admin ? "Administrador" : "Usuario"}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title="Cerrar sesión"
              onClick={async () => { await signOut(); navigate({ to: "/" }); }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost" size="icon" className="h-8 w-8 mx-auto"
            title="Cerrar sesión"
            onClick={async () => { await signOut(); navigate({ to: "/" }); }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function TopBar() {
  const { profile, user, refreshProfile } = useAuth();
  const location = useLocation();

  // Realtime: refresh profile when total_cost_usd changes
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`profile-cost-${user.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        () => refreshProfile())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, refreshProfile]);

  const cost = Number(profile?.total_cost_usd ?? 0).toFixed(3);
  const pageTitle = (() => {
    const p = location.pathname;
    if (p.startsWith("/dashboard")) return "Dashboard";
    if (p.startsWith("/variations")) return "Variaciones";
    if (p.startsWith("/ugc")) return "UGC Generator";
    if (p.startsWith("/library")) return "Library";
    if (p.startsWith("/projects")) return "Proyectos";
    if (p.startsWith("/admin")) return "Admin";
    return "Studio";
  })();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3 min-w-0">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div className="hidden md:block h-5 w-px bg-border" />
        <h1 className="font-mono-display text-sm font-bold text-foreground truncate">
          {pageTitle}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <WorkspaceSwitcher />
        <Badge
          variant="outline"
          className="hidden sm:flex h-8 items-center gap-1.5 border-primary/30 bg-primary/5 px-3 font-mono-display text-[11px]"
        >
          <span className="text-muted-foreground">COST</span>
          <span className="font-bold text-primary">${cost}</span>
        </Badge>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider
      style={{
        "--sidebar-width": "16rem",
        "--sidebar-width-icon": "3rem",
      } as React.CSSProperties}
    >
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <SidebarInset className="flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 overflow-x-hidden">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
