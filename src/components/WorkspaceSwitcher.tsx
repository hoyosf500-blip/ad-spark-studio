import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Settings, Loader2, Trash2, UserPlus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

type Member = { user_id: string; role: string; email: string | null; full_name: string | null };

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, refreshWorkspaces, user, profile } = useAuth();

  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Manage state
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const isOwner = !!(active && user && active.owner_id === user.id);
  const isAdmin = !!profile?.is_admin;

  useEffect(() => {
    if (!manageOpen || !active) return;
    setRenameValue(active.name);
    setDeleteConfirm("");
    setLoadingMembers(true);
    (async () => {
      const { data: rows } = await supabase
        .from("workspace_members")
        .select("user_id,role")
        .eq("workspace_id", active.id);
      const ids = (rows ?? []).map((r) => r.user_id);
      let profMap: Record<string, { email: string | null; full_name: string | null }> = {};
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,email,full_name")
          .in("id", ids);
        profMap = Object.fromEntries((profs ?? []).map((p) => [p.id, { email: p.email, full_name: p.full_name }]));
      }
      setMembers(
        (rows ?? []).map((r) => ({
          user_id: r.user_id,
          role: r.role,
          email: profMap[r.user_id]?.email ?? null,
          full_name: profMap[r.user_id]?.full_name ?? null,
        })),
      );
      setLoadingMembers(false);
    })();
  }, [manageOpen, active]);

  const handleCreate = async () => {
    if (!user || !newName.trim()) return;
    setCreating(true);
    try {
      const { data: ws, error } = await supabase
        .from("workspaces")
        .insert({ name: newName.trim(), owner_id: user.id })
        .select("id,name,owner_id")
        .single();
      if (error || !ws) throw new Error(error?.message ?? "create failed");
      const { error: mErr } = await supabase
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: user.id, role: "owner" });
      if (mErr) throw new Error(mErr.message);
      await refreshWorkspaces();
      setActiveWorkspaceId(ws.id);
      setCreateOpen(false);
      setNewName("");
      toast.success("Workspace creado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!active || !renameValue.trim() || renameValue.trim() === active.name) return;
    setRenaming(true);
    const { error } = await supabase
      .from("workspaces")
      .update({ name: renameValue.trim() })
      .eq("id", active.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Renombrado");
      await refreshWorkspaces();
    }
    setRenaming(false);
  };

  const handleInvite = async () => {
    if (!active || !inviteEmail.trim()) return;
    setInviting(true);
    const { data, error } = await supabase.rpc("invite_member", {
      _email: inviteEmail.trim(),
      _ws: active.id,
      _role: "member",
    });
    if (error) {
      toast.error(error.message);
    } else {
      const res = data as { ok?: boolean; already_member?: boolean } | null;
      if (res?.already_member) toast.info("Ya era miembro");
      else toast.success("Miembro invitado");
      setInviteEmail("");
      // reload members
      const { data: rows } = await supabase
        .from("workspace_members").select("user_id,role").eq("workspace_id", active.id);
      const ids = (rows ?? []).map((r) => r.user_id);
      const { data: profs } = await supabase
        .from("profiles").select("id,email,full_name").in("id", ids);
      const profMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      setMembers((rows ?? []).map((r) => ({
        user_id: r.user_id, role: r.role,
        email: profMap[r.user_id]?.email ?? null,
        full_name: profMap[r.user_id]?.full_name ?? null,
      })));
    }
    setInviting(false);
  };

  const handleDelete = async () => {
    if (!active || deleteConfirm !== active.name) return;
    setDeleting(true);
    const { error } = await supabase.from("workspaces").delete().eq("id", active.id);
    if (error) {
      toast.error(error.message);
      setDeleting(false);
      return;
    }
    toast.success("Workspace eliminado");
    setManageOpen(false);
    setActiveWorkspaceId(null);
    await refreshWorkspaces();
    setDeleting(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={activeWorkspaceId ?? ""}
        onValueChange={(v) => setActiveWorkspaceId(v)}
      >
        <SelectTrigger className="h-8 w-[180px] font-mono-display text-xs">
          <SelectValue placeholder="Sin workspace" />
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name} {isAdmin && w.owner_id !== user?.id && <span className="text-muted-foreground">(otro)</span>}
            </SelectItem>
          ))}
          {workspaces.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Sin workspaces</div>
          )}
        </SelectContent>
      </Select>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="icon" className="h-8 w-8" title="Nuevo workspace">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo workspace</DialogTitle>
            <DialogDescription>Crea un workspace independiente con sus propios proyectos y miembros.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ws-name">Nombre</Label>
            <Input
              id="ws-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Mi agencia"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            title="Administrar workspace"
            disabled={!active}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Administrar workspace</DialogTitle>
            <DialogDescription>
              {active?.name} {isOwner && <Badge variant="outline" className="ml-2">Owner</Badge>}
            </DialogDescription>
          </DialogHeader>

          {/* Rename */}
          {(isOwner || isAdmin) && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Pencil className="h-3 w-3" /> Renombrar</Label>
              <div className="flex gap-2">
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                <Button onClick={handleRename} disabled={renaming || !renameValue.trim() || renameValue === active?.name}>
                  {renaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
                </Button>
              </div>
            </div>
          )}

          {/* Members */}
          <div className="space-y-2">
            <Label>Miembros</Label>
            <div className="rounded-md border border-border max-h-48 overflow-auto">
              {loadingMembers ? (
                <div className="p-3 text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin" /> cargando…</div>
              ) : members.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">Sin miembros</div>
              ) : (
                members.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between border-b border-border last:border-b-0 px-3 py-2 text-xs">
                    <div>
                      <div className="font-medium">{m.full_name || m.email || m.user_id.slice(0, 8)}</div>
                      <div className="text-muted-foreground">{m.email}</div>
                    </div>
                    <Badge variant={m.role === "owner" ? "default" : "outline"} className="text-[10px]">
                      {m.role}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Invite */}
          {(isOwner || isAdmin) && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><UserPlus className="h-3 w-3" /> Invitar por email</Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                />
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Invitar"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                El usuario debe estar registrado primero.
              </p>
            </div>
          )}

          {/* Delete */}
          {isOwner && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <Label className="flex items-center gap-1.5 text-destructive">
                <Trash2 className="h-3 w-3" /> Eliminar workspace
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Acción irreversible. Borra TODOS los proyectos, variaciones, imágenes, videos y UGC.
                Escribe <span className="font-mono">{active?.name}</span> para confirmar.
              </p>
              <div className="flex gap-2">
                <Input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={active?.name}
                />
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting || deleteConfirm !== active?.name}
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Eliminar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
