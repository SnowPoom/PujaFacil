import type { Role } from "@prisma/client";
import { getUserFromCookieHeader, type SessionUser } from "@/lib/auth/session";

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, public readonly code: string, message: string) {
    super(message);
    this.name = "AuthError";
  }
}
export async function requireSession(request: Request): Promise<SessionUser> {
  const user = await getUserFromCookieHeader(request.headers.get("cookie") ?? undefined);
  if (!user) throw new AuthError(401, "NO_AUTENTICADO", "Inicia sesión para continuar.");
  return user;
}
export async function requireActive(request: Request): Promise<SessionUser> {
  const user = await requireSession(request);
  if (user.status !== "ACTIVA") throw new AuthError(403, "CUENTA_NO_ACTIVA", "Tu cuenta debe estar activa para realizar esta operación.");
  return user;
}
export async function requireRole(request: Request, roles: Role[]): Promise<SessionUser> {
  const user = await requireActive(request);
  if (!roles.some((role) => hasRole(user, role))) throw new AuthError(403, "ROL_NO_PERMITIDO", "No tienes permiso para realizar esta operación.");
  return user;
}
export function hasRole(user: SessionUser | null, role: Role): boolean {
  return Boolean(user?.roles.includes(role));
}
export function canAccessResource(user: SessionUser | null, ownerId: string): boolean {
  return Boolean(user && user.id === ownerId);
}
export function assertTrustedOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AuthError(403, "ORIGEN_NO_PERMITIDO", "El origen de la solicitud no está permitido.");
  }
}
