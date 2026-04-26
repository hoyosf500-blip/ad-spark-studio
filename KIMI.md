# Auditoría de Código — Ad Spark Studio

> Fecha: 2026-04-26  
> Auditor: Kimi (Claude Code)  
> Alcance: codebase completo (`src/`, `supabase/migrations/` no incluidas en esta pasada)  
> Build: ✅ pasa sin errores (`bun run build` ok)

---

## Resumen Ejecutivo

El build es limpio y no hay errores de TypeScript de compilación. Sin embargo, hay **3 bugs de comportamiento incorrecto**, **2 problemas de seguridad/permisos**, **2 memory leaks**, **1 UX rotas** y varias inconsistencias de tipos con PostgREST `numeric`. Ninguno es un crash inmediato, pero sí causan datos incorrectos, experiencia degradada o acumulación de recursos.

---

## 🔴 CRÍTICO — Bugs de comportamiento incorrecto

### 1. Admin: conteo de UGC ignora el filtro de usuario (`admin.tsx:97`)
**Archivo:** `src/routes/admin.tsx`  
**Líneas:** 93-99  
**Problema:** En `openAssets`, las queries de `image_generations` y `video_generations` filtran por `.eq("user_id", row.id)`, pero `ugc_generations` **no tiene ese filtro**. El resultado es que el conteo de UGC siempre muestra el total global del sistema, sin importar qué usuario se esté inspeccionando.

```tsx
// ❌ FALTA .eq("user_id", row.id)
const ugc = await supabase.from("ugc_generations").select("id", { count: "exact", head: true });
```

**Impacto:** Admin ve estadísticas de UGC incorrectas para cada usuario.  
**Fix:** Añadir `.eq("user_id", row.id)` a la query de `ugc_generations`.

---

### 2. UGC Panel: barra de progreso del stream siempre en ~0% (`UgcPanel.tsx:261-278`)
**Archivo:** `src/components/UgcPanel.tsx`  
**Líneas:** 261-278  
**Problema:** El cálculo de progreso busca headers `UGC|ESTILO|STYLE` con regex:

```tsx
const matches = stream.text.match(/═{3,}\s*(UGC|ESTILO|STYLE)\b/gi) ?? [];
```

Pero el output real de Claude para UGC (definido en `api.ugc-generate.ts`) usa las secciones `PROMPT:` y `HOOKS:`, **no** `UGC` ni `ESTILO` ni `STYLE`. Por lo tanto `matches.length` siempre es 0 y el progreso reportado es siempre bajo (1-5%).

**Impacto:** El usuario ve "Generando ugc-casual… 1%" durante todo el stream, sin feedback real de avance.  
**Fix:** Cambiar el regex para detectar secciones reales del output UGC (ej. `PROMPT:` o `HOOKS:`) o eliminar la barra de progreso porcentual y mostrar solo el texto acumulado.

---

### 3. Página UGC: auto-detect de producto no intercepta tope diario (`ugc.tsx:93-119`)
**Archivo:** `src/routes/ugc.tsx`  
**Líneas:** 93-119  
**Problema:** `handleDetect` llama a `/api/detect-product` pero **no usa** `handleCapResponse(res)`. Todas las demás llamadas a APIs de Claude en la app sí lo hacen (VariationsPanel, UgcPanel.generate, etc.).

```tsx
const res = await fetch("/api/detect-product", ...);
if (!res.ok) throw new Error(await res.text()); // ❌ no maneja 429
```

**Impacto:** Si el usuario alcanza el tope diario, en lugar de ver el toast claro "Tope diario alcanzado ($X / $Y)", ve un error crudo de HTTP.  
**Fix:** Añadir `if (await handleCapResponse(res)) return;` antes del check `!res.ok`.

---

## 🟠 ALTO — Seguridad, permisos y data integrity

### 4. Realtime: canal duplicado `profile-cost-${user.id}` (`AppHeader.tsx` + `AppShell.tsx`)
**Archivos:** `src/components/AppHeader.tsx:17-28` y `src/components/AppShell.tsx:161-170`  
**Problema:** Ambos componentes crean un canal Supabase Realtime con el **mismo nombre** (`profile-cost-${user.id}`). Supabase no permite dos canales con el mismo nombre en la misma conexión de socket; el segundo `subscribe()` típicamente reemplaza o silencia al primero. Como ambos están montados simultáneamente (AppHeader dentro del shell, TopBar también dentro del shell), una de las suscripciones no funciona.

**Impacto:** `refreshProfile()` puede no ejecutarse en uno de los dos lugares cuando `total_cost_usd` cambia. Además, hay doble cleanup en unmount.  
**Fix:** Eliminar la suscripción Realtime de `TopBar` en `AppShell.tsx` (o de `AppHeader.tsx`) y dejar solo una. `AppHeader` ya escucha y actualiza el cost pill; `TopBar` puede confiar en el contexto de auth.

---

### 5. `/api/generate-higgsfield-prompts` no verifica workspace membership antes de gastar tokens
**Archivo:** `src/routes/api.generate-higgsfield-prompts.ts`  
**Líneas:** 235-260  
**Problema:** El endpoint verifica auth y spending cap, pero **no verifica** que el usuario sea miembro del workspace al que pertenece la escena. Aunque RLS debería proteger el `SELECT` de `variation_scenes`, el endpoint procede a llamar a Anthropic (gastar tokens) antes de confirmar que la escena pertenece a un workspace del usuario. Si RLS tuviera un bypass accidental (service role, bug de policy), esto permitiría generar prompts para escenas ajenas.

**Impacto:** Potencial gasto de tokens en escenas de otros workspaces si RLS falla.  
**Fix:** Añadir una verificación de membership (como en `api.ugc-generate.ts:138-144`) antes de llamar a Anthropic.

---

## 🟡 MEDIO — Memory leaks, performance y robustez

### 6. Memory leak: `URL.createObjectURL` nunca se revoca (`frame-extraction.ts:23`)
**Archivo:** `src/lib/frame-extraction.ts`  
**Línea:** 23  
**Problema:** `extractFrames` crea un blob URL con `URL.createObjectURL(file)` y lo retorna como `videoUrl`. Este URL nunca se libera con `URL.revokeObjectURL`. Cada vez que el usuario sube un nuevo video, se crea un nuevo blob URL y el anterior se pierde en memoria.

**Impacto:** Acumulación de memoria en el browser. Para usuarios que prueban múltiples videos sin recargar, puede consumir cientos de MB.  
**Fix:** Exponer una función `revokeVideoUrl(url: string)` y llamarla en `onPickVideo` antes de setear el nuevo file, o usar `URL.revokeObjectURL(videoUrl)` en el cleanup del componente.

---

### 7. Hung promise posible en extracción de frames (`frame-extraction.ts:59-77`)
**Archivo:** `src/lib/frame-extraction.ts`  
**Líneas:** 59-77  
**Problema:** El loop de extracción espera el evento `seeked` con una promesa. Si `video.currentTime = t` falla silenciosamente (video corrupto, codec no soportado, etc.) y ni `seeked` ni `error` se disparan, la promesa nunca resuelve. **No hay timeout de seguridad**.

**Impacto:** La UI se queda congelada en "Extrayendo frames X/Y…" indefinidamente.  
**Fix:** Añadir un `Promise.race` con un timeout (ej. 5s por frame) y rechazar con error claro.

---

### 8. SceneRow: acumulación de timers de polling (`VariationsPanel.tsx:1490-1553`)
**Archivo:** `src/components/VariationsPanel.tsx`  
**Líneas:** 1490-1553  
**Problema:** `tryFetch` usa `setTimeout` recursivo para polling. Si el componente se desmonta, el flag `cancelled` evita setState, pero **no cancela el `setTimeout` pendiente**. El cleanup del `useEffect` solo setea `cancelled = true`, no hace `clearTimeout`.

**Impacto:** Timers fantasma que siguen ejecutando queries a Supabase después de que el usuario navega a otra página.  
**Fix:** Guardar el `timeoutId` en una ref y limpiarlo en el cleanup del `useEffect`.

```tsx
const timerRef = useRef<number | null>(null);
// ...
timerRef.current = window.setTimeout(...);
return () => {
  cancelled = true;
  if (timerRef.current) clearTimeout(timerRef.current);
};
```

---

### 9. Uso excesivo de `as never` para bypass de tipos de Supabase
**Archivos:** 6 ocurrencias en:
- `api.generate-higgsfield-prompts.ts:300, 458`
- `api.anthropic-generate.ts:309`
- `api.ugc-generate.ts:288`
- `api.transcribe-audio.ts:118`
- `utils/anthropic.functions.ts:83`

**Problema:** `as never` silencia **cualquier** error de tipo en inserts/updates de Supabase. Si el schema cambia (columna renombrada, tipo cambiado, columna eliminada), TypeScript no alertará.

**Impacto:** Deuda técnica. Errores de schema solo se detectan en runtime o en test de integración.  
**Fix:** Migrar gradualmente a tipos estrictos. Para Supabase, generar tipos actualizados (`supabase gen types`) y eliminar los `as never`. Si una tabla tiene campos JSON flexibles, usar `as const` o interfaces explícitas en lugar de `never`.

---

## 🟢 BAJO — Inconsistencias, tipos y UX

### 10. Tipos TypeScript incorrectos para campos `numeric` de PostgREST
**Archivos:** `src/lib/auth-context.tsx:11-12`, `src/components/UgcPanel.tsx:37`, `src/routes/admin.tsx:24-25`  
**Problema:** PostgREST devuelve columnas `numeric` como **string**. Sin embargo, los tipos locales declaran:

```ts
// auth-context.tsx
total_cost_usd: number;   // ❌ en runtime es string
daily_cap_usd: number;    // ❌ en runtime es string

// UgcPanel.tsx
cost_usd: number;         // ❌ en runtime es string
```

Aunque el código hace `Number(x)` al usarlos (evitando crash), los tipos son mentirosos. Esto dificulta el mantenimiento y puede confundir a nuevos desarrolladores.

**Fix:** Declarar estos campos como `string | number` o usar branded types, y normalizar con `Number()` inmediatamente después del fetch.

---

### 11. Landing page desactualizada (`index.tsx:50-76`)
**Archivo:** `src/routes/index.tsx`  
**Líneas:** 50-76  
**Problema:** La landing menciona "Qwen renderiza" y "Wan 2.6 anima", pero según `CLAUDE.md` y los commits recientes, **Fase 2 (Qwen) y Fase 3 (Wan/Kling/Veo) fueron removidas** y migradas a prompts para Higgsfield.ai. La app ya no genera imágenes ni videos internamente.

**Impacto:** Usuarios nuevos esperan generación nativa que no existe. Desconfianza o confusiones de onboarding.  
**Fix:** Actualizar la landing para reflejar el flujo actual: Claude analiza → genera scripts + prompts optimizados → usuario pega manualmente en Higgsfield.

---

### 12. Regex JSON frágil en detección de producto (`api.detect-product.ts:98`)
**Archivo:** `src/routes/api.detect-product.ts`  
**Línea:** 98  
**Problema:** `raw.match(/\{[\s\S]*\}/)` es greedy. Si Claude responde con texto explicativo después del JSON, el regex captura todo (incluyendo el texto extra) y `JSON.parse` falla. El `try/catch` maneja el fallo devolviendo campos vacíos, pero se pierde la detección.

**Impacto:** Detección de producto falla silenciosamente y devuelve strings vacíos cuando Claude añade texto después del JSON.  
**Fix:** Usar un regex non-greedy (`/\{[\s\S]*?\}/`) o, mejor, buscar el primer `{` y el último `}` balanceado.

---

### 13. `videoPosterUrl()` no se usa consistentemente
**Archivos:** `src/routes/dashboard.tsx:211`, `src/routes/projects.tsx:130`  
**Problema:** `src/lib/signed-urls.ts` exporta `videoPosterUrl(url)` para añadir `#t=0.1`, pero `dashboard.tsx` y `projects.tsx` hardcodean `${url}#t=0.1` inline. Esto viola la convención de la app de "nunca mostrar URLs firmadas crudas sin helper".

**Impacto:** Si la lógica de poster cambia, hay que editar en múltiples lugares.  
**Fix:** Usar `videoPosterUrl(url)` en todos los lugares que renderizan previews de video.

---

### 14. Dead code / import sin usar (`api.anthropic-generate.ts:7, 337`)
**Archivo:** `src/routes/api.anthropic-generate.ts`  
**Líneas:** 7, 337  
**Problema:** Se importa `calcCost` pero nunca se usa (excepto `void calcCost;` en el catch para silenciar el linter). El cálculo de costo se hace dentro de `logUsage`.

**Fix:** Eliminar el import de `calcCost` y la línea `void calcCost;`.

---

### 15. Transcripción de audio: fallback de duración por tamaño de archivo es inexacto
**Archivo:** `src/routes/api.transcribe-audio.ts`  
**Línea:** 98  
**Problema:** Si `durationSec` no se envía, el costo se estima como `file.size / (1024*1024) / 1.5`. Esto asume 1.5 MB/minuto, que es válido solo para videos muy comprimidos. Un video de alta calidad (10 MB/min) causaría una sobreestimación de ~6.7x.

**Impacto:** Costo mostrado al usuario es inexacto (aunque el cobro real de OpenAI es correcto, el tracking interno se desvía).  
**Fix:** Preferir extraer la duración del lado del cliente siempre (ya se hace en `extractFrames`), o usar un bitrate estimado más conservador.

---

### 16. Parámetro sin usar en `pickReferenceFrames`
**Archivo:** `src/components/VariationsPanel.tsx`  
**Línea:** 77-82  
**Problema:** La función recibe `_type: string` pero no lo usa.

**Fix:** Eliminar el parámetro o renombrarlo sin underscore si realmente no se necesita.

---

## 📋 Tabla de prioridades

| # | Problema | Severidad | Archivo(s) |
|---|----------|-----------|------------|
| 1 | Admin UGC count sin filtro de usuario | 🔴 Crítico | `admin.tsx` |
| 2 | UGC progress siempre en ~0% | 🔴 Crítico | `UgcPanel.tsx` |
| 3 | UGC detect-product no maneja 429 | 🔴 Crítico | `ugc.tsx` |
| 4 | Canal Realtime duplicado | 🟠 Alto | `AppHeader.tsx`, `AppShell.tsx` |
| 5 | generate-higgsfield-prompts sin membership check | 🟠 Alto | `api.generate-higgsfield-prompts.ts` |
| 6 | Memory leak blob URLs | 🟡 Medio | `frame-extraction.ts` |
| 7 | Hung promise en frame extraction | 🟡 Medio | `frame-extraction.ts` |
| 8 | SceneRow timers no cancelados | 🟡 Medio | `VariationsPanel.tsx` |
| 9 | `as never` x6 (deuda técnica) | 🟡 Medio | 6 archivos |
| 10 | Tipos numeric incorrectos | 🟢 Bajo | `auth-context.tsx`, `UgcPanel.tsx`, `admin.tsx` |
| 11 | Landing desactualizada | 🟢 Bajo | `index.tsx` |
| 12 | Regex JSON frágil | 🟢 Bajo | `api.detect-product.ts` |
| 13 | `videoPosterUrl` no se usa | 🟢 Bajo | `dashboard.tsx`, `projects.tsx` |
| 14 | Import `calcCost` muerto | 🟢 Bajo | `api.anthropic-generate.ts` |
| 15 | Fallback duración inexacto | 🟢 Bajo | `api.transcribe-audio.ts` |
| 16 | Parámetro `_type` muerto | 🟢 Bajo | `VariationsPanel.tsx` |

---

## ✅ Lo que está bien

- **Build limpio**: `bun run build` pasa sin errores de TypeScript ni de Vite.
- **Sin `createServerFn`**: Todo usa `createFileRoute` con auth manual Bearer, evitando el patrón `[object Response]` 401 que rompió antes.
- **SSE streaming consistente**: Todos los endpoints largos (`anthropic-analyze`, `anthropic-generate`, `ugc-generate`) usan `stream: true` + `ReadableStream`, respetando el límite de 30s de Cloudflare Workers.
- **Spending cap aplicado en todos los endpoints de Claude/OpenAI**: `checkSpendingCap` se llama antes de cualquier gasto.
- **PostgREST numeric handling**: Aunque los tipos TS son incorrectos, el runtime siempre hace `Number(x ?? 0).toFixed(n)`, evitando crashes.
- **RLS pattern uniforme**: Todas las tablas de workspace usan `is_ws_member(auth.uid(), workspace_id)`.
- **Self-heal de prompts Higgsfield**: SceneRow tiene recuperación automática con backoff exponencial y fallback a Haiku.

---

## 🛠 Recomendaciones para Lovable (paste-ready)

> Estos son prompts en español listos para pegar en Lovable si decidís que Lovable implemente los fixes.

**Prompt 1 — Fix admin UGC count:**
```
En admin.tsx, la función openAssets cuenta UGCs de todos los usuarios en lugar de filtrar por el usuario seleccionado. Agregar .eq("user_id", row.id) a la query de ugc_generations para que el conteo sea por usuario.
```

**Prompt 2 — Fix UGC progress bar:**
```
En UgcPanel.tsx, el cálculo de progreso del stream usa un regex /═{3,}\s*(UGC|ESTILO|STYLE)\b/gi que nunca hace match porque el output de Claude para UGC usa PROMPT: y HOOKS:. Cambiar el regex para que detecte secciones reales del output (ej. PROMPT:, HOOKS:, o contar palabras/ líneas). Si no hay un marker fiable, mostrar solo el texto acumulado sin porcentaje.
```

**Prompt 3 — Fix UGC detect-product cap handling:**
```
En ugc.tsx, la función handleDetect llama a /api/detect-product pero no usa handleCapResponse(res). Agregar if (await handleCapResponse(res)) return; después del fetch y antes del check de !res.ok, igual que en VariationsPanel.
```

**Prompt 4 — Fix Realtime duplicate channel:**
```
AppHeader.tsx y AppShell.tsx (TopBar) crean ambos un canal Supabase Realtime con el mismo nombre profile-cost-${user.id}. Eliminar la suscripción de TopBar en AppShell.tsx y dejar solo la de AppHeader, o viceversa. Que solo un componente escuche UPDATE de profiles.
```

**Prompt 5 — Add workspace membership check to Higgsfield endpoint:**
```
En api.generate-higgsfield-prompts.ts, antes de llamar a Anthropic, verificar que el usuario es miembro del workspace de la escena. Crear un admin client (service role) para leer workspace_members y comparar userId + workspaceId, igual que en api.ugc-generate.ts líneas 133-144. Retornar 403 si no es miembro.
```

**Prompt 6 — Fix memory leak in frame extraction:**
```
En frame-extraction.ts, URL.createObjectURL(file) nunca se libera. En VariationsPanel, guardar el videoUrl anterior y llamar URL.revokeObjectURL(prevUrl) antes de setear el nuevo, o hacerlo en un cleanup useEffect cuando se desmonta el picker.
```
