CREATE OR REPLACE FUNCTION public.invite_member(_email text, _ws uuid, _role text DEFAULT 'member')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _target uuid;
  _is_owner boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = _ws AND owner_id = _caller) INTO _is_owner;
  IF NOT _is_owner AND NOT public.is_admin(_caller) THEN
    RAISE EXCEPTION 'only the workspace owner can invite members';
  END IF;

  SELECT id INTO _target FROM profiles WHERE lower(email) = lower(_email) LIMIT 1;
  IF _target IS NULL THEN
    RAISE EXCEPTION 'user not registered: ask them to sign up first';
  END IF;

  IF EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id = _ws AND user_id = _target) THEN
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'user_id', _target);
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (_ws, _target, COALESCE(_role, 'member'));

  RETURN jsonb_build_object('ok', true, 'user_id', _target);
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_member(text, uuid, text) TO authenticated;