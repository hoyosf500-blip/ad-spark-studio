// Parse Claude's variation output into discrete scenes using ▬ separators
// and extract script (ES), image prompt (EN), animation prompt (EN), tool, etc.

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

const SEPARATOR = /[▬─━]{6,}/u; // tolerant: ▬ or ─ or ━ repeated

export function parseScenes(text: string): ParsedScene[] {
  if (!text || !text.trim()) return [];
  const blocks = text
    .split(SEPARATOR)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const scenes: ParsedScene[] = [];
  let idx = 0;
  for (const block of blocks) {
    // Skip blocks that look like section preamble without a SCENE header
    if (!/ESCENA|SCENE/i.test(block)) continue;

    const title = extractTitle(block);
    const { start, end } = extractTimeRange(title);

    scenes.push({
      orderIdx: idx++,
      title: title || `Escena ${idx}`,
      scriptEs: extractField(block, ["script (es)", "script es", "script", "diálogo", "dialogo"]),
      imagePromptEn: extractField(block, [
        "image prompt (en)",
        "image prompt en",
        "image prompt",
        "qwen prompt",
      ]),
      animationPromptEn: extractField(block, [
        "animation prompt (en)",
        "animation prompt en",
        "animation prompt",
        "wan prompt",
        "video prompt",
      ]),
      toolRecommended: extractField(block, ["tool", "herramienta", "tool recommended"]),
      attachNote: extractField(block, ["attach note", "attach", "nota adjunto"]),
      screenText: extractField(block, ["screen text", "texto pantalla", "overlay text"]),
      timeStartSec: start,
      timeEndSec: end,
    });
  }
  return scenes;
}

function extractTitle(block: string): string {
  const firstLine = block.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.replace(/^[#*\s]+/, "").trim();
}

function extractTimeRange(title: string): { start: number | null; end: number | null } {
  // matches "(0-3s)" or "(3-7s)" or "0-3s"
  const m = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s/i.exec(title);
  if (!m) return { start: null, end: null };
  return { start: Number(m[1]), end: Number(m[2]) };
}

function extractField(block: string, labels: string[]): string {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      const re = new RegExp(`^[\\s>*\\-]*\\**\\s*${escapeRe(label)}\\s*\\**\\s*[:：]`, "i");
      if (re.test(line)) {
        // Capture until next labelled line or blank-line break
        const after = line.replace(re, "").trim();
        const parts: string[] = [];
        if (after) parts.push(after);
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (looksLikeAnotherLabel(next) || /^\s*$/.test(next)) break;
          parts.push(next.trim());
        }
        return parts.join(" ").replace(/\s+/g, " ").trim();
      }
    }
  }
  return "";
}

function looksLikeAnotherLabel(line: string): boolean {
  return /^[\s>*\-]*\**\s*[A-Za-zÁÉÍÓÚÑáéíóúñ\s()]+[:：]/.test(line);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
