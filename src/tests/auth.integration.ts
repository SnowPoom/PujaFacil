/** Prueba local C0: servidor iniciado y migración J1 aplicada.
 * node --env-file=.env --import tsx src/tests/auth.integration.ts
 * Crea y elimina únicamente sus propias cuentas ficticias.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { encryptCedula } from "@/lib/auth/crypto";
import { requireActive, requireRole } from "@/lib/auth/guards";
import { hashToken } from "@/lib/auth/session";

const origin = "http://localhost:3000";
const created: string[] = [];
const password = "Frase ficticia para pruebas 2026!";
async function main() {
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const users = [];
    for (const status of ["ACTIVA", "PENDIENTE"] as const) {
      const user = await prisma.user.create({ data: {
        nombreCompleto: "Cuenta ficticia C0", email: `auth-${randomUUID()}@example.test`, passwordHash,
        cedulaCifrada: encryptCedula("1234567890"), status, roles: { create: { role: "COMPRADOR" } },
      } });
      created.push(user.id); users.push(user);
      assert.notEqual(user.cedulaCifrada, "1234567890");
    }
    const post = (path: string, body?: unknown, cookie?: string, trustedOrigin = origin) => fetch(`${origin}${path}`, {
      method: "POST", headers: { Origin: trustedOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await fetch(`${origin}/api/auth/me`)).status, 401);
    assert.equal((await post("/api/auth/login", { email: users[0].email, password }, undefined, "https://otro.test")).status, 403);
    assert.equal((await post("/api/auth/login", { email: users[0].email, password: "incorrecta" })).status, 401);
    for (const user of users) {
      const response = await post("/api/auth/login", { email: user.email, password });
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")!;
      for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/"]) assert.ok(cookie.includes(flag));
      const credential = cookie.split(";")[0];
      const rawToken = credential.split("=")[1];
      const stored = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(rawToken) } });
      assert.notEqual(stored.tokenHash, rawToken);
      assert.ok(stored.expiresAt.getTime() > Date.now() + 6 * 86_400_000);
      const payload = await response.json();
      assert.deepEqual(Object.keys(payload.data.user).sort(), ["email", "id", "nombreCompleto", "roles", "status"]);
      const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: credential } });
      assert.equal(me.status, 200);
      const panel = await fetch(`${origin}/panel`, { headers: { Cookie: credential } });
      const html = await panel.text();
      assert.ok(html.includes(user.status === "PENDIENTE" ? "Pendiente de aprobación" : "Mi panel"));
      const guardRequest = new Request(`${origin}/api/test`, { headers: { Cookie: credential } });
      if (user.status === "PENDIENTE") await assert.rejects(() => requireActive(guardRequest), { status: 403 });
      else assert.equal((await requireActive(guardRequest)).id, user.id);
      await assert.rejects(() => requireRole(guardRequest, ["ADMIN_SUBASTAS"]), { status: 403 });
      const logout = await post("/api/auth/logout", undefined, credential);
      assert.equal(logout.status, 200);
      assert.ok(logout.headers.get("set-cookie")!.includes("Expires=Thu, 01 Jan 1970"));
      assert.equal(await prisma.session.count({ where: { tokenHash: hashToken(rawToken) } }), 0);
      assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: credential } })).status, 401);
    }
    console.log("PASS C0 PostgreSQL: login, cookie HttpOnly, token hasheado, panel, pendiente/roles, CSRF, logout y revocación.");
  } finally {
    await prisma.session.deleteMany({ where: { userId: { in: created } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }
}
main().catch(() => { console.error("FAIL C0: revisa servidor, migración y configuración local; no se imprimen credenciales."); process.exitCode = 1; });
