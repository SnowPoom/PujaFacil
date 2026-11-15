import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertTrustedOrigin, requireRole, AuthError } from "@/lib/auth/guards";
import { ArticleServiceError, submitForReview } from "@/modules/articles/article-service";

/* ================================================================== *
 *  POST /api/articles/[id]/submit                                    *
 *  Envía el artículo a verificación (BORRADOR → PENDIENTE_REVISION). *
 * ================================================================== */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    assertTrustedOrigin(request);
    const user = await requireRole(request, ["VENDEDOR"]);
    const { id } = await params;

    const article = await submitForReview(user.id, id);

    return NextResponse.json(
      { ok: true, data: { article } },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

/* ── Shared error handler ───────────────────────────────────────────── */

function handleError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "Revisa los datos ingresados.";
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message } },
      { status: 400 }
    );
  }
  if (error instanceof ArticleServiceError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.statusCode }
    );
  }
  console.error("[articles/[id]/submit] Error inesperado:", (error instanceof Error) ? error.message : "desconocido");
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "No se pudo completar la operación. Inténtalo más tarde." } },
    { status: 500 }
  );
}
