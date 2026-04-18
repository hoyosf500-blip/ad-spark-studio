# Ad Factory Studio — CLAUDE.md

App multi-tenant que convierte un video ganador en 6 variaciones de anuncio + 4 estilos UGC. Clon de un HTML standalone (1630 líneas) migrado a Lovable Cloud.

## Reglas de calidad

- SIEMPRE verifica tu trabajo antes de darlo por terminado. Revisa que el código compila, que no hay errores de tipos, y que la lógica tiene sentido.
- Antes de implementar cualquier cambio, investiga el código existente para entender cómo funciona. No asumas — lee el código primero.
- NO implementes nada a menos que estés 100% seguro de que va a funcionar. Si tienes dudas, investiga más o pregúntame antes de proceder.

## Sistema de memoria

- Antes de terminar cualquier sesión de trabajo, guarda un resumen de lo que hiciste, lo que falta por hacer y cualquier decisión importante en un archivo .md dentro de la carpeta del proyecto (por ejemplo: `PROGRESS.md` o `SESSION_NOTES.md`).
- Al iniciar una nueva sesión, busca y lee estos archivos de memoria para entender dónde te quedaste y qué sigue.
- Organiza las notas por secciones: **Completado**, **En progreso**, **Pendiente** y **Decisiones tomadas**.
- Actualiza estos archivos cada vez que completes un bloque significativo de trabajo.

## Workflow (NO implementar directo)

Este proyecto se construye 90% con Lovable. El rol de Claude Code aquí es:

1. **Auditar** lo que Lovable pushea contra los criterios de aceptación de cada fase.
2. **Redactar prompts en español paste-ready** para la siguiente fase o fix.
3. **Fixes quirúrgicos** cuando Lovable no llegue (ej. bugs de tipado, `Number()` wrapping, regenerar `routeTree.gen.ts` con `bun run build`).

**NO implementes features completas directamente.** El usuario pega el prompt en Lovable, Lovable pushea a GitHub, tú pulleas y auditas.

## Stack

- **Frontend:** TanStack Start 1.167.14 (React 19 + Vite 7) + shadcn/ui + Tailwind v4
- **Router:** TanStack Router file-based (`src/routes/*.tsx`), `routeTree.gen.ts` auto-generado
- **Deploy:** Cloudflare Workers via `@cloudflare/vite-plugin` + `wrangler.jsonc`
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime) — Lovable Cloud
- **APIs externas:** Anthropic Claude (Sonnet 4.5, Opus 4.6), DashScope (Qwen-Image-Max, Wan 2.6-i2v, Kling 2.5-turbo, Veo 3.1)

## Constraints críticos

### 1. Cloudflare Workers ~30s timeout
Toda llamada a Claude con max_tokens > 4096 o multimodal con >6 frames debe usar **SSE streaming**. Patrón en `src/routes/api.anthropic-analyze.ts` y `api.anthropic-generate.ts`:
- `stream: true` al Anthropic API
- `new ReadableStream` en la response
- Parse `content_block_delta` → `data: {...}\n\n` al cliente
- Cliente lee con `res.body.getReader()` + TextDecoder

**No introduzcas endpoints sync nuevos que llamen Claude** a menos que sean <3s.

### 2. PostgREST numeric → string
Columnas `numeric` en Supabase vuelven como **string** via PostgREST. `?? 0` NO dispara en strings no-null. Siempre:
```ts
Number(row.cost_usd ?? 0).toFixed(3)  // ✅
row.cost_usd?.toFixed(3)              // ❌ crash
```
Ocurrencias históricas: `AppHeader.tsx:30`, `VariationsPanel.tsx:417,942,946`, `admin.tsx:122`.

### 3. DashScope async + signed URLs
URLs de DashScope expiran en **24h**. Siempre descargar → upload a Supabase Storage → `createSignedUrl(path, 60*60*24*7)`. Patrón centralizado en `src/lib/dashscope-async.ts` (`createDashscopeTask` + `pollDashscopeTask`).

Buckets: `source-videos`, `generated-images`, `generated-videos`.

### 4. File routes vs server functions
- **File routes** (`createFileRoute`): reciben `request` directo, auth manual con `Authorization: Bearer <token>` + `supabase.auth.getClaims(token)`. **Usar esto para todo endpoint nuevo.**
- **Server functions** (`createServerFn`): requieren `.client()` middleware que inyecte el Bearer. Si no, arroja `[object Response]` 401. Lovable tiende a romperlo; cuando pase, migrar a file route.

## Estructura

```
src/
  routes/
    __root.tsx                  # shell + AuthProvider + Toaster
    index.tsx                   # landing pública
    auth.tsx                    # sign up / sign in
    dashboard.tsx               # home privada (stats + últimos proyectos con thumbnails)
    variations.tsx              # página dedicada flujo A
    ugc.tsx                     # página dedicada flujo B
    library.tsx                 # biblioteca de assets generados (thumbnails + filtros)
    projects.tsx                # listado de proyectos/videos fuente
    admin.tsx                   # /admin, solo is_admin=true
    api.anthropic-analyze.ts    # Claude SSE análisis frame-by-frame
    api.anthropic-generate.ts   # Claude SSE 6 variaciones
    api.ugc-generate.ts         # Claude SSE scripts UGC
    api.qwen-generate-image.ts  # DashScope sync (10-30s)
    api.wan-create-task.ts      # DashScope async submit
    api.wan-poll-task.ts        # poll + download + signed URL
    api.kling-create-task.ts    # delega a dashscope-async.ts
    api.kling-poll-task.ts
    api.veo3-create-task.ts
    api.veo3-poll-task.ts
  components/
    AppShell.tsx                # sidebar estilo Guardian CRM (ámbar), colapsable, envuelve rutas privadas
    AppHeader.tsx               # cost pill + admin button + signout (dentro del shell)
    WorkspaceSwitcher.tsx       # selector de workspace en el sidebar
    VariationsPanel.tsx         # flujo A: video → 6 variaciones
    UgcPanel.tsx                # flujo B: 4 estilos UGC
    ui/                         # shadcn (incluye sidebar.tsx)
  lib/
    system-prompts.ts           # SYS_ANALYZE, SYS_GENERATE, SYS_UGC (VERBATIM del HTML)
    auth-context.tsx            # useAuth() — profile, user, signOut, refreshProfile
    dashscope-async.ts          # createDashscopeTask + pollDashscopeTask + authenticateRequest
    signed-urls.ts              # batchSignedUrls con cache 55min + videoPosterUrl
    scene-parser.ts             # parsing de escenas del output de Claude
    variation-defs.ts           # definiciones de las 6 variaciones
    frame-extraction.ts         # extracción de frames del video fuente
  integrations/supabase/
    client.ts                   # browser client
    types.ts                    # Database schema types (auto)
    auth-middleware.ts          # requireSupabaseAuth (Lovable-generated)
  utils/
    anthropic.functions.ts      # dataUrlToBase64, logUsage, priceFor, calcCost
supabase/migrations/*.sql       # schema + RLS
```

## Shell de navegación

Rutas privadas (dashboard, variations, ugc, library, projects, admin) se renderizan **dentro** de [src/components/AppShell.tsx](src/components/AppShell.tsx). Estilo: sidebar ámbar Guardian CRM, colapsable, con secciones "Main" (Dashboard/Variaciones/UGC) y "Library" (Library/Proyectos). No duplicar layout en rutas hijas — solo renderizar el contenido; el shell ya pone header, workspace switcher y nav.

## Previews de imágenes/videos

**Nunca mostrar URLs firmadas crudas en UI** (dashboard, projects, library, variations, ugc). Usar siempre [src/lib/signed-urls.ts](src/lib/signed-urls.ts):
- `batchSignedUrls(bucket, paths)` → firma en lote + cache 55min (TTL signed URL = 7 días)
- `videoPosterUrl(url)` → añade `#t=0.1` para thumbnail del primer frame

Render como `<img src={signedUrl}>` o `<video poster={videoPosterUrl(signedUrl)}>`, nunca como link a la URL.

## System prompts — NO tocar

`SYS_ANALYZE`, `SYS_GENERATE`, `SYS_UGC` en `src/lib/system-prompts.ts` son **verbatim** del HTML standalone original. Contienen referencias colombianas específicas (Imusa, Ramo, Colcafé, Virgen Marías, Águila, botellón). No reescribir. Si el output de Claude falla, ajustar el `user` message o el post-processing, NO el system prompt.

## RLS pattern

Toda tabla de workspace sigue:
```sql
CREATE POLICY x_sel ON tabla FOR SELECT
  USING (is_admin(auth.uid()) OR is_ws_member(auth.uid(), workspace_id));
CREATE POLICY x_ins ON tabla FOR INSERT
  WITH CHECK ((user_id = auth.uid()) AND is_ws_member(auth.uid(), workspace_id));
-- update/delete: is_admin OR user_id = auth.uid()
```

`handle_new_user()` trigger marca al primer usuario como `is_admin=true`. No hay ruta para quitarse admin a sí mismo.

## Realtime

Tablas con `REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE`:
- `profiles` → AppHeader escucha UPDATE de `total_cost_usd`
- `ugc_generations` → UgcPanel refresca al insert/update
- `variations`, `variation_scenes` → VariationsPanel

Patrón: `supabase.channel(\`x-\${id}\`).on("postgres_changes", {...filter: \`workspace_id=eq.\${ws}\`}, cb).subscribe()` con cleanup en useEffect return.

## Cost tracking

Toda op que gaste llama `logUsage({userId, workspaceId, model, operation, inputTokens, outputTokens, metadata})` en `src/utils/anthropic.functions.ts`. Inserta en `api_usage` + trigger actualiza `profiles.total_cost_usd` acumulativo.

Precios (ver `priceFor`):
- Claude Sonnet 4.5: $3/M in, $15/M out
- Claude Opus 4.6: $5/M in, $25/M out
- Qwen-Image-Max: $0.04 fijo
- Wan 2.6-i2v: $0.30 fijo
- Kling 2.5-turbo: $0.40 fijo
- Veo 3.1: $0.75 fijo

## Idioma

Usuario es colombiano, dueño de e-commerce COD. **Siempre responder en español.** Respuestas para Lovable van en fenced block al final con encabezado "Para pegar a Lovable:". Una sola recomendación por pregunta — no listar opciones.

## Fases

Roadmap en `../lovable-prompt-inicial.md` (fuera del repo, en `Desktop/`). Estado al 2026-04-18:
- ✅ Fase 0: auth + admin + esquema
- ✅ Fase 1: variaciones con Claude SSE
- ✅ Fase 2: Qwen imagen
- ✅ Fase 3: Wan video async + reanudación
- ✅ Fase 4: UGC Generator (4 estilos × 3 modelos)
- 🚧 Fase 5: `/library` y `WorkspaceSwitcher` ya existen (verificar completitud: ZIP + métricas `/admin`)
- (opcional) Fase 6: Meta/TikTok Ads API auto-ingest

## Gotchas históricos

| Problema | Causa | Fix |
|---|---|---|
| `Cannot read properties of undefined (reading 'toFixed')` | PostgREST numeric as string | `Number(x ?? 0).toFixed(n)` |
| `[object Response]` 401 | serverFn sin `.client()` middleware | Migrar a file route con Bearer manual |
| `504 upstream request timeout` | Claude sync >30s en Worker | SSE streaming |
| TS2345 `/api/x not in FileRoutesByPath` | `routeTree.gen.ts` no regenerado | `bun run build` |
| Push rechazado tras Lovable commit | remote divergente | `git pull --rebase origin main` |

## Build & dev

```bash
bun run dev        # vite dev (HMR)
bun run build      # regenera routeTree.gen.ts + build SSR (production)
bun run build:dev  # igual pero mode=development (source maps, sin minify)
bun run lint       # eslint
bun run format     # prettier --write .
```

Git commits desde Claude Code: usar identity `-c user.email="hoyosf500@gmail.com" -c user.name="hoyosf500-blip"` (Lovable usa otra identidad).
