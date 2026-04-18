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
