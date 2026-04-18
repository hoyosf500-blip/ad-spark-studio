UPDATE public.projects AS p
SET name = COALESCE(
  NULLIF(regexp_replace(
    (SELECT filename FROM public.source_videos sv WHERE sv.project_id = p.id ORDER BY created_at ASC LIMIT 1),
    '\.[a-zA-Z0-9]+$', ''
  ), ''),
  'Proyecto ' || to_char(p.created_at, 'DD/MM HH24:MI')
)
WHERE p.name ~* '^https?:'
   OR p.name ~* '^blob:'
   OR length(p.name) > 80
   OR (p.name !~ '\s' AND length(p.name) > 40);