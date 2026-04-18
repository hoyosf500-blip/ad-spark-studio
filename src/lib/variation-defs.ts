// The 6 variations generated in series. Order matters.
export type VariationDef = {
  type: string;     // stable id stored in DB
  label: string;    // human label used in the UI + sent to Claude
  emoji: string;
};

export const VARIATIONS: VariationDef[] = [
  { type: "clon", label: "Clon", emoji: "🧬" },
  { type: "hook_curiosidad", label: "Hook Curiosidad", emoji: "🤔" },
  { type: "hook_urgencia", label: "Hook Urgencia / Miedo", emoji: "⚠️" },
  { type: "hook_resultado", label: "Hook Resultado", emoji: "🎯" },
  { type: "ugc_testimonial_mujer", label: "UGC Testimonial Mujer", emoji: "💁‍♀️" },
  { type: "before_after", label: "Before / After", emoji: "🔄" },
];

// Hook playbooks per variation type. Injected into user message of
// api.anthropic-generate.ts so each hook variation gets specific viral
// guidance instead of just a generic label. SYS_GENERATE is verbatim from
// HTML (protected by CLAUDE.md) — this lives in the user message, which
// CLAUDE.md explicitly permits adjusting.
//
// Research basis (create-viral-content skill):
// - BuzzSumo 100M headlines: specific numbers beat vague, odd beats even
// - Outbrain: negative superlatives +63% CTR over positive framings
// - Open-loop / curiosity-gap: promise specific unknown, not vague tease
// - Stakes with timeframe: credible consequence + specific window
//
// NOT applied to "clon" — the clon variation explicitly replicates the
// original transcription word-for-word and must NOT override the hook.
export const HOOK_PLAYBOOKS: Record<string, string> = {
  hook_curiosidad: `═══ HOOK PLAYBOOK — CURIOSIDAD (curiosity gap) ═══

Patrón maestro: abrir un loop que el cerebro NECESITA cerrar. El hook promete
información que solo se revela viendo el ad completo. No es "mirá esto" — es
"hay algo que no te están diciendo sobre X".

PATRONES QUE SÍ (elegí UNO para ESCENA 1, usá los OTROS para HOOKS EXTRA):

A. "La razón #1 por la que..."
   Ej: "La razón #1 por la que tu dolor lumbar vuelve a los 3 días no es la
   postura." — promete causa oculta + niega la explicación obvia.

B. "Lo que [grupo autoridad] no te cuenta sobre [problema]"
   Ej: "Lo que los quiroprácticos no te dicen sobre las hernias discales."
   — activa tribal split + secreto de industria.

C. Pregunta con respuesta contraintuitiva prometida
   Ej: "¿Por qué te duele MÁS cuando te acostás que cuando caminás?"
   — pregunta específica que el espectador NO puede responder sola.

D. Dato específico sin contexto
   Ej: "El 73% de las mujeres de 40+ tiene esto y no lo sabe."
   — número impar + fracción concreta + "no lo sabe" crea tensión.

PROHIBIDO:
- "Mirá esto", "No vas a creer", "Te vas a sorprender", "Increíble pero cierto"
- Preguntas retóricas con respuesta obvia ("¿Querés verte bien?")
- Hooks que prometen sin especificar el tema
- Emojis en el script hablado

REGLAS DE EJECUCIÓN:
- El hook introduce una INCÓGNITA CONCRETA, no una promesa vaga.
- La ESCENA 2 empieza a responderla o el viewer se va en 3s.
- Sustantivo específico (hernia, fascitis, estrato 3, mujer 45+), nunca
  abstracciones (bienestar, calidad de vida).
- Los 5 HOOKS EXTRA vienen de patrones A/B/C/D DISTINTOS entre sí.`,

  hook_urgencia: `═══ HOOK PLAYBOOK — URGENCIA / MIEDO (stakes-driven) ═══

Patrón maestro: consecuencia concreta + ventana de tiempo creíble. No es
"aprovechá la oferta" — es "si no hacés X ahora, en Y tiempo pasa Z".
El miedo debe ser REAL y específico, no apocalíptico.

PATRONES QUE SÍ:

A. Predicción con timeframe
   Ej: "Si llevás 6 meses con este dolor y no hacés nada, en 2 años
   estás operada." — stakes + ventana + consecuencia médica creíble.

B. Costo de no actuar
   Ej: "Cada semana que pasa con la faja equivocada, tus abdominales se
   separan más. Y eso ya no se arregla solo con gym."
   — métrica progresiva + punto de no retorno.

C. "Dejá de [acción común]"
   Ej: "Dejá de tomar ibuprofeno todos los días. Esto es lo que le está
   pasando a tu estómago." — stop-doing + consecuencia oculta.

D. Comparación con caso peor
   Ej: "Mi mamá ignoró el mismo dolor durante 5 años. Hoy no puede
   cargar a mi hija." — historia personal + stake humano.

PROHIBIDO:
- "¡Última oportunidad!", "Oferta por tiempo limitado", "¡Corré!"
- Countdowns fabricados ("solo quedan 3 en stock")
- Miedos genéricos ("¿Querés envejecer mal?")
- Amenazas sin respaldo médico verosímil
- Mencionar precio o COD en el hook — eso va en el CTA

REGLAS DE EJECUCIÓN:
- El stake es SOBRE LA SALUD/CUERPO, nunca sobre la oferta.
- Timeframe específico: "6 meses", "a los 50", "en 2 años".
- Tono de amiga que AVISA, no de vendedor que presiona.
- Primeros 1.5s: frase corta + alta densidad visual (acercamiento, overlay
  médico, expresión de preocupación genuina — no alarma teatral).
- Los 5 HOOKS EXTRA mezclan patrones A/B/C/D — no repitan el mismo.`,

  hook_resultado: `═══ HOOK PLAYBOOK — RESULTADO (before/after compression) ═══

Patrón maestro: resultado medible concreto + ventana de tiempo + contraste
con el estado anterior. No es "transformación increíble" — es "21 días,
3 cm menos de cintura, sin cambiar nada más".

PATRONES QUE SÍ:

A. Métrica + ventana
   Ej: "14 días. 4 kilos. Sin gym, sin dieta." — tres fragmentos cortos,
   números impares/específicos, negación de lo que NO hizo.

B. Compresión de esfuerzo
   Ej: "Lo que 6 meses de fisio no me sacó, esto lo resolvió en 3 semanas."
   — old-way vs new-way con ambos tiempos concretos.

C. Snapshot del "antes" vívido
   Ej: "Hace un mes no podía agacharme a ponerme las medias. Hoy hice
   squats." — actividad cotidiana específica como prueba.

D. Resultado contraintuitivo
   Ej: "Dormí mejor la primera noche. Eso no me lo esperaba."
   — resultado que la persona misma no anticipaba.

PROHIBIDO:
- "Increíble transformación", "Resultados impresionantes", "Cambió mi vida"
- Números redondos sospechosos (10 kilos en 10 días)
- Antes/después sin métrica específica
- "Mirá el cambio" como hook
- Claims médicos imposibles (cura, desaparece, nunca más)

REGLAS DE EJECUCIÓN:
- Números IMPARES performan mejor (3, 7, 14, 21, 73%). Evitá 10/20/100.
- El resultado se verifica visualmente en ESCENA 2-3.
- UNA actividad cotidiana específica como prueba (agacharme, cargar a mi
  nieto, dormir boca arriba) — no abstracciones.
- El "antes" duele: mencioná lo que la persona NO PODÍA hacer.
- Los 5 HOOKS EXTRA rotan patrones A/B/C/D con métricas distintas.`,

  ugc_testimonial_mujer: `═══ HOOK PLAYBOOK — UGC TESTIMONIAL MUJER (social proof) ═══

Patrón maestro: amiga contándole a amiga un descubrimiento reciente. Primera
persona, contracciones colombianas, UN momento de escepticismo ("no creía
que funcionara"), rutina integrada al día a día. No es "reseña de producto"
— es "le tengo que contar esto a alguien".

PATRONES QUE SÍ:

A. Time anchor + descubrimiento
   Ej: "Llevo 17 días usándolo y tengo que contarles algo." — número
   impar específico + teaser que obliga a quedarse.

B. Momento de escepticismo resuelto
   Ej: "Yo era la primera que decía que estas cosas no funcionan. Hasta
   que mi hermana me obligó a probar."
   — admite objeción común + resolvé con social proof cercano.

C. Integración a rutina concreta
   Ej: "Me lo pongo mientras preparo el tinto en la mañana. Ya no me
   acuerdo de que lo tengo puesto."
   — actividad cotidiana colombiana + beneficio de uso pasivo.

D. Comparación con lo que probó antes
   Ej: "Probé cremas de farmacia, pastillas, hasta acupuntura. Esto es lo
   único que me duró."
   — lista concreta de intentos fallidos + "único que" diferencia.

PROHIBIDO:
- "Cambió mi vida", "Lo recomiendo al 100%", "Es maravilloso", "Amo este producto"
- Tono de comercial ("ahora con la nueva fórmula")
- Mencionar precio, COD o envío en el hook
- Frases perfectamente editadas — tiene que sonar como voice note a una amiga
- "Hola chicas" / "Les voy a contar" como apertura

REGLAS DE EJECUCIÓN:
- La avatar tiene 35-55 años (audiencia objetivo, no aspiracional).
- Contracciones colombianas naturales: "pa'", "po'", "nojoda" (con mesura),
  "parce", "¿sí me entendés?". No las forcés en cada frase.
- UN momento de vulnerabilidad específico (lloraba del dolor, no podía
  cargar al bebé, me aislé de las amigas). Concreto, no genérico.
- El producto aparece en ESCENA 2-3, nunca en la 1. En la 1 solo hay
  ella + un snippet de su vida real.
- CTA = "paga al recibir", nunca "click en el link".
- Los 5 HOOKS EXTRA alternan A/B/C/D con detalles de vida distintos.`,

  before_after: `═══ HOOK PLAYBOOK — BEFORE / AFTER (negative superlative) ═══

Patrón maestro: el "antes" tiene que ser VÍVIDO Y DOLOROSO, no solo "me
dolía". Los superlativos negativos performan +63% que los positivos
(Outbrain). No es "mirá el cambio" — es "el peor mes de mi vida" o
"el error #1 que cometí durante 3 años".

PATRONES QUE SÍ:

A. Negative superlative
   Ej: "El peor error que cometí con mi espalda durante 5 años."
   — superlativo negativo + tiempo específico + primera persona.

B. Moment of worst
   Ej: "Este video lo grabé llorando en el baño a las 3am. Hoy grabo
   este otro." — momento-más-bajo concreto vs presente.

C. Error silencioso
   Ej: "Llevaba 2 años haciendo esto mal y nadie me lo dijo."
   — tiempo acumulado + ignorancia propia + hint de revelación.

D. Contraste de capacidad
   Ej: "Antes: no podía subir las escaleras de mi casa sin parar.
   Ahora: las subo cargando a mi nieto."
   — incapacidad específica → capacidad superior específica.

PROHIBIDO:
- "Antes vs después" como texto genérico en pantalla
- "Mirá el cambio", "La transformación", "No lo van a creer"
- Before shots estilizados (si se ve "producido", pierde credibilidad)
- Fotos de stock con mujeres perfectas en el "before"
- Claims sin métrica (sin número, sin tiempo, sin actividad concreta)

REGLAS DE EJECUCIÓN:
- El "antes" tiene una escena específica y fea: despertada de madrugada
  por dolor, llorando en el baño, cancelando planes, foto real mal iluminada.
- El "después" muestra una ACTIVIDAD (no una pose): caminando, cargando
  algo, riendo genuinamente. Acción > foto estática.
- MÍNIMO dos métricas: tiempo y cantidad (3 cm, 14 días, 4 kilos, 8 horas
  de sueño). Impares ganan a pares.
- UN elemento auto-aplicable — si ella pudo con [circunstancia específica],
  yo también.
- Los 5 HOOKS EXTRA rotan A/B/C/D con "antes" distintos — ninguno repite
  el mismo tipo de momento bajo.`,
};
