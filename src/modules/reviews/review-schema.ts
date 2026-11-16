import { z } from "zod";

export const reviewDecisionValues = [
  "APROBADO",
  "RECHAZADO",
  "REQUIERE_CORRECCIONES",
] as const;

export const reviewDecisionEnum = z.enum(reviewDecisionValues, {
  message: "La decisión debe ser APROBADO, RECHAZADO o REQUIERE_CORRECCIONES.",
});

export type ReviewDecisionType = z.infer<typeof reviewDecisionEnum>;

const safeIdRegex = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Esquema Zod para asignar un artículo pendiente a un verificador.
 * Solo un usuario con rol ADMIN_SUBASTAS puede ejecutar esta acción.
 */
export const assignReviewSchema = z
  .object({
    articleId: z
      .string()
      .trim()
      .min(1, "El identificador del artículo es obligatorio.")
      .max(128, "Identificador de artículo inválido.")
      .regex(safeIdRegex, "Identificador de artículo inválido."),
    verifierId: z
      .string()
      .trim()
      .min(1, "El identificador del verificador es obligatorio.")
      .max(128, "Identificador de verificador inválido.")
      .regex(safeIdRegex, "Identificador de verificador inválido."),
  })
  .strict();

export type AssignReviewInput = z.infer<typeof assignReviewSchema>;

/**
 * Esquema Zod para registrar la resolución de revisión de un artículo.
 * El verificador debe estar asignado a ese artículo y no ser su propietario.
 */
export const decideReviewSchema = z
  .object({
    decision: reviewDecisionEnum,
    comments: z
      .string()
      .trim()
      .min(5, "Las observaciones deben tener al menos 5 caracteres.")
      .max(1000, "Las observaciones no pueden superar los 1000 caracteres."),
  })
  .strict();

export const decisionReviewSchema = decideReviewSchema;

export type DecideReviewInput = z.infer<typeof decideReviewSchema>;

/**
 * Regla de negocio: verifica que el verificador no sea el propietario del artículo
 * y que quien asigna posea el rol ADMIN_SUBASTAS.
 */
export function validateReviewAssignmentRules(params: {
  actorRoles: readonly string[];
  verifierId: string;
  articleOwnerId: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (!params.actorRoles.includes("ADMIN_SUBASTAS")) {
    return {
      ok: false,
      code: "ROL_NO_PERMITIDO",
      message: "Solo un administrador de subastas puede asignar verificadores.",
    };
  }

  if (params.verifierId === params.articleOwnerId) {
    return {
      ok: false,
      code: "CONFLICTO_PROPIETARIO",
      message: "El propietario del artículo no puede ser asignado como su verificador.",
    };
  }

  return { ok: true };
}

/**
 * Regla de negocio: verifica que quien emite la decisión sea el verificador asignado
 * y no sea el propietario del artículo.
 */
export function validateReviewDecisionRules(params: {
  actorId: string;
  assignedVerifierId: string;
  articleOwnerId: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (params.actorId === params.articleOwnerId) {
    return {
      ok: false,
      code: "PROPIETARIO_NO_AUTORIZADO",
      message: "El vendedor propietario no puede revisar ni aprobar su propio artículo.",
    };
  }

  if (params.actorId !== params.assignedVerifierId) {
    return {
      ok: false,
      code: "VERIFICADOR_NO_ASIGNADO",
      message: "Solo el verificador asignado a este expediente puede emitir una decisión.",
    };
  }

  return { ok: true };
}
