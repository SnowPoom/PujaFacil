import { z } from "zod";

/* ================================================================== *
 *  PujaFácil — Esquemas de validación de Artículos                   *
 *  Propietario: módulo articles (capa de dominio)                    *
 * ================================================================== */

// ─── Regex para precio en formato USD ────────────────────────────────
const DECIMAL_PRICE_RE = /^\d{1,10}\.\d{2}$/;

// ─── articleInputSchema ──────────────────────────────────────────────

export const articleInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "El título debe tener al menos 5 caracteres")
    .max(100, "El título no puede exceder 100 caracteres"),

  description: z
    .string()
    .trim()
    .min(20, "La descripción debe tener al menos 20 caracteres")
    .max(2000, "La descripción no puede exceder 2000 caracteres"),

  category: z
    .string()
    .trim()
    .min(2, "La categoría debe tener al menos 2 caracteres")
    .max(60, "La categoría no puede exceder 60 caracteres"),

  condition: z
    .string()
    .trim()
    .min(3, "La condición debe tener al menos 3 caracteres")
    .max(80, "La condición no puede exceder 80 caracteres"),

  provenance: z
    .string()
    .trim()
    .min(10, "La procedencia debe tener al menos 10 caracteres")
    .max(1000, "La procedencia no puede exceder 1000 caracteres"),

  initialPrice: z
    .string()
    .regex(
      DECIMAL_PRICE_RE,
      'El precio debe tener formato decimal USD (ej. "120.00")'
    )
    .refine(
      (val) => parseFloat(val) > 0,
      "El precio inicial debe ser mayor a 0.00"
    ),
});

export type ArticleInput = z.infer<typeof articleInputSchema>;

// ─── articleUpdateSchema ─────────────────────────────────────────────
// Versión parcial: acepta uno o más campos para editar borradores/correcciones.

export const articleUpdateSchema = articleInputSchema.partial();

export type ArticleUpdate = z.infer<typeof articleUpdateSchema>;

// ─── articleListQuerySchema ──────────────────────────────────────────

export const articleListQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce
    .number()
    .int("La página debe ser un número entero")
    .positive("La página debe ser un entero positivo")
    .default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize debe ser un número entero")
    .min(1, "pageSize mínimo es 1")
    .max(50, "pageSize máximo es 50")
    .default(8),
});

export type ArticleListQuery = z.infer<typeof articleListQuerySchema>;
