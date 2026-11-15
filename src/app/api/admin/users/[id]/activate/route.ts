import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/lib/audit";
import { assertTrustedOrigin, requireRole } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const actor = await requireRole(request, ["ADMIN_SUBASTAS"]);
    const { id } = await params;
    const count = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({ where: { id, status: "PENDIENTE", files: { some: { kind: "IDENTIDAD" } } }, data: { status: "ACTIVA" } });
      if (result.count) await writeAuditEvent({ actorId: actor.id, action: "CUENTA_ACTIVADA", resourceType: "User", resourceId: id, result: "EXITO", detail: { previousStatus: "PENDIENTE", status: "ACTIVA" } }, tx);
      return result.count;
    });
    if (!count) return Response.json({ ok: false, error: { code: "ACTIVACION_NO_PERMITIDA", message: "La cuenta debe estar pendiente y tener un documento de identidad cargado." } }, { status: 409 });
    return Response.json({ ok: true, data: { id, status: "ACTIVA" } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
