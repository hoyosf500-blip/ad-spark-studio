import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { FolderKanban } from "lucide-react";

export const Route = createFileRoute("/projects")({
  component: ProjectsRoute,
});

type Project = { id: string; name: string; status: string; updated_at: string; created_at: string };

function ProjectsRoute() {
  const { user, loading, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "signin" } });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLoadingList(true);
    supabase
      .from("projects")
      .select("id,name,status,updated_at,created_at")
      .eq("workspace_id", activeWorkspaceId)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        setProjects(data ?? []);
        setLoadingList(false);
      });
  }, [activeWorkspaceId]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-primary" />
          <h1 className="font-mono-display text-2xl font-bold">Proyectos</h1>
        </div>
        <Card className="p-0 border-border bg-card overflow-hidden">
          {loadingList ? (
            <div className="p-8 text-center text-xs text-muted-foreground">cargando…</div>
          ) : projects.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Sin proyectos en este workspace.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-background/40 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Nombre</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-primary/5">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="text-[10px]">{p.status}</Badge></td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {new Date(p.updated_at).toLocaleString("es-CO")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
