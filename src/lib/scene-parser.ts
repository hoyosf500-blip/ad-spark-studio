// Parse Claude's variation output into discrete scenes.
// SCENE_FORMAT uses "═══ ESCENA N — NAME (t1s–t2s) ═══" as scene wrappers and
// emoji-prefixed labels like "🖼️ IMAGE PROMPT (copy to Nano Banana Pro):".
// The parser splits on section headers and tolerates emoji/arrow prefixes and
// parenthesized hints between the label and its colon.

export type ParsedScene = {
  orderIdx: number;
  title: string;
  scriptEs: string;
  imagePromptEn: string;
  animationPromptEn: string;
  toolRecommended: string;
  attachNote: string;
  screenText: string;
  timeStartSec: number | null;
  timeEndSec: number | null;
};

const SCENE_HEADER = /^═{3,}\s*(?:ESCENA|SCENE)\b/im;

export function parseScenes(text: string): ParsedScene[] {
  if (!text || !text.trim()) return [];
  // Split into sections by ═══-wrapped headers; keep only the ones that are scenes.
  const parts = text.split(/(?=^═{3,}\s*[A-ZÁÉÍÓÚÑ])/m);
  const raw: ParsedScene[] = [];
  let idx = 0;
  for (const block of parts) {
    if (!SCENE_HEADER.test(block)) continue;
    const title = extractTitle(block);
    const { start, end } = extractTimeRange(title);
    raw.push({
      orderIdx: idx++,
      title: title || `Escena ${idx}`,
      scriptEs: extractField(block, ["script"]),
      imagePromptEn: extractField(block, ["image prompt"]),
      animationPromptEn: extractField(block, ["animation prompt"]),
      toolRecommended: extractField(block, ["tool", "herramienta"]),
      attachNote: extractField(block, ["attach", "nota adjunto"]),
      screenText: extractField(block, ["screen text", "texto pantalla"]),
      timeStartSec: start,
      timeEndSec: end,
    });
  }
  return collapseConsecutiveDuplicates(raw);
}

// Dedup pass: Claude a veces emite la misma beat como 2 escenas consecutivas
// con rangos de tiempo adyacentes (e.g. "0-1s" y "1-2s" con SCRIPT idéntico).
// Eso hacía que en la UI salieran escenas 1-2 y 3-4 como pares duplicados con
// frames distintos pero prompts iguales (el input textual a Claude era idéntico
// entre la pareja, y con temp=0.2 convergía). Colapsamos aquí: si dos escenas
// consecutivas tienen scriptEs normalizado idéntico, conservamos la primera y
// extendemos su timeEndSec al end de la última duplicada. Luego reindexamos
// orderIdx 0..N-1.
function collapseConsecutiveDuplicates(scenes: ParsedScene[]): ParsedScene[] {
  if (scenes.length <= 1) return scenes;
  const out: ParsedScene[] = [];
  for (const s of scenes) {
    const prev = out[out.length - 1];
    const key = scriptKey(s.scriptEs);
    // Solo dedupar cuando AMBAS tienen scriptEs no vacío — beats sin diálogo
    // (B-roll, corte instrumental) pueden ser estructuralmente distintos pese
    // a compartir script vacío.
    if (prev && key !== "" && scriptKey(prev.scriptEs) === key) {
      if (s.timeEndSec != null) prev.timeEndSec = s.timeEndSec;
      continue;
    }
    out.push({ ...s });
  }
  return out.map((s, i) => ({
    ...s,
    orderIdx: i,
    title: /^Escena \d+$/.test(s.title.trim()) ? `Escena ${i + 1}` : s.title,
  }));
}

function scriptKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(block: string): string {
  const firstLine = block.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine
    .replace(/^═+/, "")
    .replace(/═+$/, "")
    .replace(/^[#*\s]+/, "")
    .trim();
}

function extractTimeRange(title: string): { start: number | null; end: number | null } {
  // Accept all formats Claude emits:
  //   "0-1s"       (one trailing s)
  //   "0s-1s"      (s after both numbers — most common from SCENE_FORMAT template)
  //   "0.0s–1.0s"  (en-dash)
  //   "0s — 1s"    (em-dash with spaces)
  // The optional `s?` after the first number is the fix: without it the parser
  // returned {null, null} for `NUMBERs-NUMBERs`, which hid the reference-frame
  // thumbnail in SceneRow and broke the grid layout.
  const m = /(\d+(?:\.\d+)?)\s*s?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*s?/i.exec(title);
  if (!m) return { start: null, end: null };
  return { start: Number(m[1]), end: Number(m[2]) };
}

// Tolerant label matcher: allows emoji/arrow prefix and parenthesized hint
// between the label and its colon (e.g. "🖼️ IMAGE PROMPT (copy to Nano Banana Pro):").
function extractField(block: string, labels: string[]): string {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      const re = new RegExp(
        `^[^A-Za-zÁÉÍÓÚÑáéíóúñ]*${escapeRe(label)}\\b[^:\\n]*[:：]`,
        "i",
      );
      if (!re.test(line)) continue;
      const after = line.replace(re, "").trim();
      const parts: string[] = [];
      if (after) parts.push(after);
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (/^═{3,}/.test(next) || /^\s*$/.test(next) || looksLikeAnotherLabel(next)) break;
        parts.push(next.trim());
      }
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function looksLikeAnotherLabel(line: string): boolean {
  return /^[^A-Za-zÁÉÍÓÚÑáéíóúñ]*[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\s()/\-.0-9]*[:：]/.test(line);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
