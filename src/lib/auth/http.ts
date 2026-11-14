import { ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { AuthError } from "@/lib/auth/guards";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SyntaxError("El cuerpo debe ser JSON válido.");
  }
}
export function authErrorResponse(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof AuthError) {
    return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    const message = error instanceof ZodError ? error.issues[0]?.message ?? "Revisa los datos ingresados." : error.message;
    return Response.json({ ok: false, error: { code: "DATOS_INVALIDOS", message } }, { status: 400 });
  }
  // No registrar errores Prisma completos: pueden contener valores personales o credenciales.
  console.error("[auth] No se pudo completar la operación.");
  return Response.json({ ok: false, error: { code: "ERROR_INTERNO", message: "No se pudo completar la operación. Inténtalo más tarde." } }, { status: 500 });
}
