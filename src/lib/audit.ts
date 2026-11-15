import { AccountStatus, ArticleStatus, AuctionStatus, FileKind, Role, type AuditEvent, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export class AuditError extends Error {
  constructor() {
    super("No se pudo registrar el evento de auditoría.");
    this.name = "AuditError";
  }
}

const sensitiveKey = /password|passwd|contrasena|cedula|email|correo|token|cookie|secret|nombre|name|telefono|phone|direccion|address|document|authorization|storagepath/i;
export const auditReasonSchema = z.enum([
  "REVISION_DOCUMENTAL_COHERENTE", "REVISION_INCOMPLETA",
  "DOCUMENTO_NO_DISPONIBLE", "REVISION_NO_PERMITIDA",
]);
export type AuditReasonCode = z.infer<typeof auditReasonSchema>;

const safeValues = new Set<string>([
  ...Object.values(AccountStatus), ...Object.values(ArticleStatus),
  ...Object.values(AuctionStatus), ...Object.values(FileKind), ...Object.values(Role),
  "EXITO", "ERROR", "DENEGADO", "SUCCESS", "FAILURE", "OK",
  ...auditReasonSchema.options,
]);

/** Solo estados conocidos y valores estructurados; el texto libre puede contener PII. */
export function sanitizeAuditDetail(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (depth > 10 || value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return safeValues.has(value) ? value : "[REDACTADO]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditDetail(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 100).filter(([key]) => {
    const normalized = key.normalize("NFD").replace(/[\u0300-\u036f_\-\s]/g, "");
    return /^[a-z][a-z0-9_]{0,63}$/i.test(key) && !sensitiveKey.test(normalized) && key !== "__proto__";
  }).map(([key, item]) => [key, sanitizeAuditDetail(item, depth + 1)]));
}

const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/, "Usa un código de auditoría válido.");
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "Identificador inválido.");
const eventSchema = z.object({
  actorId: identifier.optional(), action: code, resourceType: code,
  resourceId: identifier.optional(), result: code,
});

export async function writeAuditEvent(event: {
  actorId?: string; action: string; resourceType: string; resourceId?: string;
  result: string; detail?: Record<string, unknown>;
}, client: Pick<Prisma.TransactionClient, "auditEvent"> = prisma): Promise<AuditEvent> {
  const input = eventSchema.parse(event);
  const detail = event.detail ? sanitizeAuditDetail(event.detail) : undefined;
  try {
    return await client.auditEvent.create({ data: { ...input, ...(detail !== undefined && detail !== null ? { detail } : {}) } });
  } catch {
    // Nunca propagar errores Prisma con parámetros o datos del actor.
    throw new AuditError();
  }
}

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: code.optional(),
});

/** Proyección compartida entre API y página, sin relaciones ni identidad del actor. */
export async function listAuditEvents(query: z.input<typeof auditQuerySchema>) {
  const { page, pageSize, action } = auditQuerySchema.parse(query);
  const where = action ? { action } : {};
  const [items, total] = await prisma.$transaction([
    prisma.auditEvent.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, action: true, resourceType: true, resourceId: true, result: true, detail: true, createdAt: true },
    }),
    prisma.auditEvent.count({ where }),
  ], { isolationLevel: "RepeatableRead" });
  return {
    items: items.map((item) => ({ ...item, detail: sanitizeAuditDetail(item.detail) })),
    page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
