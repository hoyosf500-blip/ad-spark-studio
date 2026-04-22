// Mirror of MAX_IMAGE_PROMPT in api.generate-higgsfield-prompts.ts. Applied
// client-side as defense-in-depth: legacy DB rows written before the cap was
// added can still surface prompts >3000 chars on cache reads.
export const MAX_IMAGE_PROMPT_CLIENT = 2500;

export function capImagePromptClient(s: string | null | undefined): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.length <= MAX_IMAGE_PROMPT_CLIENT) return trimmed;
  const hard = trimmed.slice(0, MAX_IMAGE_PROMPT_CLIENT);
  const lastPeriod = hard.lastIndexOf(".");
  const lastComma = hard.lastIndexOf(",");
  const cut = Math.max(lastPeriod, lastComma);
  return (cut > MAX_IMAGE_PROMPT_CLIENT * 0.8 ? hard.slice(0, cut + 1) : hard).trim();
}
