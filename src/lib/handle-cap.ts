import { toast } from "sonner";

// Si la respuesta es 429 (tope diario), muestra un toast y devuelve true para que
// el caller corte el flujo. Devuelve false en cualquier otro caso.
export async function handleCapResponse(res: Response): Promise<boolean> {
  if (res.status !== 429) return false;
  let body: { error?: string; spentToday?: number; cap?: number } = {};
  try {
    body = (await res.clone().json()) as typeof body;
  } catch {
    body = { error: "Tope diario alcanzado" };
  }
  toast.error(body.error ?? "Tope diario alcanzado", {
    description:
      body.spentToday != null && body.cap != null
        ? `Gastado hoy: $${Number(body.spentToday).toFixed(2)} / Tope: $${Number(body.cap).toFixed(2)}`
        : undefined,
    duration: 8000,
  });
  return true;
}
