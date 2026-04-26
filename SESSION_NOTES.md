# Session Notes — 2026-04-26

## Completado

- **Migración a OpenRouter como gateway único** con múltiples modelos:
  - **Claude Sonnet 4.5** (`anthropic/claude-sonnet-4.5`) para todo lo creativo:
    - `api.analyze-frames.ts` — análisis frame-by-frame
    - `api.generate-variations.ts` — 6 variaciones de anuncio
    - `api.ugc-generate.ts` — scripts UGC
    - Frontend `VariationsPanel.tsx` — default model
  - **Gemini 2.5 Flash** (`google/gemini-2.5-flash`) para tareas rápidas/baratas:
    - `api.detect-product.ts` — detección de producto con JSON estructurado
    - `api.generate-higgsfield-prompts.ts` — prompts para Higgsfield (Nano Banana, Seedream, Kling)

- **Archivos creados/modificados:**
  - `src/utils/openrouter.functions.ts` — pricing OpenRouter (Claude + Gemini), `logUsage(provider: "openrouter")`
  - `src/routes/api.analyze-frames.ts` — URL OpenRouter, headers `HTTP-Referer`/`X-Title`, modelo Claude
  - `src/routes/api.generate-variations.ts` — mismo patrón
  - `src/routes/api.ugc-generate.ts` — mismo patrón
  - `src/routes/api.detect-product.ts` — Gemini Flash, `response_format: {type: "json_object"}`
  - `src/routes/api.generate-higgsfield-prompts.ts` — Gemini Flash
  - `src/lib/spending-cap.ts` — endpoint names actualizados + `api.transcribe-audio`
  - `src/routes/api.transcribe-audio.ts` — **documentado explícitamente** que OpenRouter no soporta audio transcription; requiere `OPENAI_API_KEY` separada o alternativa (Google Speech, AssemblyAI, Deepgram)
  - `.env.example` — `OPENROUTER_API_KEY=` (principal), `OPENAI_API_KEY=` (solo para audio transcription)
  - `src/routes/__root.tsx` — descripción actualizada
  - `src/routeTree.gen.ts` — rutas nuevas reflejadas

- **Archivos eliminados:**
  - `src/routes/api.anthropic-analyze.ts`
  - `src/routes/api.anthropic-generate.ts`

## Configuración requerida en .env

```
OPENROUTER_API_KEY=sk-or-v1-...
# Opcional: solo si usás transcripción de audio Whisper
OPENAI_API_KEY=sk-...
```

## Modelos por defecto (podes cambiarlos vía `body.model`)

| Endpoint | Modelo default | Alternativas |
|---|---|---|
| `/api/analyze-frames` | `anthropic/claude-sonnet-4.5` | `google/gemini-2.5-pro` |
| `/api/generate-variations` | `anthropic/claude-sonnet-4.5` | `google/gemini-2.5-pro` |
| `/api/ugc-generate` | `anthropic/claude-sonnet-4.5` | `google/gemini-2.5-pro` |
| `/api/detect-product` | `google/gemini-2.5-flash` | `anthropic/claude-sonnet-4.5` |
| `/api/generate-higgsfield-prompts` | `google/gemini-2.5-flash` | `anthropic/claude-sonnet-4.5` |

## Audio transcription

OpenRouter **NO soporta** endpoints de audio (`/v1/audio/transcriptions`). Tenés 3 opciones:
1. **OpenAI Whisper directo** (requiere `OPENAI_API_KEY` separada)
2. **Google Cloud Speech-to-Text** (requiere cuenta GCP)
3. **AssemblyAI / Deepgram** (APIs dedicadas de STT)

El código actual funciona con opción 1. Si querés migrar a otra, avisame.

## Precios aproximados (por 1M tokens, vía OpenRouter)

| Modelo | Input | Output | Uso en tu app |
|---|---|---|---|
| Claude Sonnet 4.5 | $3.00 | $15.00 | Análisis, variaciones, UGC |
| Gemini 2.5 Flash | $0.30 | $2.50 | Detect product, Higgsfield prompts |
| Gemini 2.5 Pro | $1.25 | $10.00 | Alternativa a Claude |

## Pendiente

1. **Build local:** correr `npm install && npm run build` en tu máquina (en sandbox faltó dependencia de lovable)
2. **Probar con OpenRouter API real:** crear key en openrouter.ai, cargar saldo (si es necesario), probar flujo completo
3. **System prompts VERBATIM:** se mantuvieron sin cambios (`SYS_ANALYZE`, `SYS_GENERATE`, `SYS_UGC`). Si Gemini no respeta el tono colombiano, ajustamos el user message.
