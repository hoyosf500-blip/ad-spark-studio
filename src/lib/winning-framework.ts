// Framework completo: 7 gates + selector de ángulo CRO-informed +
// 12 principios CRO + validador determinista. Se inyecta en el user
// message de api.anthropic-generate.ts y api.ugc-generate.ts antes
// del hook playbook/style. SYS_GENERATE y SYS_UGC quedan intactos.

export const WINNING_PREAMBLE = `═══ WINNING FRAMEWORK — 7 GATES + ANGLE + CRO ═══

ROL INTERNO
Actuás como director creativo + experto CRO de COD latam. Aplicás estas gates como disciplina invisible de diseño. El output sigue el formato del SCENE_FORMAT; las gates son restricciones de contenido, no cambios de estructura.

[1] PRODUCT INTERROGATION (antes de escribir la escena 1, declarás internamente):
    - Componente físico + dosis concretos
    - Mecanismo de acción biológico/mecánico
    - Síntoma conductual específico (qué no puede hacer el avatar)
    - Soluciones previas fallidas + por qué fallaron
    - Ventaja única irrepetible
    Si el PRODUCT INFO del usuario es vago, deducilo de la foto, el analysis y la transcripción. Nunca "ayuda con el problema", "mejora tu bienestar".

[2] AWARENESS MAPPING (Schwartz 5 niveles):
    Unaware / Problem-aware / Solution-aware / Product-aware / Most-aware.
    Defaults: FB cold = Problem-aware · TikTok cold = Solution-aware · Retarget = Product/Most-aware.

[3] SELECTOR DE ÁNGULO CRO-INFORMED — elegí UNO según awareness + síntoma:

    Unaware + síntoma sin nombre técnico → Educational
    (producto aparece >60% del video, enseñar antes de vender)

    Problem-aware + frustración con soluciones previas → Enemy Named + Objection Crusher
    (valida frustración, externaliza culpa al villano real)

    Problem-aware + dolor agudo/sufrimiento actual → Mechanism Reveal
    (explica por qué las otras soluciones no funcionaron)

    Solution-aware + probó 2-3 competidores → Objection Crusher + Comparison
    (ataca de frente "ya probé y no sirvió")

    Product-aware + duda el precio → Transformation Timeline + Ancla de Precio Repetida
    (before/after con marcador observable + precio tachado 3x)

    Most-aware (retarget) → Identity Callout + Escasez
    (si sos la que… + últimas 40 del lote)

    Declará internamente: "Ángulo: X porque el avatar está en Y awareness y probó Z". No lo escribas en el output.

[4] COMPONENT → BENEFIT (cadena obligatoria de 4 eslabones, presente al menos una vez en el guion):
    [Componente + dosis] → [Efecto biológico/mecánico] → [Sensación corporal/cotidiana] → [Resultado en vida diaria del avatar]
    Saltar un eslabón = genérico. Puede fragmentarse entre escenas.

[5] WINNING STRUCTURE — match awareness → estructura (hook 0-3s · cuerpo · CTA):
    Unaware → Educational (producto NO antes del 60%)
    Problem-aware → Enemy Named / 3 Mistakes
    Solution-aware → Objection Crusher / Comparison
    Product-aware → Authority Demo / Mechanism Reveal
    Most-aware → Transformation Timeline / Identity Callout

═══ CRO EXPERT — 12 PRINCIPIOS QUE MUEVEN CR EN COD LATAM ═══

C1. HOOK STRENGTH 0-3s — decide CTR/thumbstop. Sustantivo específico (hernia, psoas, estrato 3), no abstracción (bienestar, calidad de vida). Primera frase ≤10 palabras.

C2. AWARENESS-HOOK MATCH — decide VTR (retention). Hook product-aware sobre avatar unaware = scroll-off en 2s. Nunca asumir más awareness del que tiene.

C3. PRICE ANCHORING — "de 129.900 a 79.900 pesos" convierte mejor que "79.900 en oferta". Ancla alta primero, siempre. Ancla creíble, no fabricada.

C4. LOSS AVERSION > GAIN FRAMING — +40% CR en tests replicados. "Dejá de perder X" > "ganá Y". "No sigas pagando kinesiólogo" > "ahorrá en fisio". Usar mínimo 1 frase en framing de pérdida.

C5. SOCIAL PROOF ESPECÍFICO con número IMPAR — "847 mujeres en Medellín" > "cientos". Impares (3, 7, 14, 21, 73%) > pares. Ciudad/tiempo/demografía concreta > genérica.

C6. OBJECTION PRE-HANDLING EN CUERPO — no al final. "Sé que ya probaste X, Y, Z. Esto es distinto porque [mecanismo]". Incorporar la objeción dentro del body, nunca dejarla para el CTA.

C7. RISK REVERSAL COD EXPLÍCITO — "contra entrega" es en sí mismo el risk reversal. Subrayarlo: "pagás cuando te llega, si no te sirve no pagás nada". No mencionar devoluciones complicadas.

C8. ESCASEZ CREÍBLE — "quedan 40 del lote de esta semana" > "stock limitado". Número específico + razón concreta. Countdowns fabricados pierden trust y bajan CR.

C9. CTA SINGLE-VERB IMPERATIVE — un verbo, una acción. "Pedí al link" > "click aquí para conocer más". Máximo 3 oraciones en todo el bloque CTA.

C10. FRICCIÓN COGNITIVA MÍNIMA — cada palabra innecesaria en el CTA baja CR. "Link abajo" > "hacé tap en la descripción". No explicar cómo funciona el pedido — el formulario lo hace.

C11. PATTERN INTERRUPT 0-2s — cambio visual brusco, cara expresiva, o afirmación contra-intuitiva. Necesario para parar el scroll en FB/TikTok. No abrir con logo ni con producto en mano quieto.

C12. MARCADOR OBSERVABLE > PROMESA ABSTRACTA — "espalda de mariposa" > "mejor postura". "Lumbar respira" > "menos dolor". El avatar debe poder ver o sentir el resultado en su cuerpo, no interpretarlo.

═══ [6] ANTI-GENERIC — PROHIBIDO en cualquier SCRIPT ES ═══

- AI slop: "increíble", "revolucionario", "transformá", "descubrí", "potenciá", "notarás la diferencia", "cambia tu vida", "fórmula avanzada", "resultados rápidos", "dile adiós", "no más", "impresionante", "asombroso", "brutal", "sin igual"
- Frases VO >15 palabras (partir en dos cortas, siempre)
- Precios sin formato "XX.XXX pesos" con punto de miles
- CTA sin los 3 pilares (ver [7])
- Hooks genéricos: "mirá esto", "no vas a creer", "te vas a sorprender", "prepárate porque…"
- Engagement bait en UGC viral: "dale like", "suscribite", "comentá abajo"

═══ [7] CTA 3-PILARES (HARD GATE — los 3 obligatorios) ═══

(a) Descuento numérico o ancla de precio: "de 129.900 a 79.900 pesos" / "40% OFF"
(b) Envío gratis + contra entrega (las dos palabras literales)
(c) Escasez literal: "quedan pocas unidades" / "últimas unidades" / "stock limitado" / "antes de que se acabe"

Ejemplo válido: "Pedí al link. Envío gratis y pagás contra entrega cuando te llega. 79.900 pesos en vez de 129.900. Quedan pocas unidades del lote."

═══ [7b] VOZ COLOMBIA ═══

- Al menos 1 apelativo por guion >20s: "nena", "chicos", "mirá", "miren", "súper"
- Auto-diálogo emocional en testimoniales: "yo no lo podía creer", "me resigné", "ya había probado de todo"
- CTA obligatorio: "contra entrega" (no "paga al recibir" solo, no "COD" en español)
- Vos/usted según canal: vos = TikTok/Reels casual · usted = FB Ads 40+

Aplicá las 7 gates + 12 principios CRO como diseñador invisible. El output mantiene el SCENE_FORMAT exacto que define la app.`;

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
  const scripts: string[] = [];
  for (const l of text.split("\n")) {
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
  if (!checks.price_format) violations.push("price_format: falta precio 'XX.XXX pesos'");

  const longs = script.split(/[.!?¡¿]+/).map(s => s.trim()).filter(s => s.split(/\s+/).length > 15);
  checks.sentence_length = longs.length === 0;
  if (!checks.sentence_length) violations.push(`sentence_length: ${longs.length} frase(s) >15 palabras`);

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
  if (!checks.voz_colombiana) violations.push("voz_colombiana: sin apelativo/súper/contra entrega");

  checks.timing = TIMING.test(fullText);
  if (!checks.timing) violations.push("timing: falta formato [X-Ys]");

  return { pass: violations.length === 0, violations, checks };
}
