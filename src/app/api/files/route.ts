import { z } from "zod";
import { FileKind } from "@prisma/client";
import { assertTrustedOrigin, requireActive } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import { saveValidatedUpload, UploadError } from "@/lib/uploads";

const fieldsSchema = z.object({
  kind: z.enum(FileKind),
  articleId: z.string().regex(/^[a-z0-9_-]{1,128}$/i, "Selecciona un artículo válido.").optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const user = await requireActive(request);
    // Límite preliminar; validateUpload comprueba los bytes reales por tipo.
    const length = Number(request.headers.get("content-length"));
    if (length > 21 * 1024 * 1024) throw new UploadError(413, "ARCHIVO_MUY_GRANDE", "La solicitud supera el tamaño permitido.");
    let form: FormData;
    try { form = await request.formData(); }
    catch { throw new SyntaxError("Envía el archivo mediante multipart/form-data."); }
    for (const field of ["file", "kind", "articleId"]) {
      if (form.getAll(field).length > 1) throw new SyntaxError("Cada campo debe enviarse una sola vez.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new SyntaxError("Selecciona un archivo.");
    const fields = fieldsSchema.parse({ kind: form.get("kind"), articleId: form.get("articleId") ?? undefined });
    const record = await saveValidatedUpload(file, { ownerId: user.id, ...fields });
    const { id, kind, originalName, size, createdAt } = record;
    return Response.json({ ok: true, data: { id, kind, originalName, size, createdAt } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return authErrorResponse(error);
  }
}
