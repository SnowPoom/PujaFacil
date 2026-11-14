import { createHash, randomBytes } from "node:crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import type { AccountStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasValidRoles } from "@/lib/auth/roles";

export type SessionUser = { id: string; nombreCompleto: string; email: string; status: AccountStatus; roles: Role[] };
export const SESSION_COOKIE_NAME = "pf_session";
export const sessionUserSelect = {
  id: true, nombreCompleto: true, email: true, status: true,
  roles: { select: { role: true } },
} as const;
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
export function readSessionToken(cookieHeader?: string): string | undefined {
  const rawToken = parseCookie(cookieHeader ?? "")[SESSION_COOKIE_NAME];
  return rawToken && /^[a-f\d]{64}$/.test(rawToken) ? rawToken : undefined;
}
export async function getUserFromCookieHeader(cookieHeader?: string): Promise<SessionUser | null> {
  const token = readSessionToken(cookieHeader);
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, user: { select: sessionUserSelect } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  const { user } = session;
  if (user.status === "SUSPENDIDA" || user.status === "CERRADA") return null;
  const roles = user.roles.map(({ role }) => role);
  if (!hasValidRoles(roles)) return null;
  return { ...user, roles };
}
export async function createUserSession(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { roles: { select: { role: true } } } });
  if (!user || !hasValidRoles(user.roles.map(({ role }) => role))) {
    throw new Error("No se puede crear una sesión para una cuenta con roles inválidos.");
  }
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(rawToken), expiresAt } });
  return { rawToken, expiresAt };
}
export async function deleteSessionFromRawToken(rawToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}
export function sessionCookie(rawToken: string, expiresAt: Date): string {
  return stringifySetCookie({ name: SESSION_COOKIE_NAME, value: rawToken, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}
