import { toast } from "sonner";

// Si la respuesta indica tope diario alcanzado (402 Payment Required, lo que
// emite capExceededResponse en src/lib/spending-cap.ts; 429 también se acepta
// por compatibilidad con consumidores antiguos), muestra un toast amistoso y
// devuelve true para que el caller corte el flujo. Devuelve false en cualquier
// otro caso.
export async function handleCapResponse(res: Response): Promise<boolean> {
  if (res.status !== 402 && res.status !== 429) return false;
  let body: { error?: string; spent?: number; cap?: number } = {};
  try {
    body = (await res.clone().json()) as typeof body;
  } catch {
    body = { error: "Tope diario alcanzado" };
  }
  toast.error(body.error ?? "Tope diario alcanzado", {
    description:
      body.spent != null && body.cap != null
        ? `Gastado hoy: $${Number(body.spent).toFixed(2)} / Tope: $${Number(body.cap).toFixed(2)}`
        : undefined,
    duration: 8000,
  });
  return true;
}
