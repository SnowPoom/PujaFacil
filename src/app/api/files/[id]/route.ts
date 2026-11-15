import { getUserFromCookieHeader } from "@/lib/auth/session";
import { authErrorResponse } from "@/lib/auth/http";
import { readAuthorizedFile, UploadError } from "@/lib/uploads";
import { AuditError } from "@/lib/audit";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const user = await getUserFromCookieHeader(request.headers.get("cookie") ?? undefined);
    const file = await readAuthorizedFile({ fileId: id, requesterId: user?.id, roles: user?.roles });
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(file.buffer));
      controller.close();
    } });
    return new Response(stream, { headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.buffer.length),
      "Content-Disposition": `inline; filename="${file.originalName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    } });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    if (error instanceof AuditError) return Response.json({ ok: false, error: { code: "AUDITORIA_NO_DISPONIBLE", message: "No se pudo registrar la consulta. Inténtalo más tarde." } }, { status: 500, headers: { "Cache-Control": "no-store" } });
    const response = authErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
