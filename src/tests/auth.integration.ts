/** Prueba local C0: servidor iniciado y migración J1 aplicada.
 * node --env-file=.env --import tsx src/tests/auth.integration.ts
 * Crea y elimina únicamente sus propias cuentas ficticias.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { encryptCedula, decryptCedula } from "@/lib/auth/crypto";
import { requireActive, requireRole } from "@/lib/auth/guards";
import { getUserFromCookieHeader } from "@/lib/auth/session";
import type { Role } from "@prisma/client";

const origin = "http://localhost:3000";
const created: string[] = [];
const fixtureEmails: string[] = [];
const password = "Frase ficticia para pruebas 2026!";
let phase = "comprobar servidor";
const get = (path: string, cookie?: string) => fetch(`${origin}${path}`, {
  redirect: "manual", headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(15_000),
});
async function assertPanelRedirect(cookie?: string) {
  const response = await get("/panel", cookie);
  const html = await response.text();
  // Next.js emite meta refresh si Suspense ya inició una respuesta 200.
  if ([303, 307, 308].includes(response.status)) {
    assert.equal(new URL(response.headers.get("location")!, origin).pathname, "/iniciar-sesion");
  } else {
    assert.equal(response.status, 200);
    assert.ok((html.match(/<meta\b[^>]*>/g) ?? []).some((meta) =>
      /http-equiv="refresh"/i.test(meta) && /content="\d+;url=\/iniciar-sesion"/.test(meta)), "Falta redirección al login.");
  }
  assert.ok(!html.includes('aria-label="Operaciones de mi cuenta"'));
  assert.ok(!html.includes("Cuenta ficticia C0"));
}
function assertPrivate(body: string, secrets: string[]) {
  for (const secret of [...secrets, "passwordHash", "cedulaCifrada", "tokenHash", "telefono", "direccion"]) {
    assert.ok(!body.includes(secret), "Una respuesta contiene datos confidenciales.");
  }
}
async function main() {
  try {
    assert.equal((await get("/iniciar-sesion")).status, 200);
    phase = "redirección /panel sin sesión o con cookie inválida";
    await assertPanelRedirect();
    await assertPanelRedirect("pf_session=invalida");
    console.log("PASS /panel sin sesión y con cookie inválida: redirección real al login.");
    phase = "creación de fixtures";
    const passwordHash = await bcrypt.hash(password, 12);
    const users = [];
    for (const fixture of [
      { status: "ACTIVA", roles: ["COMPRADOR", "VENDEDOR"] },
      { status: "PENDIENTE", roles: ["COMPRADOR", "VENDEDOR"] },
      { status: "ACTIVA", roles: ["AUDITOR"] },
      { status: "ACTIVA", roles: ["AUDITOR", "COMPRADOR", "VENDEDOR", "ADMIN_SUBASTAS", "VERIFICADOR"] },
    ] as const) {
      const email = `auth-c0-${randomUUID()}@example.test`;
      fixtureEmails.push(email); // Antes del INSERT, para limpiar incluso si se pierde su respuesta.
      const user = await prisma.user.create({ data: {
        nombreCompleto: "Cuenta ficticia C0", email, passwordHash,
        cedulaCifrada: encryptCedula("1234567890"), status: fixture.status,
        roles: { create: fixture.roles.map((role: Role) => ({ role })) },
      }, include: { roles: true } });
      created.push(user.id); users.push(user);
      assert.notEqual(user.cedulaCifrada, "1234567890");
      assert.equal(decryptCedula(user.cedulaCifrada), "1234567890");
    }
    const post = (path: string, body?: unknown, cookie?: string, trustedOrigin = origin) => fetch(`${origin}${path}`, {
      method: "POST", headers: { Origin: trustedOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
    });
    assert.equal((await fetch(`${origin}/api/auth/me`)).status, 401);
    assert.equal((await post("/api/auth/login", { email: users[0].email, password }, undefined, "https://otro.test")).status, 403);
    assert.equal((await post("/api/auth/login", { email: users[0].email, password: "incorrecta" })).status, 401);
    for (const user of users) {
      phase = `login/panel/guards ${user.status} ${user.roles.map(({ role }) => role).join("+")}`;
      const start = Date.now();
      const response = await post("/api/auth/login", { email: user.email, password });
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")!;
      for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/"]) assert.ok(cookie.includes(flag));
      assert.ok(!cookie.includes("Secure"), "Esta prueba requiere el servidor HTTP de desarrollo.");
      const credential = cookie.split(";")[0];
      const rawToken = credential.split("=")[1];
      assert.match(rawToken, /^[a-f\d]{64}$/);
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const stored = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      assert.notEqual(stored.tokenHash, rawToken);
      assert.equal(await prisma.session.count({ where: { userId: user.id, tokenHash: rawToken } }), 0);
      assert.ok(Math.abs(stored.expiresAt.getTime() - start - 604_800_000) < 5_000);
      assert.ok(cookie.includes(`Expires=${stored.expiresAt.toUTCString()}`));
      const secrets = [password, user.passwordHash, user.cedulaCifrada, rawToken, tokenHash, "1234567890"];
      const body = await response.text();
      assertPrivate(body, secrets);
      const payload = JSON.parse(body);
      assert.deepEqual(Object.keys(payload.data.user).sort(), ["email", "id", "nombreCompleto", "roles", "status"]);
      const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: credential } });
      assert.equal(me.status, 200);
      const meBody = await me.text();
      assertPrivate(meBody, secrets);
      assert.deepEqual(Object.keys(JSON.parse(meBody).data.user).sort(), ["email", "id", "nombreCompleto", "roles", "status"]);
      const panel = await fetch(`${origin}/panel`, { headers: { Cookie: credential } });
      const html = await panel.text();
      assertPrivate(html, secrets);
      assert.ok(html.includes(user.status === "PENDIENTE" ? "Pendiente de aprobación" : "Mi panel"));
      const nav = html.match(/<nav\b[^>]*aria-label="Operaciones de mi cuenta"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
      const links = [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      const roles = user.roles.map(({ role }) => role);
      const expectedLinks = user.status === "PENDIENTE" ? [] : roles.includes("AUDITOR") ? ["/auditoria"] : ["/mis-articulos", "/subastas", "/chat"];
      assert.deepEqual(links.sort(), expectedLinks.sort());
      const guardRequest = new Request(`${origin}/api/test`, { headers: { Cookie: credential } });
      if (user.status === "PENDIENTE") await assert.rejects(() => requireActive(guardRequest), { status: 403 });
      else {
        assert.equal((await requireActive(guardRequest)).id, user.id);
        for (const role of roles) assert.equal((await requireRole(guardRequest, [role])).id, user.id);
      }
      if (!roles.includes("ADMIN_SUBASTAS")) await assert.rejects(() => requireRole(guardRequest, ["ADMIN_SUBASTAS"]), { status: 403 });
      phase = `caducidad/revocación ${user.status} ${roles.join("+")}`;
      await prisma.session.update({ where: { id: stored.id }, data: { expiresAt: new Date(0) } });
      assert.equal(await getUserFromCookieHeader(credential), null);
      assert.equal((await get("/api/auth/me", credential)).status, 401);
      await assertPanelRedirect(credential);
      await prisma.session.update({ where: { id: stored.id }, data: { expiresAt: stored.expiresAt } });
      assert.equal((await get("/api/auth/me", credential)).status, 200);
      assert.equal((await post("/api/auth/logout", undefined, credential, "https://otro.test")).status, 403);
      assert.equal(await prisma.session.count({ where: { id: stored.id } }), 1);
      const logout = await post("/api/auth/logout", undefined, credential);
      assert.equal(logout.status, 200);
      assert.ok(logout.headers.get("set-cookie")!.includes("Expires=Thu, 01 Jan 1970"));
      assert.equal(await prisma.session.count({ where: { tokenHash } }), 0);
      assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: credential } })).status, 401);
      assert.equal(await getUserFromCookieHeader(credential), null);
      await assertPanelRedirect(credential);
      console.log(`PASS ${user.status} ${roles.join("+")}: login, cookie, hash, privacidad, panel/roles, caducidad y logout/revocación.`);
    }
    console.log("PASS C0 PostgreSQL: login, cookie HttpOnly, token hasheado, panel, pendiente/roles, CSRF, logout y revocación.");
  } finally {
    try {
      const fixtures = await prisma.user.findMany({ where: { email: { in: fixtureEmails } }, select: { id: true } });
      const ids = fixtures.map(({ id }) => id);
      await prisma.$transaction([
        prisma.session.deleteMany({ where: { userId: { in: ids } } }),
        prisma.userRole.deleteMany({ where: { userId: { in: ids } } }),
        prisma.user.deleteMany({ where: { email: { in: fixtureEmails } } }),
      ]);
      assert.equal(await prisma.user.count({ where: { email: { in: fixtureEmails } } }), 0);
      assert.equal(await prisma.session.count({ where: { userId: { in: [...created, ...ids] } } }), 0);
      assert.equal(await prisma.userRole.count({ where: { userId: { in: [...created, ...ids] } } }), 0);
      console.log("PASS limpieza: 0 cuentas, sesiones y roles residuales de este run.");
    } finally { await prisma.$disconnect(); }
  }
}
main().catch(() => { console.error(`FAIL C0 en ${phase}; se intentó limpiar los fixtures en finally. No se imprimen credenciales.`); process.exitCode = 1; });
