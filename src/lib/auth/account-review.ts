import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditReasonSchema, sanitizeAuditDetail, writeAuditEvent, type AuditReasonCode } from "@/lib/audit";
import { decryptCedula } from "@/lib/auth/crypto";
import { authErrorResponse } from "@/lib/auth/http";
import { activationSchema as clientActivationSchema, APPROVAL_REASON } from "@/lib/auth/schemas";

// Usar el catálogo de Jonathan solo en servidor: audit.ts no entra en el bundle del cliente.
export const activationSchema = clientActivationSchema.extend({
  motivoCodigo: auditReasonSchema.refine((code) => code === APPROVAL_REASON, "El motivo debe justificar una revisión documental coherente."),
});

// Vigencia de la evidencia de revisión; no es la revelación de seudónimos de RN-077.
export const REVIEW_LIFETIME_MS = 15 * 60 * 1000;

class AccountReviewError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function accountReviewErrorResponse(error: unknown): Response {
  if (error instanceof AccountReviewError) return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  return authErrorResponse(error);
}
const reviewSelect = {
  id: true, status: true, updatedAt: true,
  files: { where: { kind: "IDENTIDAD" as const }, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1,
    select: { id: true, mimeType: true } },
} satisfies Prisma.UserSelect;

export async function openAccountReview(actorId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ...reviewSelect, nombreCompleto: true, cedulaCifrada: true } });
  if (!user || user.status !== "PENDIENTE") throw new AccountReviewError(404, "CUENTA_NO_DISPONIBLE", "Solo se pueden revisar cuentas pendientes.");
  const identity = user.files[0];
  if (!identity) throw new AccountReviewError(409, "IDENTIDAD_PENDIENTE", "La cuenta no tiene un documento de identidad cargado.");
  const cedula = decryptCedula(user.cedulaCifrada);
  const review = await writeAuditEvent({ actorId, action: "CUENTA_DATOS_CONSULTADOS", resourceType: "FileRecord", resourceId: identity.id,
    result: "EXITO", detail: { accountVersion: user.updatedAt.getTime() } });
  // Ningún dato personal se añade al listado ni al evento de auditoría.
  return { reviewId: review.id, user: { nombreCompleto: user.nombreCompleto, cedula }, identity };
}

export async function activateReviewedAccount(actorId: string, userId: string, input: z.infer<typeof activationSchema>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: reviewSelect });
    const identity = user?.files[0];
    if (!user || user.status !== "PENDIENTE" || !identity) throw new AccountReviewError(409, "ACTIVACION_NO_PERMITIDA", "La cuenta debe estar pendiente y tener un documento de identidad cargado.");
    if (identity.id !== input.documentoRevisadoId) throw new AccountReviewError(409, "DOCUMENTO_NO_CORRESPONDE", "El documento revisado no corresponde a esta cuenta pendiente.");
    const review = await tx.auditEvent.findFirst({ where: { id: input.reviewId, actorId, action: "CUENTA_DATOS_CONSULTADOS",
      resourceType: "FileRecord", resourceId: identity.id, result: "EXITO", createdAt: { gte: new Date(Date.now() - REVIEW_LIFETIME_MS) } } });
    const detail = review?.detail;
    if (!review || !detail || typeof detail !== "object" || Array.isArray(detail) || detail.accountVersion !== user.updatedAt.getTime()) {
      throw new AccountReviewError(409, "REVISION_REQUERIDA", "Abre de nuevo la revisión de los datos de esta cuenta antes de aprobarla.");
    }
    // Evidencia emitida por GET /api/files/[id], nunca por una afirmación del navegador.
    // J2 registra EXITO después de autorizar y leer el archivo, antes de entregarlo.
    const consultation = await tx.auditEvent.findFirst({ where: { actorId, action: "IDENTIDAD_CONSULTADA", resourceType: "FileRecord",
      resourceId: identity.id, result: "EXITO", createdAt: { gte: review.createdAt } } });
    if (!consultation) throw new AccountReviewError(409, "LECTURA_AUDITADA_REQUERIDA", "No se ha podido verificar la lectura protegida del documento. La cuenta continúa pendiente.");
    const motivoCodigo: AuditReasonCode = input.motivoCodigo;
    const sanitized = sanitizeAuditDetail({ motivoCodigo });
    if (!sanitized || typeof sanitized !== "object" || !("motivoCodigo" in sanitized) || sanitized.motivoCodigo !== motivoCodigo) {
      throw new AccountReviewError(503, "MOTIVO_AUDITORIA_NO_DISPONIBLE", "La auditoría no puede conservar el motivo de aprobación. La cuenta continúa pendiente.");
    }
    await tx.user.update({ where: { id: userId }, data: { status: "ACTIVA" } });
    const event = await writeAuditEvent({ actorId, action: "CUENTA_ACTIVADA", resourceType: "User", resourceId: userId,
      result: "EXITO", detail: { previousStatus: "PENDIENTE", status: "ACTIVA", motivoCodigo } }, tx);
    // También comprobar el resultado persistido; si el helper cambia, se revierte la activación.
    if (!event.detail || typeof event.detail !== "object" || Array.isArray(event.detail) || event.detail.motivoCodigo !== motivoCodigo) {
      throw new AccountReviewError(503, "MOTIVO_AUDITORIA_NO_DISPONIBLE", "No se pudo registrar el motivo de aprobación.");
    }
    return { id: userId, status: "ACTIVA" as const };
  });
}
