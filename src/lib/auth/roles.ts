import type { Role } from "@prisma/client";

/** Regla 1B: COMPRADOR/VENDEDOR pueden combinarse; los roles internos son exclusivos.
 * Las futuras asignaciones administrativas deben validar el conjunto final con este helper
 * antes de persistirlo (RN-002/003/011 y RF-SEG-08/11, concretadas por el usuario).
 */
export function hasValidRoles(roles: readonly Role[]): boolean {
  if (roles.length === 0 || new Set(roles).size !== roles.length) return false;
  if (roles.every((role) => role === "COMPRADOR" || role === "VENDEDOR")) return true;
  return roles.length === 1 && ["VERIFICADOR", "ADMIN_SUBASTAS", "AUDITOR"].includes(roles[0]);
}

/** Las cuentas internas no participan en la aprobación de clientes. */
export function hasCommercialRoles(roles: readonly Role[]): boolean {
  return hasValidRoles(roles) && roles.every((role) => role === "COMPRADOR" || role === "VENDEDOR");
}

export function bidRestriction(user: { id: string; status: string; roles: readonly Role[] } | null, ownerId?: string): string | null {
  if (!user) return "Inicia sesión para ofertar.";
  if (user.status !== "ACTIVA") return "Tu cuenta debe estar activa para ofertar.";
  if (!hasCommercialRoles(user.roles) || !user.roles.includes("COMPRADOR")) return "Solo las cuentas con perfil de comprador pueden ofertar.";
  if (user.id === ownerId) return "No puedes ofertar por tu propio artículo.";
  return null;
}
