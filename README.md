# Ad Factory Studio

> Convertí un video ganador en **6 variaciones de anuncio + 4 estilos UGC** sin salir del dashboard.
> Claude analiza frame-por-frame, genera scripts en español colombiano + prompts optimizados para Higgsfield.ai.

[![Build](https://img.shields.io/badge/build-passing-success)](https://github.com/hoyosf500-blip/ad-spark-studio)
[![Stack](https://img.shields.io/badge/stack-TanStack%20Start%20%2B%20Cloudflare%20Workers-blue)](#stack)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#)

---

## 🎯 Qué hace

App **multi-tenant** para e-commerce COD latam. Subís un video que te funcionó, Claude lo destripa, y te devuelve:

1. **Análisis frame-por-frame** del video original (ritmo, hooks, CTA, framing).
2. **6 variaciones** del script con ángulos distintos: Clon, Hook Curiosidad, Hook Urgencia, Hook Resultado, UGC Testimonial Mujer, Before/After.
3. **Prompts listos para Higgsfield** (Nano Banana Pro / Seedream 4.5 para imagen, Kling 2.5 Turbo / Seedance 2.0 para video) — capeados a 2500 chars, en inglés, listos para pegar.
4. **4 estilos UGC** independientes: Casual dolor, Testimonial, Hook viral, Unboxing COD.
5. **Tracking de costo en vivo** por proyecto y tope diario configurable por usuario.

> **No genera imágenes ni videos internamente** — produce los prompts; vos los pegás en [higgsfield.ai](https://higgsfield.ai).

---

## ⚡ Quick start

Prerequisitos: [Bun](https://bun.sh) instalado, una cuenta de Supabase (Lovable Cloud), una API key de Anthropic Claude y otra de OpenAI Whisper.

```bash
# 1. Clonar
git clone https://github.com/hoyosf500-blip/ad-spark-studio.git
cd ad-spark-studio

# 2. Instalar dependencias
bun install

# 3. Variables de entorno (.env en la raíz)
cp .env.example .env  # editá con tus keys reales
```

Variables requeridas:

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | Cliente Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Cliente browser + RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Inserts admin (api_usage, ugc_generations) |
| `ANTHROPIC_API_KEY` | Claude Sonnet 4.5/4.6, Haiku 4.5, Opus 4.7 |
| `OPENAI_API_KEY` | Whisper-1 transcripción de audio |

```bash
# 4. Dev server (HMR)
bun run dev

# 5. Build de producción (regenera routeTree + SSR)
bun run build
```

---

## 🛠 Stack

| Capa | Tech | Versión |
|---|---|---|
| **Frontend** | TanStack Start (React 19 + Vite 7) | 1.167.14 |
| **Router** | TanStack Router file-based | 1.168.0 |
| **UI** | shadcn/ui + Tailwind CSS v4 | 4.2.1 |
| **Deploy** | Cloudflare Workers via `@cloudflare/vite-plugin` | 1.25.5 |
| **Backend** | Supabase (Postgres + Auth + Storage + Realtime) | 2.103.3 |
| **LLM** | Anthropic Claude (Sonnet 4.5/4.6 · Haiku 4.5 · Opus 4.7) | API 2023-06-01 |
| **STT** | OpenAI Whisper-1 ($0.006/min) | — |
| **Generación visual** | Higgsfield.ai (manual paste) | externo |

---

## 📂 Estructura

```
src/
├── routes/                          # TanStack Router file-based
│   ├── __root.tsx                   # Shell + AuthProvider + Toaster
│   ├── index.tsx                    # Landing pública
│   ├── auth.tsx                     # Sign up / Sign in
│   ├── dashboard.tsx                # Stats + últimos proyectos
│   ├── variations.tsx               # Flujo A — video → 6 variaciones
│   ├── ugc.tsx                      # Flujo B — 4 estilos UGC
│   ├── library.tsx                  # 🚧 Asset library (placeholder)
│   ├── projects.tsx                 # Listado de proyectos
│   ├── admin.tsx                    # Admin panel (is_admin=true)
│   ├── api.anthropic-analyze.ts     # SSE Claude — análisis frame-by-frame
│   ├── api.anthropic-generate.ts    # SSE Claude — 6 variaciones
│   ├── api.ugc-generate.ts          # SSE Claude — scripts UGC
│   ├── api.detect-product.ts        # Sync — detección producto desde foto
│   ├── api.transcribe-audio.ts      # Whisper STT del audio fuente
│   └── api.generate-higgsfield-prompts.ts  # Haiku/Sonnet/Opus — 4 prompts/escena
├── components/
│   ├── AppShell.tsx                 # Sidebar Guardian CRM ámbar, colapsable
│   ├── VariationsPanel.tsx          # Flujo A completo
│   ├── UgcPanel.tsx                 # Flujo B completo
│   ├── WorkspaceSwitcher.tsx
│   └── ui/                          # shadcn/ui
├── lib/
│   ├── auth-context.tsx             # useAuth() — profile, workspaces, signOut
│   ├── system-prompts.ts            # SYS_ANALYZE, SYS_GENERATE, SYS_UGC (verbatim del HTML standalone)
│   ├── scene-format.ts              # Formato de escenas con wrappers ═══
│   ├── scene-parser.ts              # Parser tolerante a emojis/arrows
│   ├── variation-defs.ts            # Las 6 variaciones + hook playbooks
│   ├── winning-framework.ts         # 7 gates + 12 principios CRO + checkScript
│   ├── frame-extraction.ts          # Extracción 1fps client-side, máx 1024×1820
│   ├── signed-urls.ts               # batchSignedUrls cache 55min
│   ├── spending-cap.ts              # checkSpendingCap server-side + 429
│   └── handle-cap.ts                # handleCapResponse cliente
├── integrations/supabase/
│   ├── client.ts                    # Browser client
│   └── types.ts                     # Schema types (auto-generados)
└── utils/
    └── anthropic.functions.ts       # logUsage, calcCost, dataUrlToBase64

supabase/migrations/*.sql            # Schema + RLS + trigger profiles
```

---

## 🔐 Auth & RLS

- **Primer usuario registrado** se marca automáticamente `is_admin=true` (trigger `handle_new_user()`).
- Tablas multi-tenant siguen el patrón:
  ```sql
  USING (is_admin(auth.uid()) OR is_ws_member(auth.uid(), workspace_id))
  ```
- File routes (`createFileRoute`) hacen auth manual con `Authorization: Bearer <token>` + `supabase.auth.getClaims(token)` — sin server functions de TanStack (rompen con `[object Response]` 401).
- Spending cap diario configurable por usuario (`profiles.daily_cap_usd`, default $20). Endpoints retornan 429 con JSON estructurado cuando se alcanza.

---

## ⚙️ Constraints técnicos

### Cloudflare Workers ~30s timeout
Toda llamada a Claude con `max_tokens > 4096` o multimodal con frames usa **SSE streaming** (`stream: true`, `ReadableStream`, parse `content_block_delta` en cliente). Patrón en:
- `api.anthropic-analyze.ts`
- `api.anthropic-generate.ts`
- `api.ugc-generate.ts`

### PostgREST `numeric` → string
Columnas `numeric` en Supabase vuelven como **string** vía PostgREST. `?? 0` no dispara en strings no-null. Siempre:

```ts
Number(row.cost_usd ?? 0).toFixed(3)  // ✅
row.cost_usd?.toFixed(3)              // ❌ crash en runtime
```

### Prompt caching de Claude
`api.anthropic-generate.ts` marca el prefijo compartido (frames + análisis + transcripción + product info, ~150k tokens) con `cache_control: ephemeral`. La primera variación paga cache_creation (1.25× input price), las 5 siguientes pagan cache_read (0.10×). Estrategia: warm-up serial → fan-out paralelo en `Promise.allSettled`.

### Higgsfield prompts — sin generación nativa
La app produce 4 prompts optimizados por escena (image_prompt, kling, seedance) que el usuario copia/pega en Higgsfield.ai. Cap de 2500 chars por prompt (Higgsfield rechaza >3000). Cache en DB para evitar re-generaciones.

---

## 💰 Costo

Operación típica de un video de 15s con 6 variaciones:

| Etapa | Modelo | Costo aprox |
|---|---|---|
| Whisper transcripción | whisper-1 | $0.0015 |
| Detect producto (foto) | Sonnet 4.5 | $0.005 |
| Análisis frame-by-frame | Sonnet 4.5 | $0.10–0.30 |
| 6 variaciones (con cache) | Sonnet 4.5 | $0.60–1.20 |
| 36 prompts Higgsfield (6 escenas × 6 vars) | Sonnet 4.6 | $0.55 |
| **Total proyecto** | | **~$1.30–2.10 USD** |

Precios Claude (USD por 1M tokens):
- Sonnet 4.5/4.6: $3 input / $15 output
- Haiku 4.5: $0.80 input / $4 output
- Opus 4.7: $15 input / $75 output (uso opcional, máxima fidelidad multimodal)

---

## 🚀 Comandos

```bash
bun run dev        # Vite dev server con HMR
bun run build      # Build producción (regenera routeTree.gen.ts + SSR)
bun run build:dev  # Build dev mode (source maps, sin minify)
bun run lint       # ESLint
bun run format     # Prettier
bun run preview    # Preview del build de producción
```

---

## 📐 Workflow de desarrollo

Este proyecto se construye **90% con [Lovable](https://lovable.dev)**. El rol del repo local es:

1. **Auditar** lo que Lovable pushea contra criterios de aceptación.
2. **Fixes quirúrgicos** de bugs específicos (tipos, regex, race conditions, leaks).
3. **Redactar prompts paste-ready** en español para la siguiente fase.

Lovable pushea con su identidad; el dev local commitea con `-c user.email="hoyosf500@gmail.com" -c user.name="hoyosf500-blip"` para mantener separadas las trazas.

---

## 🗺️ Roadmap

| Fase | Estado | Descripción |
|---|---|---|
| 0 | ✅ | Auth + admin + esquema RLS + spending cap |
| 1 | ✅ | 6 variaciones con Claude SSE, parser tolerante de `═══` |
| 2 | ⚠️ removido | Qwen imagen → migrado a prompts Higgsfield |
| 3 | ⚠️ removido | Wan/Kling/Veo video → migrado a prompts Higgsfield |
| 4 | ✅ | UGC Generator (4 estilos, prompts Kling/Seedance) |
| 5 | 🚧 | `/library` con assets generados, búsqueda + filtros |
| 6 | 🔜 | Meta/TikTok Ads API auto-ingest |

---

## 🐛 Gotchas conocidos

| Síntoma | Causa | Fix |
|---|---|---|
| `Cannot read properties of undefined (reading 'toFixed')` | PostgREST numeric as string | `Number(x ?? 0).toFixed(n)` |
| `[object Response]` 401 | serverFn sin `.client()` middleware | Migrar a file route con Bearer manual |
| `504 upstream request timeout` | Claude sync >30s en Worker | SSE streaming |
| TS2345 `/api/x not in FileRoutesByPath` | `routeTree.gen.ts` no regenerado | `bun run build` |
| Push rechazado tras Lovable commit | Remote divergente | `git pull --rebase origin main` |

---

## 🇨🇴 Idioma

Toda la UI está en **español colombiano**. Los prompts a Higgsfield son en **inglés** (Higgsfield rinde mejor en inglés incluso para ads en español). Los `system_prompts` contienen referencias culturales colombianas específicas (Imusa, Ramo, Colcafé, contracciones tipo "pa' que", "nojoda") — son **verbatim del HTML standalone original** y no deben tocarse.

---

## 📜 Convenciones de commits

Convención dominante en el repo: `tipo(scope): descripción imperativa`.

```
fix(audit): apply 12 findings from KIMI audit pass
feat(scene-row): self-healing auto-gen + B-ROLL badge
perf(variations): warm-up + parallel fan-out
chore: remove stale CONCURRENCY=2 comment
```

Tipos: `feat`, `fix`, `perf`, `chore`, `docs`, `refactor`, `style`, `test`.

---

## 📂 Archivos de contexto

- [`CLAUDE.md`](./CLAUDE.md) — Reglas de calidad, workflow, constraints, gotchas históricos. Lectura obligada antes de tocar código.
- [`KIMI.md`](./KIMI.md) — Reporte de auditoría con 16 findings (último pass: 2026-04-26).

---

## 📝 Licencia

Privado / propietario. No redistribuir.
