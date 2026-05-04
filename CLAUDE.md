# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Ad Factory Studio

App multi-tenant que convierte un video ganador en 6 variaciones de anuncio + 4 estilos UGC. Clon de un HTML standalone (1630 líneas) migrado a Lovable Cloud.

## Reglas de calidad

- SIEMPRE verifica tu trabajo antes de darlo por terminado. Revisa que el código compila, que no hay errores de tipos, y que la lógica tiene sentido.
- Antes de implementar cualquier cambio, investiga el código existente para entender cómo funciona. No asumas — lee el código primero.
- NO implementes nada a menos que estés 100% seguro de que va a funcionar. Si tienes dudas, investiga más o pregúntame antes de proceder.

## Workflow (NO implementar directo)

Este proyecto se construye 90% con Lovable. El rol de Claude Code aquí es:

1. **Auditar** lo que Lovable pushea contra los criterios de aceptación de cada fase.
2. **Redactar prompts en español paste-ready** para la siguiente fase o fix.
3. **Fixes quirúrgicos** cuando Lovable no llegue (ej. bugs de tipado, `Number()` wrapping, regenerar `routeTree.gen.ts` con `bun run build`).

**NO implementes features completas directamente.** El usuario pega el prompt en Lovable, Lovable pushea a GitHub, tú pulleas y auditas.

**Antes de editar cualquier archivo, re-Read.** Hay dos AIs pusheando en paralelo a este repo (Claude Code + Lovable). Lo que leíste hace 10 minutos puede haber cambiado. Corre `git log -5 --oneline` + re-Read antes de cada Edit para no pisar trabajo ajeno.

## Stack

- **Frontend:** TanStack Start 1.167.14 (React 19 + Vite 7) + shadcn/ui + Tailwind v4
- **Router:** TanStack Router file-based (`src/routes/*.tsx`), `routeTree.gen.ts` auto-generado
- **Deploy:** Cloudflare Workers via `@cloudflare/vite-plugin` + `wrangler.jsonc`
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime) — Lovable Cloud
- **APIs externas:** **OpenRouter** (`OPENROUTER_API_KEY`) como gateway unificado — los endpoints usan `https://openrouter.ai/api/v1/chat/completions` con modelos `anthropic/claude-sonnet-4.5`, `anthropic/claude-haiku-4.5`, `google/gemini-2.5-pro`, etc. Formato de mensajes es OpenAI-compatible. La generación de imagen/video se externalizó a Higgsfield.ai — la app solo produce prompts optimizados (Nano Banana Pro, Seedream 4, Kling 2.5 Turbo, Seedance 2.0) que el usuario pega manualmente en Higgsfield.
- OpenAI Whisper (whisper-1): transcripción de audio del video fuente. Endpoint `api.transcribe-audio.ts`, costo $0.006/min, sin prompt sesgador para no inventar palabras.

## Constraints críticos

### 1. Cloudflare Workers ~30s timeout
Toda llamada a Claude/Gemini vía OpenRouter debe usar **SSE streaming**. Patrón en `src/routes/api.analyze-frames.ts` y `api.generate-variations.ts`:
- `stream: true` en el body del fetch a `https://openrouter.ai/api/v1/chat/completions`
- `new ReadableStream` en la response de salida
- Parse SSE de OpenRouter: buscar líneas `data: ...`, extraer `choices[0].delta.content`; ignorar `[DONE]`
- Tokens de uso llegan en el chunk final con `usage.prompt_tokens` / `usage.completion_tokens`
- Si el modelo corta por `finish_reason === "length"`, los endpoints hacen hasta 1 continuation automática

**No introduzcas endpoints sync nuevos que llamen Claude/Gemini** a menos que sean <3s.

### 2. PostgREST numeric → string
Columnas `numeric` en Supabase vuelven como **string** via PostgREST. `?? 0` NO dispara en strings no-null. Siempre:
```ts
Number(row.cost_usd ?? 0).toFixed(3)  // ✅
row.cost_usd?.toFixed(3)              // ❌ crash
```
Ocurrencias históricas: `AppHeader.tsx:30`, `VariationsPanel.tsx:417,942,946`, `admin.tsx:122`.

### 3. Higgsfield prompts — sin generación nativa
La app **ya no genera imágenes/videos internamente**. [src/routes/api.generate-higgsfield-prompts.ts](src/routes/api.generate-higgsfield-prompts.ts) usa Haiku 4.5 multimodal (con el frame de referencia adjunto) para producir 4 prompts optimizados — `nano_banana`, `seedream` (tag format, cap 2800 chars), `kling`, `seedance` — que el usuario copia/pega en Higgsfield.ai. Los prompts se persisten en `variation_scenes.prompt_*`. No hay polling, no hay Storage upload, no hay signed URLs para assets generados.

Storage buckets remanentes (solo para fuentes del usuario): `source-videos`, `generated-images`, `generated-videos` (este último puede estar sin uso tras la migración — verificar antes de asumir).

### 4. File routes vs server functions
- **File routes** (`createFileRoute`): reciben `request` directo, auth manual con `Authorization: Bearer <token>` + `supabase.auth.getClaims(token)`. **Usar esto para todo endpoint nuevo.**
- **Server functions** (`createServerFn`): requieren `.client()` middleware que inyecte el Bearer. Si no, arroja `[object Response]` 401. Lovable tiende a romperlo; cuando pase, migrar a file route.

### 5. Prompt caching — ACTIVO vía OpenRouter
Desde 2026-05-04 (commit `099360a`) los endpoints `api.generate-variations.ts`, `api.analyze-frames.ts` y `api.ugc-generate.ts` usan `cache_control: { type: "ephemeral" }` en el último ContentPart del shared prefix. OpenRouter pasa transparentemente el bloque a Anthropic. TTL ~5 min, surcharge de write 1.25x, read 0.10x — ahorro neto ~70% en fan-out (variations 6×, UGC 4×). El parser SSE captura `usage.cache_creation_input_tokens` y `usage.cache_read_input_tokens` (con fallback a `usage.prompt_tokens_details.*`); `calcCost` los descuenta del input regular. Verificable con `api_usage.metadata.cache_create_tokens` / `cache_read_tokens`. Si OpenRouter dropea los `cache_control` blocks en el futuro, fallback = migrar ese endpoint específico a `api.anthropic.com/v1/messages` directo.

## Anclas no obvias en `src/`

El árbol completo es discoverable con `Glob`. Puntos de entrada que no se autoexplican:

- **`lib/system-prompts.ts`** — `SYS_ANALYZE`, `SYS_GENERATE`, `SYS_UGC` VERBATIM del HTML. No tocar.
- **`lib/scene-format.ts` + `lib/scene-parser.ts`** — pareja: formato wrappers `═══` y parser tolerante (acepta prefijos emoji/arrow/parentheses).
- **`lib/winning-framework.ts`** — `WINNING_PREAMBLE` + `checkScript` (blacklist de AI-tells para UGC).
- **`lib/variation-defs.ts`** — definiciones de las 6 variaciones + hook playbooks.
- **`lib/spending-cap.ts` ↔ `lib/handle-cap.ts`** — pareja server (`checkSpendingCap` + `capExceededResponse` → 402 Payment Required estructurado con `{error, cap, spent}`) / cliente (`handleCapResponse` → toast; acepta 402 y 429). RPCs atómicas `reserve_daily_spend` / `reconcile_daily_spend` activas desde la migración `20260501000000_atomic_spending_cap.sql`.
- **`lib/signed-urls.ts`** — `batchSignedUrls` con cache 55min + `videoPosterUrl`. Único punto válido para firmar.
- **`lib/frame-extraction.ts`** — extracción client-side a 1fps, máx 1024×1820.
- **`utils/openrouter.functions.ts`** — `logUsage`, `priceFor` (con strip de sufijo de fecha en model id para evitar fallback ciego a Sonnet), `calcCost` (descuenta cache buckets 1.25x write / 0.10x read), `dataUrlToBase64`, `dataUrlToOpenAIImage`. Usado por todos los endpoints de IA. Pricing en PRICING tabla (OpenRouter rates).
- **`components/AppShell.tsx`** — sidebar Guardian CRM ámbar; rutas privadas se renderizan dentro, no duplicar layout.
- **`routes/api.*.ts`** — endpoints (file routes; ver constraint #4). Todos usan `OPENROUTER_API_KEY`.
- **`supabase/migrations/*.sql`** — schema + RLS (patrón abajo).

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

Toda op que gaste llama `logUsage({userId, workspaceId, model, operation, inputTokens, outputTokens, metadata})` en `src/utils/openrouter.functions.ts`. Inserta en `api_usage` (campo `provider = "openrouter"`) + trigger actualiza `profiles.total_cost_usd` acumulativo.

Precios OpenRouter (ver `priceFor` en [src/utils/openrouter.functions.ts](src/utils/openrouter.functions.ts)):
- `anthropic/claude-sonnet-4` / `anthropic/claude-sonnet-4.5`: $3/M in, $15/M out
- `anthropic/claude-opus-4.5`: $5/M in, $25/M out
- `anthropic/claude-haiku-4.5`: $1/M in, $5/M out
- `google/gemini-2.5-pro`: $1.25/M in, $10/M out
- `google/gemini-2.5-flash`: $0.30/M in, $2.50/M out
- Generación de imagen/video: no aplica — corre en Higgsfield.ai (fuera del sistema de cost tracking).

## Idioma

Usuario es colombiano, dueño de e-commerce COD. **Siempre responder en español.** Respuestas para Lovable van en fenced block al final con encabezado "Para pegar a Lovable:". Una sola recomendación por pregunta — no listar opciones.

## Fases

Roadmap en `../lovable-prompt-inicial.md` (fuera del repo, en `Desktop/`). Estado al 2026-05-03:
- ✅ Fase 0: auth + admin + esquema RLS
- ✅ Fase 1: variaciones con Claude SSE (6 escenas, parseo tolerante de `═══`)
- ⚠️ Fase 2: Qwen imagen — **removida**, migrada a prompts Higgsfield (commit f46dc70)
- ⚠️ Fase 3: Wan/Kling/Veo video — **removidas**, migradas a prompts Higgsfield
- ✅ Fase 4: UGC Generator (4 estilos, prompts para Kling 2.5 Turbo / Seedance 2.0 en Higgsfield)
- 🚧 Fase 5: `/library` sigue siendo **placeholder** ("Bloque B en construcción", verificado 2026-05-03 en [src/routes/library.tsx](src/routes/library.tsx)). `WorkspaceSwitcher` sí existe.
- (opcional) Fase 6: Meta/TikTok Ads API auto-ingest

## Gotchas históricos

| Problema | Causa | Fix |
|---|---|---|
| `Cannot read properties of undefined (reading 'toFixed')` | PostgREST numeric as string | `Number(x ?? 0).toFixed(n)` |
| `[object Response]` 401 | serverFn sin `.client()` middleware | Migrar a file route con Bearer manual |
| `504 upstream request timeout` | Claude/Gemini sync >30s en Worker | SSE streaming |
| TS2345 `/api/x not in FileRoutesByPath` | `routeTree.gen.ts` no regenerado | `bun run build` |
| Push rechazado tras Lovable commit | remote divergente | `git pull --rebase origin main` |
| `OPENROUTER_API_KEY not configured` | env var faltante en Worker | Agregar en `wrangler.jsonc` / Cloudflare dashboard |
| Cobro 3x para Haiku | Model id con sufijo de fecha cae al fallback Sonnet en `priceFor` | Resuelto desde 2026-05-04: `priceFor` hace strip de `-YYYYMMDD` antes del lookup |

## Build & dev

```bash
bun run dev        # vite dev (HMR)
bun run build      # regenera routeTree.gen.ts + build SSR (production)
bun run build:dev  # igual pero mode=development (source maps, sin minify)
bun run lint       # eslint
bun run format     # prettier --write .
bun run preview    # preview del build de producción
```

## Tests

**No hay framework de tests configurado.** `package.json` no tiene script `test`, no hay Vitest/Jest/Playwright instalado. No intentes `bun test` ni inventes comandos. Verificación = `bun run lint` + `bun run build` (este último regenera `routeTree.gen.ts` y compila SSR — falla si hay errores TS).

## Commits

Convención: `tipo(scope): descripción imperativa`. Tipos: `feat`, `fix`, `perf`, `chore`, `docs`, `refactor`, `style`, `test`. Ejemplos del repo:

```
fix(audit): apply 12 findings from KIMI audit pass
feat(scene-row): self-healing auto-gen + B-ROLL badge
perf(variations): warm-up + parallel fan-out
```

Git commits desde Claude Code: usar identity `-c user.email="hoyosf500@gmail.com" -c user.name="hoyosf500-blip"` (Lovable usa otra identidad — mantener separadas las trazas).

## Contexto adicional

- [`KIMI.md`](./KIMI.md) — auditoría con findings clasificados (último pass: 2026-04-26). Léelo antes de tocar `admin.tsx`, `UgcPanel.tsx`, `ugc.tsx` (tienen findings abiertos documentados).
- [`README.md`](./README.md) — overview público con stack, costos por proyecto y roadmap. ⚠️ **La sección de env vars del README está stale** (lista `ANTHROPIC_API_KEY` cuando el repo ya migró a `OPENROUTER_API_KEY` — ver Stack arriba). Usá CLAUDE.md como fuente de verdad para reglas operativas.
