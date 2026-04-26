import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { batchSignedUrls, videoPosterUrl } from "@/lib/signed-urls";
import { FolderKanban } from "lucide-react";

export const Route = createFileRoute("/projects")({
  component: ProjectsRoute,
});

type Project = {
  id: string; name: string; status: string; updated_at: string; created_at: string;
  thumbUrl: string | null;
};

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
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id,name,status,updated_at,created_at")
        .eq("workspace_id", activeWorkspaceId)
        .order("updated_at", { ascending: false });
      const rows = data ?? [];
      const ids = rows.map((r) => r.id);
      const svByProject: Record<string, { path: string | null; filename: string | null }> = {};
      if (ids.length) {
        const { data: svs } = await supabase
          .from("source_videos")
          .select("project_id,storage_path,filename,created_at")
          .in("project_id", ids)
          .order("created_at", { ascending: true });
        for (const sv of svs ?? []) {
          if (sv.project_id && svByProject[sv.project_id] === undefined) {
            svByProject[sv.project_id] = { path: sv.storage_path, filename: sv.filename };
          }
        }
      }
      const urls = await batchSignedUrls(
        "source-videos",
        Object.values(svByProject).map((s) => s.path).filter(Boolean) as string[],
      );
      setProjects(
        rows.map((r) => {
          const sv = svByProject[r.id];
          const raw = sv?.path ? urls[sv.path] : null;
          const name = prettyProjectName(r.name, sv?.filename);
          return { ...r, name, thumbUrl: raw ?? null };
        }),
      );
      setLoadingList(false);
    })();
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
                  <th className="px-4 py-2.5 w-20">Preview</th>
                  <th className="px-4 py-2.5">Nombre</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-primary/5">
                    <td className="px-4 py-2.5">
                      <ProjectThumb url={p.thumbUrl} />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span className="line-clamp-1 break-all">{p.name}</span>
                    </td>
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

function ProjectThumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="flex h-10 w-14 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
        <FolderKanban className="h-4 w-4 text-primary/70" />
      </div>
    );
  }
  return (
    <video
      src={videoPosterUrl(url)}
      muted
      playsInline
      preload="auto"
      className="h-10 w-14 rounded-md border border-border object-cover bg-black"
    />
  );
}

function prettyProjectName(rawName: string, filename?: string | null): string {
  const looksLikeUrl = /^https?:|^blob:|^data:/i.test(rawName);
  const hasNoSpaces = !/\s/.test(rawName);
  const tooLong = rawName.length > 80;
  const isTokeny = hasNoSpaces && rawName.length > 40 && /^[A-Za-z0-9_\-./:%?=&+]+$/.test(rawName);
  const broken = looksLikeUrl || tooLong || isTokeny;
  if (!broken) return rawName;
  if (filename && filename.trim()) return filename.replace(/\.[a-zA-Z0-9]+$/, "");
  try {
    const u = new URL(rawName);
    const seg = decodeURIComponent(u.pathname.split("/").pop() ?? "").replace(/^\d+_/, "");
    if (seg) return seg.replace(/\.[a-zA-Z0-9]+$/, "");
  } catch { /* fallthrough */ }
  return "Proyecto sin nombre";
}
