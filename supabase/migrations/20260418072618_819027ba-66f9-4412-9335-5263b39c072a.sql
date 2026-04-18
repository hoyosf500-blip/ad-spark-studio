-- Allow workspace owners to insert themselves (or admins to insert anyone) into workspace_members
-- The handle_new_user trigger creates profiles, but workspace_members must be self-inserted by the owner.
DROP POLICY IF EXISTS wm_insert ON public.workspace_members;

CREATE POLICY wm_insert ON public.workspace_members
FOR INSERT TO authenticated
WITH CHECK (
  is_admin(auth.uid())
  OR (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid()
  ))
);