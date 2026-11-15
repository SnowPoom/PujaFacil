import { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Valida un importe en USD expresado como string exacto de dos decimales (Decimal(12,2)),
 * mayor que 0.00 y sin usar parseFloat para decisiones económicas.
 */
export const usdAmountSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,9})\.\d{2}$/,
    "El importe debe expresarse en USD con exactamente dos decimales (ej. '120.00')."
  )
  .refine(
    (value) => {
      try {
        return new Prisma.Decimal(value).greaterThan(0);
      } catch {
        return false;
      }
    },
    { message: "El importe en USD debe ser mayor a 0.00." }
  );

/**
 * Valida una fecha en formato ISO 8601.
 */
export const isoDateTimeSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        return false;
      }
      const parsed = new Date(value);
      return !Number.isNaN(parsed.getTime());
    },
    { message: "Ingresa una fecha y hora válida en formato ISO 8601." }
  );

/**
 * Esquema Zod para programar/crear una subasta a partir de un artículo aprobado.
 */
export const createAuctionSchema = z
  .object({
    articleId: z
      .string()
      .trim()
      .min(1, "El identificador del artículo es obligatorio.")
      .max(128, "Identificador de artículo inválido."),
    startingPrice: usdAmountSchema,
    minIncrement: usdAmountSchema,
    opensAt: isoDateTimeSchema,
    closesAt: isoDateTimeSchema,
  })
  .strict()
  .refine(
    (data) => new Date(data.opensAt).getTime() < new Date(data.closesAt).getTime(),
    {
      message: "La fecha de apertura debe ser estrictamente anterior a la fecha de cierre.",
      path: ["closesAt"],
    }
  );

export type CreateAuctionInput = z.infer<typeof createAuctionSchema>;

/**
 * Esquema para suspender una subasta con motivo obligatorio (RN-040).
 */
export const suspendAuctionSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(5, "El motivo de suspensión debe tener al menos 5 caracteres.")
      .max(500, "El motivo de suspensión no puede exceder los 500 caracteres."),
  })
  .strict();

export type SuspendAuctionInput = z.infer<typeof suspendAuctionSchema>;

/**
 * Verifica mediante aritmética exacta (Prisma.Decimal) que el precio inicial de la subasta
 * no sea menor al precio inicial aprobado del artículo.
 */
export function validateStartingPriceAgainstArticle(
  startingPrice: string | Prisma.Decimal,
  approvedInitialPrice: string | Prisma.Decimal
): { ok: true } | { ok: false; code: string; message: string } {
  try {
    const startDec = new Prisma.Decimal(startingPrice);
    const articleDec = new Prisma.Decimal(approvedInitialPrice);

    if (startDec.lessThan(articleDec)) {
      return {
        ok: false,
        code: "PRECIO_INICIAL_MENOR_AL_APROBADO",
        message: `El precio inicial de la subasta ($${startDec.toFixed(2)}) no puede ser menor al precio inicial aprobado del artículo ($${articleDec.toFixed(2)}).`,
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      code: "FORMATO_MONETARIO_INVALIDO",
      message: "Los importes proporcionados no tienen un formato monetario válido.",
    };
  }
}

/**
 * Evalúa si la ventana de la subasta está vigente usando exclusivamente el reloj del servidor (RN-039).
 */
export function isWithinServerAuctionWindow(
  opensAt: Date,
  closesAt: Date,
  serverNow: Date = new Date()
): boolean {
  const nowMs = serverNow.getTime();
  return nowMs >= opensAt.getTime() && nowMs < closesAt.getTime();
}
