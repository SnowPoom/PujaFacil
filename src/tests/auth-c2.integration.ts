/** Lunes 16/11: npm run dev y luego
 * node --env-file=.env --import tsx src/tests/auth-c2.integration.ts
 * --evidence mantiene fixtures propios hasta pulsar Enter para capturar el navegador.
 * No modifica cuentas demo ni código de otros módulos.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptCedula } from "@/lib/auth/crypto";
import { requireRole } from "@/lib/auth/guards";
import { getUserFromCookieHeader } from "@/lib/auth/session";
// Importaciones reales de consumidores: comprueban el mismo contrato sin editar sus archivos.
import { authenticateSocketHandshake } from "@/server/socket/index";

const origin = "http://localhost:3000";
const password = "Una frase ficticia para integrar el lunes!";
const emails: string[] = [];
let phase = "rutas sin sesión";
const call = (url: string, cookie?: string, body?: unknown) => fetch(`${origin}${url}`, {
  method: body === undefined ? "GET" : "POST", redirect: "manual", signal: AbortSignal.timeout(30000),
  headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function privateResponse(text: string, secrets: string[] = []) {
  for (const secret of ["passwordHash", "cedulaCifrada", "tokenHash", password, ...secrets]) {
    assert.ok(!text.includes(secret), "Respuesta con credenciales o campos privados.");
  }
}
async function redirected(url: string, cookie?: string) {
  const response = await call(url, cookie);
  const html = await response.text();
  if ([303, 307, 308].includes(response.status)) {
    assert.equal(new URL(response.headers.get("location")!, origin).pathname, "/iniciar-sesion");
  } else {
    assert.equal(response.status, 200);
    assert.ok((html.match(/<meta\b[^>]*>/g) ?? []).some((meta) =>
      /http-equiv="refresh"/i.test(meta) && /content="\d+;url=\/iniciar-sesion"/.test(meta)));
  }
  privateResponse(html);
  assert.ok(!html.includes("Mi perfil"));
  assert.ok(!html.includes("Administración de usuarios"));
}
async function fixture(role: Role) {
  const email = `c2-${randomUUID()}@example.test`;
  emails.push(email);
  return prisma.user.create({ data: {
    nombreCompleto: "Cuenta ficticia C2", email, status: "ACTIVA",
    passwordHash: await bcrypt.hash(password, 12), cedulaCifrada: encryptCedula("1234567890"),
    roles: { create: { role } },
  } });
}
async function credential(email: string) {
  const response = await call("/api/auth/login", undefined, { email, password, roles: ["ADMIN_SUBASTAS"] });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie")!;
  for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/"]) assert.ok(setCookie.includes(flag));
  privateResponse(await response.text());
  return setCookie.split(";")[0];
}
async function main() {
  try {
    for (const url of ["/panel", "/perfil", "/admin/usuarios"]) await redirected(url);
    for (const url of ["/api/auth/me", "/api/admin/users", "/api/articles", "/api/verification", "/api/me/bids"]) {
      assert.equal((await call(url)).status, 401, url);
    }
    assert.equal((await call("/api/auctions", undefined, {})).status, 401);
    console.log("PASS C2: rutas SSR directas redirigen; APIs auth/artículos/verificación/pujas/subastas exigen sesión.");

    const admin = await fixture("ADMIN_SUBASTAS"), buyer = await fixture("COMPRADOR");
    const adminCookie = await credential(admin.email), buyerCookie = await credential(buyer.email);
    phase = "matriz de roles y privacidad";
    for (const [cookie, expected] of [[buyerCookie, 403], [adminCookie, 200]] as const) {
      const response = await call("/api/admin/users", cookie);
      assert.equal(response.status, expected);
      privateResponse(await response.text(), [admin.passwordHash, buyer.cedulaCifrada]);
    }
    const me = await call("/api/auth/me", buyerCookie);
    assert.equal(me.status, 200);
    assert.deepEqual(Object.keys((await me.json()).data.user).sort(), ["email", "id", "nombreCompleto", "roles", "status"]);
    const denied = await call("/admin/usuarios", buyerCookie);
    const deniedHtml = await denied.text();
    assert.ok(deniedHtml.includes("Acceso restringido"));
    assert.ok(!deniedHtml.includes("Administración de usuarios"));
    for (const url of ["/panel", "/perfil", "/admin/usuarios"]) {
      const response = await call(url, adminCookie);
      assert.equal(response.status, 200);
      privateResponse(await response.text(), [admin.passwordHash, admin.cedulaCifrada, adminCookie.split("=")[1]]);
    }
    for (const url of ["/api/articles", "/api/verification"]) assert.equal((await call(url, buyerCookie)).status, 403, url);
    assert.equal((await call("/api/auctions", buyerCookie, {})).status, 403);
    assert.equal((await call("/api/me/bids", buyerCookie)).status, 200);
    console.log("PASS C2: usuarios 401/403/200, comprador sin privilegios inventados; SSR y JSON sin hashes ni tokens.");

    phase = "contrato Socket.IO";
    const socket: Parameters<typeof authenticateSocketHandshake>[0] = { handshake: { headers: { cookie: buyerCookie } } as never, data: {} };
    const handshakeResults: (Error | undefined)[] = [];
    await authenticateSocketHandshake(socket, (error) => { handshakeResults.push(error); });
    assert.deepEqual(handshakeResults, [undefined]);
    assert.equal(socket.data.userId, buyer.id);
    assert.deepEqual(socket.data.roles, ["COMPRADOR"]);
    assert.equal((await getUserFromCookieHeader(buyerCookie))?.id, buyer.id);
    const deniedHandshake: (Error | undefined)[] = [];
    await authenticateSocketHandshake({ handshake: { headers: {} } as never, data: {} }, (error) => { deniedHandshake.push(error); });
    assert.equal(deniedHandshake.length, 1);
    assert.equal(deniedHandshake[0]?.message, "UNAUTHORIZED");
    console.log("PASS C2: handshake real de Kevin importa el helper y resuelve la misma cookie pf_session contra PostgreSQL.");

    phase = "cambio de rol persistido sin renovar cookie";
    await prisma.userRole.updateMany({ where: { userId: admin.id }, data: { role: "COMPRADOR" } });
    assert.equal((await getUserFromCookieHeader(adminCookie))?.roles[0], "COMPRADOR");
    await assert.rejects(() => requireRole(new Request(`${origin}/api/test`, { headers: { Cookie: adminCookie } }), ["ADMIN_SUBASTAS"]), { status: 403 });
    assert.equal((await call("/api/admin/users", adminCookie)).status, 403);
    const changedPage = await call("/admin/usuarios", adminCookie);
    assert.ok((await changedPage.text()).includes("Acceso restringido"));
    await prisma.user.update({ where: { id: admin.id }, data: { status: "SUSPENDIDA" } });
    assert.equal((await call("/api/auth/me", adminCookie)).status, 401);
    await redirected("/perfil", adminCookie);
    console.log("PASS C2: un cambio real de rol o suspensión revoca acceso en la siguiente petición con la misma cookie.");

    if (process.argv.includes("--evidence")) {
      console.log(`EVIDENCE comprador ficticio: ${buyer.email}`);
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question("EVIDENCE: Enter para limpiar las cuentas de este run.\n"); }
      finally { terminal.close(); }
    }
  } finally {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map(({ id }) => id);
    await prisma.$transaction([
      prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }),
      prisma.session.deleteMany({ where: { userId: { in: ids } } }),
      prisma.userRole.deleteMany({ where: { userId: { in: ids } } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }),
    ]);
    assert.equal(await prisma.user.count({ where: { email: { in: emails } } }), 0);
    await prisma.$disconnect();
    console.log("PASS C2: limpieza de cuentas, sesiones, roles y auditorías de fixtures propios.");
  }
}
main().catch(() => { console.error(`FAIL C2 en ${phase}. No se imprimen credenciales.`); process.exitCode = 1; });
