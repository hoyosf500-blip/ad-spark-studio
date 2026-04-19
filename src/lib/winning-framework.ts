// Framework portable de la skill winning-video-script (7 gates + validador determinista).
// Se inyecta en el user message de api.anthropic-generate.ts ANTES de HOOK_PLAYBOOKS.
// SYS_GENERATE y SCENE_FORMAT quedan intactos (verbatim).

export const WINNING_PREAMBLE = `═══ WINNING FRAMEWORK — 7 GATES OBLIGATORIOS ═══

Antes de generar el ad, aplicá internamente estas 7 gates. Si tu output no las cumple, el ad sale genérico. Esto NO va en el output — es disciplina interna de diseño.

[1] PRODUCT INTERROGATION — declará internamente:
    - Componente físico + dosis (ej. "400mg citrato de magnesio")
    - Mecanismo de acción (ej. "atrae agua por ósmosis + relaja músculo liso")
    - Síntoma conductual específico (ej. "no puede agacharse a recoger el balde")
    - Soluciones previas fallidas (ej. "probó té de sen, le dio cólicos")
    - Ventaja única irrepetible (ej. "único que combina citrato + B6 sin tolerancia")
    Si el PRODUCT INFO del usuario es vago, deducí los campos de la foto + analysis. No escribas "ayuda con el problema".

[2] AWARENESS MAPPING — elegí el nivel Schwartz:
    - Unaware → hook de curiosidad biológica, producto aparece >60% del video
    - Problem-aware → agitación del síntoma con marcador conductual
    - Solution-aware → "por qué lo que probaste falla"
    - Product-aware → comparación directa + mecanismo único
    - Most-aware → urgencia + garantía COD
    Default FB Ads: Problem-aware. Default TikTok cold: Solution-aware.

[3] ANGLE BANK — elegí UNO y justificalo en 1 frase mental:
    Mechanism Reveal · Enemy Named · Transformation · Identity Callout · Authority Demo · Stakes/Urgency · Curiosity Gap · Comparison · Testimonial · Educational · Urgency/Escasez

[4] COMPONENT → BENEFIT (cadena obligatoria de 4 eslabones, presente al menos una vez en el script):
    [Componente + dosis] → [Efecto biológico/mecánico] → [Sensación corporal] → [Resultado en vida diaria]
    Saltar un eslabón = guion genérico. Puede estar fragmentada entre escenas.

[5] WINNING STRUCTURE — match awareness → estructura:
    Unaware → Educational (producto NO antes del 60% del video)
    Problem-aware → Enemy Named / 3 Mistakes
    Solution-aware → Objection Crusher / Comparison
    Product-aware → Authority Demo / Mechanism Reveal
    Most-aware → Transformation Timeline / Identity Callout

[6] ANTI-GENERIC GATE — tu script NO puede contener:
    - AI slop: "increíble", "revolucionario", "transformá", "descubrí", "potenciá", "notarás la diferencia", "cambia tu vida", "fórmula avanzada", "resultados rápidos", "dile adiós", "no más"
    - Frases VO >15 palabras (partir en dos cortas)
    - Precios sin formato "XX.XXX pesos" con punto de miles
    - CTA sin los 3 pilares (ver [7])
    Un validador determinista va a correr post-generación — si fallás, se marca para re-generar.

[7] CTA 3-PILARES (HARD GATE — los 3 deben aparecer en el CTA final, sin excepción):
    (a) Descuento numérico o ancla de precio (ej. "de 129.900 a 79.900 pesos")
    (b) Envío gratis + contra entrega (las dos palabras literales)
    (c) Escasez literal: "quedan pocas unidades" / "últimas unidades" / "stock limitado" / "antes de que se acabe"
    Ejemplo VÁLIDO: "Pedí al link, envío gratis y pagás contra entrega. 79.900 pesos en vez de 129.900. Quedan pocas unidades del lote."

[7b] VOZ COLOMBIA — al menos 1 apelativo ("nena"/"chicos"/"mirá"/"miren"), 1 "súper" como intensificador, y auto-diálogo emocional cuando haya testimonial ("yo no lo podía creer", "me resigné"). CTA obligatorio: "contra entrega" (no "paga al recibir" solo, no "COD" en español).

Aplicá las 7 gates como diseñador invisible. Mantené el OUTPUT FORMAT exacto que define SCENE_FORMAT — las gates son restricciones de contenido, no cambios de estructura.`;

const AI_SLOP = [
  /\bincre[ií]ble\b/gi, /\brevolucionario\b/gi, /\btransform[áa]\b/gi,
  /\bdescubr[íi]\b/gi, /\bpotenci[áa]\b/gi, /\bnotar[áa]s la diferencia\b/gi,
  /\bcambia tu vida\b/gi, /\bf[óo]rmula avanzada\b/gi, /\bresultados r[áa]pidos\b/gi,
  /\bdile adi[óo]s\b/gi, /\bno m[áa]s\b/gi, /\bimpresionante\b/gi,
  /\basombroso\b/gi, /\bbrutal\b/gi, /\bsin igual\b/gi,
];
const PRICE_OK = /\b\d{1,3}(?:\.\d{3})+\s*pesos\b/i;
const CTA_SCARCITY = /\b(pocas unidades|[úu]ltimas unidades|stock limitado|antes de que se (acabe|termine)|solo quedan|quedan poca|quedan pocas)\b/i;
const CTA_SHIPPING = /\benv[íi]o gratis\b[\s\S]{0,40}\bcontra entrega\b/i;
const CTA_DISCOUNT = /(de\s+\d{1,3}(?:\.\d{3})+\s*(?:pesos\s*)?a\s+\d{1,3}(?:\.\d{3})+|\d{1,3}\s*%\s*(?:off|descuento|dto))/i;
const VOZ_CO = /\b(nena|chicos|mir[áa]|miren|s[úu]per|vos|contra entrega)\b/i;
const TIMING = /\[\d{1,2}\s*[-–]\s*\d{1,2}\s*s\]/;

function extractScript(text: string): string {
  const lines = text.split("\n");
  const scripts: string[] = [];
  for (const l of lines) {
    const m = /^\s*(?:📝\s*)?SCRIPT:\s*"?([^"]+)"?$/i.exec(l);
    if (m) scripts.push(m[1]);
  }
  return scripts.join(" ");
}

export type ScriptValidation = {
  pass: boolean;
  violations: string[];
  checks: Record<string, boolean>;
};

export function checkScript(fullText: string): ScriptValidation {
  const script = extractScript(fullText);
  const violations: string[] = [];
  const checks: Record<string, boolean> = {};

  const slopHits = AI_SLOP.flatMap((re) => [...fullText.matchAll(re)].map((m) => m[0]));
  checks.ai_slop = slopHits.length === 0;
  if (!checks.ai_slop) violations.push(`ai_slop: ${[...new Set(slopHits)].join(", ")}`);

  checks.price_format = PRICE_OK.test(fullText);
  if (!checks.price_format) violations.push("price_format: no se detectó precio tipo 'XX.XXX pesos'");

  const longSentences = script
    .split(/[.!?¡¿]+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length > 15);
  checks.sentence_length = longSentences.length === 0;
  if (!checks.sentence_length) violations.push(`sentence_length: ${longSentences.length} frase(s) >15 palabras`);

  const hasDiscount = CTA_DISCOUNT.test(fullText);
  const hasShipping = CTA_SHIPPING.test(fullText);
  const hasScarcity = CTA_SCARCITY.test(fullText);
  checks.cta_3_pilares = hasDiscount && hasShipping && hasScarcity;
  if (!checks.cta_3_pilares) {
    const missing: string[] = [];
    if (!hasDiscount) missing.push("descuento/ancla");
    if (!hasShipping) missing.push("envío gratis + contra entrega");
    if (!hasScarcity) missing.push("escasez literal");
    violations.push(`cta_3_pilares: falta ${missing.join(", ")}`);
  }

  checks.voz_colombiana = VOZ_CO.test(fullText);
  if (!checks.voz_colombiana) violations.push("voz_colombiana: ningún apelativo/súper/contra entrega detectado");

  checks.timing = TIMING.test(fullText);
  if (!checks.timing) violations.push("timing: falta formato [Xs-Ys] o [X-Ys]");

  return { pass: violations.length === 0, violations, checks };
}
