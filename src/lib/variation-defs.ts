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
// api.generate-variations.ts so each hook variation gets specific viral
// guidance instead of just a generic label. HOOK_PLAYBOOKS lives in the
// user message, which CLAUDE.md explicitly permits adjusting (distinct
// from SYS_GENERATE which is verbatim from the HTML).
//
// Research basis (create-viral-content skill):
// - BuzzSumo 100M headlines: specific numbers beat vague, odd beats even
// - Outbrain: negative superlatives +63% CTR over positive framings
// - Open-loop / curiosity-gap: promise specific unknown, not vague tease
// - Stakes with timeframe: credible consequence + specific window
//
// 2026-05-04: ejemplos rotan entre 5 nichos (salud, belleza, hogar,
// tecnología, wellness/suplementos) para que Claude no sesgue al nicho
// dominante de los inputs cuando el proyecto es de otro nicho. Cada patrón
// A/B/C/D incluye un ejemplo de cada nicho — Claude debe elegir el ejemplo
// del nicho real del producto (lo deduce de PRODUCT INFO + ANALYSIS) y
// aplicar la MISMA estructura.
//
// NOT applied to "clon" — la variación clon replica la transcripción
// original verbatim y no debe sobreescribir el hook.
export const HOOK_PLAYBOOKS: Record<string, string> = {
  hook_curiosidad: `═══ HOOK PLAYBOOK — CURIOSIDAD (curiosity gap) ═══

Patrón maestro: abrir un loop que el cerebro NECESITA cerrar. El hook promete
información que solo se revela viendo el ad completo. No es "mirá esto" — es
"hay algo que no te están diciendo sobre X".

ADAPTAR AL NICHO DEL PRODUCTO. Los ejemplos abajo cubren 5 nichos típicos
(salud, belleza, hogar, tecnología, wellness). Si el producto del proyecto
es de otro nicho, aplicá la MISMA ESTRUCTURA del patrón con un ejemplo de
ese nicho — nunca copies un ejemplo verbatim si no es del nicho real.

PATRONES QUE SÍ (elegí UNO para ESCENA 1, usá los OTROS para HOOKS EXTRA):

A. "La razón #1 por la que..."
   - Salud: "La razón #1 por la que tu dolor lumbar vuelve a los 3 días no es la postura."
   - Belleza: "La razón #1 por la que tu sérum no te está funcionando no es la marca."
   - Hogar: "La razón #1 por la que tu cocina nunca queda bien limpia no es el detergente."
   - Tecnología: "La razón #1 por la que tu celular se descarga rápido no es la batería."
   - Wellness: "La razón #1 por la que no estás bajando de peso no es lo que comés."
   → Promete causa oculta + niega la explicación obvia.

B. "Lo que [grupo autoridad] no te cuenta sobre [problema]"
   - Salud: "Lo que los quiroprácticos no te dicen sobre las hernias discales."
   - Belleza: "Lo que las dermatólogas no te dicen sobre el ácido hialurónico."
   - Hogar: "Lo que las marcas de electrodomésticos no te cuentan sobre por qué se rayan tus ollas."
   - Tecnología: "Lo que los técnicos no te dicen cuando llevás el celular a reparar."
   - Wellness: "Lo que los nutricionistas no te dicen sobre las dietas detox."
   → Activa tribal split + secreto de industria.

C. Pregunta con respuesta contraintuitiva prometida
   - Salud: "¿Por qué te duele MÁS cuando te acostás que cuando caminás?"
   - Belleza: "¿Por qué tu piel se ve PEOR después de exfoliar?"
   - Hogar: "¿Por qué tu ropa nueva se ve vieja después de 3 lavadas?"
   - Tecnología: "¿Por qué tus auriculares con cancelación dan dolor de cabeza?"
   - Wellness: "¿Por qué tomás 8 vasos de agua al día y seguís deshidratada?"
   → Pregunta específica que el espectador NO puede responder solo.

D. Dato específico sin contexto
   - Salud: "El 73% de las mujeres de 40+ tiene esto y no lo sabe."
   - Belleza: "El 67% de los protectores solares en Colombia no llegan al SPF que prometen."
   - Hogar: "El 81% de las cocinas tiene este problema y la gente lo confunde con humedad."
   - Tecnología: "9 de cada 10 celulares tiene este chip dañado de fábrica."
   - Wellness: "El 73% de las multivitaminas no se absorbe — pasa de largo."
   → Número impar + fracción concreta + "no lo sabe" crea tensión.

PROHIBIDO:
- "Mirá esto", "No vas a creer", "Te vas a sorprender", "Increíble pero cierto"
- Preguntas retóricas con respuesta obvia ("¿Querés verte bien?")
- Hooks que prometen sin especificar el tema
- Emojis en el script hablado

REGLAS DE EJECUCIÓN:
- El hook introduce una INCÓGNITA CONCRETA del nicho real, no una promesa vaga.
- La ESCENA 2 empieza a responderla o el viewer se va en 3s.
- Sustantivo específico del nicho (hernia, sérum, batería de litio, fascitis,
  estrato 3, mujer 45+), nunca abstracciones (bienestar, calidad de vida).
- Los 5 HOOKS EXTRA vienen de patrones A/B/C/D DISTINTOS entre sí.`,

  hook_urgencia: `═══ HOOK PLAYBOOK — URGENCIA / MIEDO (stakes-driven) ═══

Patrón maestro: consecuencia concreta + ventana de tiempo creíble. No es
"aprovechá la oferta" — es "si no hacés X ahora, en Y tiempo pasa Z".
El stake debe ser REAL y específico al nicho, no apocalíptico.

ADAPTAR AL NICHO. Los ejemplos cubren salud, belleza, hogar, tecnología,
wellness. Si el producto es de otro nicho, aplicá la MISMA ESTRUCTURA con
ejemplo del nicho real.

PATRONES QUE SÍ:

A. Predicción con timeframe
   - Salud: "Si llevás 6 meses con este dolor y no hacés nada, en 2 años estás operada."
   - Belleza: "Si seguís usando esa crema con alcohol, en 3 meses tu barrera cutánea está dañada."
   - Hogar: "Si no cambiás esa esponja en 7 días, hay más bacterias que en una tabla de baño."
   - Tecnología: "Si seguís cargando tu celular toda la noche, en 8 meses la batería pierde el 40%."
   - Wellness: "Si seguís haciendo dieta de 1200 calorías, en 6 meses tu metabolismo se adapta y rebotás."
   → Stakes + ventana + consecuencia creíble.

B. Costo de no actuar (métrica progresiva)
   - Salud: "Cada semana con la faja equivocada, tus abdominales se separan más."
   - Belleza: "Cada noche que dormís con maquillaje, tus poros se abren un poco más."
   - Hogar: "Cada lavado a temperatura alta encoge tu ropa nueva 0.5%."
   - Tecnología: "Cada hora que tu laptop está al 100% sin descansar, su SSD pierde ciclos."
   - Wellness: "Cada día sin proteína suficiente, perdés masa muscular después de los 35."
   → Métrica progresiva + punto de no retorno.

C. "Dejá de [acción común]"
   - Salud: "Dejá de tomar ibuprofeno todos los días. Esto le está pasando a tu estómago."
   - Belleza: "Dejá de exfoliar 3 veces por semana. Esto le hace a tu piel."
   - Hogar: "Dejá de mezclar cloro con vinagre. El gas que se forma es tóxico."
   - Tecnología: "Dejá de usar el cargador genérico. Esto le hace a tu pin USB."
   - Wellness: "Dejá de saltarte el desayuno. Esto le hace a tu cortisol."
   → Stop-doing + consecuencia oculta.

D. Comparación con caso peor
   - Salud: "Mi mamá ignoró el mismo dolor 5 años. Hoy no puede cargar a mi hija."
   - Belleza: "Mi tía usó la misma crema 10 años. Le dejó manchas que ya no se quitan."
   - Hogar: "A mi vecina se le quemó la cocina por una toma de corriente vieja como esta."
   - Tecnología: "Mi hermana ignoró el ruido del disco duro 4 meses. Perdió 8 años de fotos."
   - Wellness: "Mi prima creyó que el cansancio era normal. Era anemia y le pegó duro."
   → Historia personal + stake humano específico.

PROHIBIDO:
- "¡Última oportunidad!", "Oferta por tiempo limitado", "¡Corré!"
- Countdowns fabricados ("solo quedan 3 en stock")
- Miedos genéricos ("¿Querés envejecer mal?")
- Amenazas sin respaldo creíble del nicho
- Mencionar precio o COD en el hook — eso va en el CTA

REGLAS DE EJECUCIÓN:
- El stake es SOBRE EL PROBLEMA REAL DEL NICHO (cuerpo, piel, electrodoméstico,
  dispositivo, energía), nunca sobre la oferta.
- Timeframe específico: "6 meses", "a los 50", "en 2 años", "cada 7 lavadas".
- Tono de amiga que AVISA, no de vendedor que presiona.
- Primeros 1.5s: frase corta + alta densidad visual del nicho (acercamiento al
  síntoma/daño/superficie afectada).
- Los 5 HOOKS EXTRA mezclan patrones A/B/C/D — no repitan el mismo.`,

  hook_resultado: `═══ HOOK PLAYBOOK — RESULTADO (before/after compression) ═══

Patrón maestro: resultado medible concreto + ventana de tiempo + contraste
con el estado anterior. No es "transformación increíble" — es "21 días,
3 cm menos de cintura, sin cambiar nada más" o el equivalente del nicho.

ADAPTAR AL NICHO. Lo que importa: número impar específico + ventana corta
+ una NEGACIÓN concreta de lo que NO se hizo (eso da credibilidad).

PATRONES QUE SÍ:

A. Métrica + ventana + negación
   - Salud: "14 días. 4 kilos. Sin gym, sin dieta."
   - Belleza: "21 días. 3 manchas borradas. Sin láser, sin retinol."
   - Hogar: "1 aplicación. Las baldosas brillan. Sin restregar, sin químicos fuertes."
   - Tecnología: "5 minutos. La batería duró 3 horas más. Sin cambiar nada de software."
   - Wellness: "7 días. Bajé 2 cm de cintura. Sin contar calorías."
   → Tres fragmentos cortos, números impares, negación de lo que NO hizo.

B. Compresión de esfuerzo (old way vs new way)
   - Salud: "Lo que 6 meses de fisio no me sacó, esto lo resolvió en 3 semanas."
   - Belleza: "Lo que 4 dermatólogos no me arreglaron, esta crema lo cambió en 21 días."
   - Hogar: "Lo que la lavadora 3 ciclos no le saca, esto lo limpia de un toque."
   - Tecnología: "Lo que el técnico me cobró 200k por arreglar, esto lo soluciona en 5 minutos."
   - Wellness: "Lo que 3 dietas distintas no me bajaron, esto me lo bajó en 14 días."
   → Old-way vs new-way con AMBOS tiempos concretos.

C. Snapshot del "antes" vívido (actividad cotidiana específica)
   - Salud: "Hace un mes no podía agacharme a ponerme las medias. Hoy hice squats."
   - Belleza: "Hace dos semanas no me dejaba ver sin maquillaje. Hoy salgo a la tienda con cara lavada."
   - Hogar: "Hace una semana ni invitaba gente porque me daba pena la sala. Hoy tuve almuerzo de domingo."
   - Tecnología: "Hace un mes mi celular no aguantaba ni hasta el almuerzo. Ayer me duró todo el día."
   - Wellness: "Hace 21 días no podía subir las escaleras de mi casa sin parar. Hoy subo cargada con mercado."
   → Una actividad cotidiana específica como prueba.

D. Resultado contraintuitivo
   - Salud: "Dormí mejor la primera noche. Eso no me lo esperaba."
   - Belleza: "Mi maquillaje me empezó a durar todo el día. Yo no estaba buscando eso."
   - Hogar: "El olor de la cocina cambió completo. Eso no estaba ni en la promesa del producto."
   - Tecnología: "Lo más raro: el celular dejó de calentarse. Yo solo quería que durara la batería."
   - Wellness: "Empecé a despertar con energía. Estaba tomándolo solo para el ánimo."
   → Resultado que la persona misma no anticipaba.

PROHIBIDO:
- "Increíble transformación", "Resultados impresionantes", "Cambió mi vida"
- Números redondos sospechosos (10 kilos en 10 días)
- Antes/después sin métrica específica
- "Mirá el cambio" como hook
- Claims imposibles del nicho (cura, desaparece, nunca más, garantizado)

REGLAS DE EJECUCIÓN:
- Números IMPARES performan mejor (3, 7, 14, 21, 73%). Evitá 10/20/100.
- El resultado se verifica visualmente en ESCENA 2-3.
- UNA actividad cotidiana específica del nicho como prueba (agacharme,
  salir sin maquillaje, invitar gente, llegar al almuerzo con celular cargado,
  subir escaleras) — no abstracciones.
- El "antes" duele: mencioná lo que la persona NO PODÍA hacer.
- Los 5 HOOKS EXTRA rotan patrones A/B/C/D con métricas distintas.`,

  ugc_testimonial_mujer: `═══ HOOK PLAYBOOK — UGC TESTIMONIAL MUJER (social proof) ═══

Patrón maestro: amiga contándole a amiga un descubrimiento reciente. Primera
persona, contracciones colombianas, UN momento de escepticismo ("no creía que
funcionara"), rutina integrada al día a día. No es "reseña de producto" —
es "le tengo que contar esto a alguien".

ADAPTAR AL NICHO. Lo que se mantiene: time anchor con número impar, momento
de escepticismo, integración a rutina concreta colombiana, lista de fracasos
previos.

PATRONES QUE SÍ:

A. Time anchor + descubrimiento (teaser)
   - Salud: "Llevo 17 días usándolo y tengo que contarles algo."
   - Belleza: "Llevo 23 días con esto y me están preguntando qué me hice."
   - Hogar: "Hace 9 días que la cocina está así y todavía no lo creo."
   - Tecnología: "Llevo 11 días con este celular y me están preguntando si es nuevo."
   - Wellness: "Llevo 13 días tomándolo y mi marido fue el primero en notarlo."
   → Número impar específico + teaser que obliga a quedarse.

B. Momento de escepticismo resuelto
   - Salud: "Yo era la primera que decía que estas cosas no funcionan. Hasta que mi hermana me obligó a probar."
   - Belleza: "Yo no creo en cremas milagrosas. Pero esta me la regaló mi cuñada y bueno..."
   - Hogar: "Yo decía 'es publicidad'. Hasta que vi a mi mamá usándolo en su casa."
   - Tecnología: "Yo no era de comprar cosas por TikTok. Esto me lo recomendó mi sobrino y caí."
   - Wellness: "Yo había intentado de todo. Esto era el último intento antes de rendirme."
   → Admite objeción común + resolvé con social proof cercano.

C. Integración a rutina concreta colombiana
   - Salud: "Me lo pongo mientras preparo el tinto en la mañana. Ya no me acuerdo de que lo tengo puesto."
   - Belleza: "Lo aplico cuando me cepillo los dientes en la noche. Total son 30 segundos."
   - Hogar: "Lo paso mientras escucho el radio en la cocina. Termina cuando termina la canción."
   - Tecnología: "Lo dejo cargando mientras desayuno. Ya quedó como parte de la rutina."
   - Wellness: "Me la tomo con el jugo de naranja del desayuno. Ni se siente."
   → Actividad cotidiana colombiana + beneficio de uso pasivo.

D. Comparación con lo que probó antes
   - Salud: "Probé cremas de farmacia, pastillas, hasta acupuntura. Esto es lo único que me duró."
   - Belleza: "Pasé por La Roche, Eucerin, una doctora particular. Esto fue lo único que se vio."
   - Hogar: "Probé cloro, vinagre, productos importados. Esto fue lo único que sí lo dejó como nuevo."
   - Tecnología: "Cambié de cargador 3 veces. Esto fue lo único que me solucionó el problema."
   - Wellness: "Probé batidos, dietas, ayunos. Esto es lo único que no me dejó con hambre."
   → Lista concreta de intentos fallidos + "único que" diferencia.

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
- UN momento de vulnerabilidad específico DEL NICHO (lloraba del dolor, me
  daba pena salir sin maquillaje, no invitaba gente a la casa, perdí fotos
  importantes, me sentía sin energía todo el día). Concreto, no genérico.
- El producto aparece en ESCENA 2-3, nunca en la 1. En la 1 solo hay
  ella + un snippet de su vida real.
- CTA = "paga al recibir", nunca "click en el link".
- Los 5 HOOKS EXTRA alternan A/B/C/D con detalles de vida distintos.`,

  before_after: `═══ HOOK PLAYBOOK — BEFORE / AFTER (negative superlative) ═══

Patrón maestro: el "antes" tiene que ser VÍVIDO Y DOLOROSO, no solo "estaba
mal". Los superlativos negativos performan +63% que los positivos
(Outbrain). No es "mirá el cambio" — es "el peor mes de mi vida" o
"el error #1 que cometí durante 3 años".

ADAPTAR AL NICHO. El "antes" debe sentirse específico al problema real
del producto, no genérico.

PATRONES QUE SÍ:

A. Negative superlative
   - Salud: "El peor error que cometí con mi espalda durante 5 años."
   - Belleza: "El peor error que hice con mi piel grasa durante 7 años."
   - Hogar: "El peor producto que compré para mi cocina durante 3 años seguidos."
   - Tecnología: "El peor hábito que tuve con mi celular durante toda mi vida."
   - Wellness: "El peor error que hice con mi energía durante 2 años de cuarentena."
   → Superlativo negativo + tiempo específico + primera persona.

B. Moment of worst (concreto y temporal)
   - Salud: "Este video lo grabé llorando en el baño a las 3am. Hoy grabo este otro."
   - Belleza: "Esta foto la tomé un viernes que no quise salir. Esta otra la tomé ayer."
   - Hogar: "Esta foto la tomé el día que no abrí la puerta a mi suegra. Esta otra la tomé el domingo de la celebración."
   - Tecnología: "Este screenshot lo guardé el día que se me apagó en una llamada importante. Hoy grabo desde el mismo equipo."
   - Wellness: "Este video lo grabé un martes a las 4pm que no me podía levantar del sillón. Hoy grabo después del gym."
   → Momento-más-bajo concreto vs presente.

C. Error silencioso (tiempo acumulado + ignorancia)
   - Salud: "Llevaba 2 años haciendo esto mal y nadie me lo dijo."
   - Belleza: "Llevaba 6 años aplicando la crema en el orden equivocado."
   - Hogar: "Llevaba 4 años lavando la ropa con esta temperatura. Por eso se me arruinaba."
   - Tecnología: "Llevaba 3 años cargando el celular como NO se debe."
   - Wellness: "Llevaba 1 año tomando este suplemento a la hora equivocada."
   → Tiempo acumulado + ignorancia propia + hint de revelación.

D. Contraste de capacidad (incapacidad → capacidad superior)
   - Salud: "Antes: no podía subir las escaleras sin parar. Ahora: las subo cargando a mi nieto."
   - Belleza: "Antes: no salía sin base ni en la tienda. Ahora: hago zoom calls sin maquillaje."
   - Hogar: "Antes: tres veces a la semana le pasaba al piso. Ahora: una vez y queda perfecto toda la semana."
   - Tecnología: "Antes: cargaba el celular dos veces al día. Ahora: una sola vez en la mañana y aguanta."
   - Wellness: "Antes: tomaba 2 cafés para empezar el día. Ahora: ni necesito el primero."
   → Incapacidad específica → capacidad superior específica.

PROHIBIDO:
- "Antes vs después" como texto genérico en pantalla
- "Mirá el cambio", "La transformación", "No lo van a creer"
- Before shots estilizados (si se ve "producido", pierde credibilidad)
- Fotos de stock con mujeres perfectas en el "before"
- Claims sin métrica (sin número, sin tiempo, sin actividad concreta)

REGLAS DE EJECUCIÓN:
- El "antes" tiene una escena específica y fea DEL NICHO: despertada de
  madrugada por dolor, llorando en el baño, cancelando planes por como se
  veía la cara, escondiendo la cocina cuando llegaron visitas, frustrada
  porque el celular se apagó en mitad de algo, no podía levantarse del sillón.
- El "después" muestra una ACTIVIDAD (no una pose): caminando, cargando
  algo, riendo genuinamente, recibiendo gente, llegando al final del día.
  Acción > foto estática.
- MÍNIMO dos métricas: tiempo y cantidad/actividad (3 cm, 14 días, 4 kilos,
  8 horas de sueño, 3 manchas borradas, 1 sola limpieza, 3 horas más de
  batería). Impares ganan a pares.
- UN elemento auto-aplicable — si ella pudo con [circunstancia específica],
  yo también.
- Los 5 HOOKS EXTRA rotan A/B/C/D con "antes" distintos — ninguno repite
  el mismo tipo de momento bajo.`,
};
