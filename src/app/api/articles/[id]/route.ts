import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertTrustedOrigin, requireRole, requireSession, AuthError } from "@/lib/auth/guards";
import { ArticleServiceError, getOwnArticle, updateDraft, deleteDraft } from "@/modules/articles/article-service";
import { articleUpdateSchema } from "@/modules/articles/article-schema";

/* ================================================================== *
 *  GET /api/articles/[id]                                            *
 *  Devuelve un artículo propio del vendedor autenticado.             *
 * ================================================================== */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const article = await getOwnArticle(user.id, id);

    return NextResponse.json(
      { ok: true, data: { article } },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

/* ================================================================== *
 *  PATCH /api/articles/[id]                                          *
 *  Edita un artículo en estado BORRADOR o REQUIERE_CORRECCIONES.    *
 * ================================================================== */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    assertTrustedOrigin(request);
    const user = await requireRole(request, ["VENDEDOR"]);
    const { id } = await params;

    const body = await parseJson(request);
    const input = articleUpdateSchema.parse(body);

    // Debe venir al menos un campo para actualizar
    if (Object.keys(input).length === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "Debes proporcionar al menos un campo para actualizar." } },
        { status: 400 }
      );
    }

    const article = await updateDraft(user.id, id, input);

    return NextResponse.json(
      { ok: true, data: { article } },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

/* ================================================================== *
 *  DELETE /api/articles/[id]                                         *
 *  Elimina un borrador sin subastas ni revisiones asociadas.         *
 * ================================================================== */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    assertTrustedOrigin(request);
    const user = await requireRole(request, ["VENDEDOR"]);
    const { id } = await params;

    await deleteDraft(user.id, id);

    return NextResponse.json(
      { ok: true, data: { deleted: true, id } },
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
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "El cuerpo debe ser JSON válido." } },
      { status: 400 }
    );
  }
  if (error instanceof ArticleServiceError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.statusCode }
    );
  }
  console.error("[articles/[id]] Error inesperado:", (error instanceof Error) ? error.message : "desconocido");
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "No se pudo completar la operación. Inténtalo más tarde." } },
    { status: 500 }
  );
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SyntaxError("El cuerpo debe ser JSON válido.");
  }
}
