import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/lib/audit";
import { saveValidatedUpload, validateUpload, UploadError } from "@/lib/uploads";
import { encryptCedula } from "@/lib/auth/crypto";
import { assertTrustedOrigin } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import { registerSchema } from "@/lib/auth/schemas";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) throw new UploadError(413, "ARCHIVO_MUY_GRANDE", "La solicitud supera el tamaño permitido.");
    let form: FormData;
    try { form = await request.formData(); } catch { throw new SyntaxError("Envía los datos mediante multipart/form-data."); }
    for (const key of ["nombreCompleto", "email", "password", "cedula", "roles", "identidad"]) {
      if (form.getAll(key).length !== 1) throw new SyntaxError("Completa cada campo una sola vez.");
    }
    let roles: unknown;
    try { roles = JSON.parse(String(form.get("roles"))); } catch { throw new SyntaxError("Selecciona perfiles válidos."); }
    const input = registerSchema.parse({ ...Object.fromEntries(form), roles });
    const file = form.get("identidad");
    if (!(file instanceof File)) throw new SyntaxError("Selecciona un documento ficticio.");
    await validateUpload(file, "IDENTIDAD");
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { nombreCompleto: input.nombreCompleto, email: input.email, passwordHash,
        cedulaCifrada: encryptCedula(input.cedula), status: "PENDIENTE", roles: { create: input.roles.map((role) => ({ role })) } }, select: { id: true } });
      await writeAuditEvent({ actorId: created.id, action: "CUENTA_REGISTRADA", resourceType: "User", resourceId: created.id, result: "EXITO", detail: { roles: input.roles, status: "PENDIENTE" } }, tx);
      return created;
    });
    try {
      await saveValidatedUpload(file, { ownerId: user.id, kind: "IDENTIDAD" });
    } catch (error) {
      // El helper compartido revierte su archivo/registro; eliminar únicamente la cuenta de este intento.
      await prisma.$transaction([
        prisma.auditEvent.deleteMany({ where: { actorId: user.id, action: "CUENTA_REGISTRADA" } }),
        prisma.userRole.deleteMany({ where: { userId: user.id } }),
        prisma.user.delete({ where: { id: user.id } }),
      ]);
      throw error;
    }
    return Response.json({ ok: true, data: { status: "PENDIENTE", message: "Cuenta creada. Un administrador debe revisar tu documento y activarla." } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ ok: false, error: { code: "CUENTA_EXISTENTE", message: "No se pudo registrar ese correo. Inicia sesión o recupera tu contraseña." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
