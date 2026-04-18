import { createServerFn } from "@tanstack/react-start";

/**
 * Fase 0 STUB — anthropic-analyze
 *
 * Placeholder para el endpoint que en Fase 1 hará proxy a Claude Sonnet/Opus
 * con SYS_ANALYZE (multimodal, recibe frames base64) usando ANTHROPIC_API_KEY
 * desde Lovable Cloud secrets.
 *
 * Reemplazar en Fase 1 con:
 *  - Streaming SSE vía ReadableStream
 *  - Retry exponencial 2s → 4s → 8s
 *  - Tracking de tokens en api_usage (Sonnet $3/$15, Opus $5/$25 por M)
 *  - System prompt SYS_ANALYZE preservado VERBATIM del HTML original
 */
export const anthropicAnalyze = createServerFn({ method: "POST" })
  .inputValidator((input: { frames: string[]; model?: string }) => input)
  .handler(async () => {
    return {
      ok: false,
      stub: true,
      message: "anthropic-analyze stub. Implementar en Fase 1.",
    };
  });
