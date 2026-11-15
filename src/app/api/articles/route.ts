import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertTrustedOrigin, requireRole, AuthError } from "@/lib/auth/guards";
import { ArticleServiceError, listOwnArticles, createDraft } from "@/modules/articles/article-service";
import { articleListQuerySchema, articleInputSchema } from "@/modules/articles/article-schema";

/* ================================================================== *
 *  GET /api/articles                                                  *
 *  Lista los artículos propios del vendedor autenticado.             *
 * ================================================================== */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireRole(request, ["VENDEDOR"]);

    const { searchParams } = new URL(request.url);
    const rawQuery = {
      q: searchParams.get("q") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    };

    const query = articleListQuerySchema.parse(rawQuery);
    const result = await listOwnArticles(user.id, query);

    return NextResponse.json(
      { ok: true, data: result },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

/* ================================================================== *
 *  POST /api/articles                                                 *
 *  Crea un nuevo artículo en estado BORRADOR.                        *
 * ================================================================== */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedOrigin(request);
    const user = await requireRole(request, ["VENDEDOR"]);

    const body = await parseJson(request);
    const input = articleInputSchema.parse(body);
    const article = await createDraft(user.id, input);

    return NextResponse.json(
      { ok: true, data: { article } },
      { status: 201 }
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
  console.error("[articles] Error inesperado:", (error instanceof Error) ? error.message : "desconocido");
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
