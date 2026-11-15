/** C1 real: npm run dev, luego node --env-file=.env --import tsx src/tests/auth-c1.integration.ts.
 * Usa únicamente fixtures ficticios propios y los elimina en finally.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptCedula } from "@/lib/auth/crypto";
import { createUserSession, hashToken } from "@/lib/auth/session";
import { requireActive } from "@/lib/auth/guards";
import { POST as forgot } from "@/app/api/auth/forgot-password/route";

const origin = "http://localhost:3000";
const emails: string[] = [];
const password = "Frase ficticia para probar cuentas 2026!";
const newPassword = "Una nueva frase extensa para mi cuenta!";
let phase = "inicio";
const call = (url: string, method = "GET", body?: unknown, cookie?: string) => fetch(`${origin}${url}`, {
  method, redirect: "manual", signal: AbortSignal.timeout(30000),
  headers: { Origin: origin, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
});
async function fixture(role: Role, status: "ACTIVA" | "PENDIENTE" = "ACTIVA") {
  const email = `c1-${randomUUID()}@example.test`; emails.push(email);
  return prisma.user.create({ data: { nombreCompleto: "Cuenta ficticia C1", email, passwordHash: await bcrypt.hash(password, 12), cedulaCifrada: encryptCedula("1234567890"), status, roles: { create: { role } } } });
}
async function login(email: string, secret = password) {
  const response = await call("/api/auth/login", "POST", { email, password: secret });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function main() {
  try {
    const admin = await fixture("ADMIN_SUBASTAS"), buyer = await fixture("COMPRADOR"), auditor = await fixture("AUDITOR");
    const noIdentity = await fixture("VENDEDOR", "PENDIENTE");
    const adminCookie = await login(admin.email), buyerCookie = await login(buyer.email), auditorCookie = await login(auditor.email);
    phase = "registro real con identidad privada";
    const email = `c1-${randomUUID()}@example.test`; emails.push(email);
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "navy" } }).png().toBuffer();
    const form = new FormData();
    for (const [key, value] of Object.entries({ nombreCompleto: "Registro ficticio C1", email, password, cedula: "1234567890", roles: JSON.stringify(["COMPRADOR", "VENDEDOR"]) })) form.set(key, value);
    form.set("identidad", new File([new Uint8Array(image)], "identidad.png", { type: "image/png" }));
    assert.equal((await call("/api/auth/register", "POST", form)).status, 201);
    const registered = await prisma.user.findUniqueOrThrow({ where: { email }, include: { files: true } });
    assert.equal(registered.status, "PENDIENTE"); assert.notEqual(registered.cedulaCifrada, "1234567890");
    assert.equal(registered.files.length, 1); assert.equal(registered.files[0].kind, "IDENTIDAD");
    assert.ok(registered.files[0].storagePath.startsWith(path.join("storage", "private")));
    let cookie = await login(email);
    assert.equal((await call("/api/articles", "POST", {}, cookie)).status, 403);
    await assert.rejects(() => requireActive(new Request(`${origin}/api/chat`, { headers: { Cookie: cookie } })), { status: 403 });
    const fileUrl = `/api/files/${registered.files[0].id}`;
    assert.equal((await call(fileUrl, "GET", undefined, buyerCookie)).status, 403);
    assert.equal((await call(fileUrl, "GET", undefined, cookie)).status, 200);
    assert.equal((await call(fileUrl, "GET", undefined, adminCookie)).status, 200);
    console.log("PASS registro: pendiente, cifrado, documento privado; operaciones pendientes bloqueadas por guard compartido.");
    phase = "autorización y aprobación";
    assert.equal((await call("/api/admin/users")).status, 401);
    for (const credential of [buyerCookie, auditorCookie]) {
      assert.equal((await call("/api/admin/users", "GET", undefined, credential)).status, 403);
      assert.equal((await call(`/api/admin/users/${registered.id}/activate`, "POST", {}, credential)).status, 403);
    }
    assert.equal((await call(`/api/admin/users/${noIdentity.id}/activate`, "POST", {}, adminCookie)).status, 409);
    const listing = await call("/api/admin/users?pageSize=1", "GET", undefined, adminCookie);
    assert.equal(listing.status, 200);
    const listingBody = await listing.text();
    for (const value of ["nombreCompleto", "email", "cedulaCifrada", "storagePath", "passwordHash"]) assert.ok(!listingBody.includes(value));
    const listed = JSON.parse(listingBody).data; assert.equal(listed.items.length, 1); assert.ok(listed.pages > 1);
    assert.equal((await call(`/api/admin/users/${registered.id}/activate`, "POST", {}, adminCookie)).status, 200);
    assert.equal((await call(`/api/admin/users/${registered.id}/activate`, "POST", {}, adminCookie)).status, 409);
    assert.equal((await requireActive(new Request(`${origin}/api/test`, { headers: { Cookie: cookie } }))).status, "ACTIVA");
    assert.equal(await prisma.auditEvent.count({ where: { actorId: admin.id, resourceId: registered.id, action: "CUENTA_ACTIVADA" } }), 1);
    const registrationAudit = await prisma.auditEvent.findFirstOrThrow({ where: { actorId: registered.id, action: "CUENTA_REGISTRADA", result: "EXITO" } });
    assert.deepEqual(registrationAudit.detail, { roles: ["COMPRADOR", "VENDEDOR"], status: "PENDIENTE" });
    console.log("PASS activación: admin exclusivamente, documento requerido, transición única y auditoría persistida.");
    phase = "perfil del titular";
    assert.equal((await call("/api/auth/profile", "PATCH", { telefono: "0990000000", direccion: "Calle ficticia C1" }, cookie)).status, 200);
    assert.equal((await call("/api/auth/profile", "PATCH", { status: "ACTIVA", roles: ["ADMIN_SUBASTAS"] }, cookie)).status, 400);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).telefono, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: registered.id } })).telefono, "0990000000");
    for (const url of ["/perfil", "/admin/usuarios", "/recuperar-clave", "/restablecer-clave"]) {
      const page = await call(url, "GET", undefined, url === "/admin/usuarios" ? adminCookie : cookie);
      assert.equal(page.status, 200);
      const html = await page.text();
      for (const secret of ["passwordHash", "cedulaCifrada", "tokenHash", registered.passwordHash, registered.cedulaCifrada]) assert.ok(!html.includes(secret));
    }
    const deniedPage = await call("/admin/usuarios", "GET", undefined, buyerCookie);
    const deniedHtml = await deniedPage.text();
    assert.ok(deniedHtml.includes("Acceso restringido"));
    assert.ok(!deniedHtml.includes("Cuentas para aprobación"));
    console.log("PASS perfil propio, campos restringidos y páginas C1 renderizadas.");
    phase = "recuperación por token emitido en desarrollo";
    const absent = await call("/api/auth/forgot-password", "POST", { email: `ausente-${randomUUID()}@example.test` });
    const existing = await call("/api/auth/forgot-password", "POST", { email });
    assert.equal(existing.status, 200);
    const genericBody = await existing.json();
    assert.deepEqual(genericBody, await absent.json());
    const httpReset = await prisma.passwordReset.findFirstOrThrow({ where: { userId: registered.id, usedAt: null }, orderBy: { createdAt: "desc" } });
    assert.match(httpReset.tokenHash, /^[a-f\d]{64}$/);
    assert.ok(Math.abs(httpReset.expiresAt.getTime() - Date.now() - 600000) < 10000);
    let link = "";
    const env: Record<string, string | undefined> = process.env;
    const savedLog = console.log, mode = env.NODE_ENV;
    let recovery: Response;
    try {
      env.NODE_ENV = "development";
      console.log = (value: unknown) => { if (typeof value === "string" && value.startsWith("[auth] Recuperación: ")) link = value.slice("[auth] Recuperación: ".length); };
      recovery = await forgot(new Request(`${origin}/api/auth/forgot-password`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email }) }));
    } finally { console.log = savedLog; if (mode === undefined) delete env.NODE_ENV; else env.NODE_ENV = mode; }
    assert.equal(recovery!.status, 200); assert.deepEqual(await recovery!.json(), genericBody);
    const rawToken = new URL(link).searchParams.get("token")!;
    const stored = await prisma.passwordReset.findUniqueOrThrow({ where: { tokenHash: hashToken(rawToken) } });
    assert.ok(Math.abs(stored.expiresAt.getTime() - Date.now() - 600000) < 10000);
    const expired = randomUUID();
    await prisma.passwordReset.create({ data: { userId: registered.id, tokenHash: hashToken(expired), expiresAt: new Date(0) } });
    assert.equal((await call("/api/auth/reset-password", "POST", { token: expired, newPassword })).status, 400);
    await createUserSession(registered.id); // Segunda sesión que también debe revocarse.
    const simultaneous = await Promise.all([1, 2].map(() => call("/api/auth/reset-password", "POST", { token: rawToken, newPassword })));
    assert.deepEqual(simultaneous.map((response) => response.status).sort(), [200, 400]);
    assert.equal(await prisma.session.count({ where: { userId: registered.id } }), 0);
    assert.equal((await call("/api/auth/me", "GET", undefined, cookie)).status, 401);
    assert.equal((await call("/api/auth/reset-password", "POST", { token: rawToken, newPassword })).status, 400);
    assert.notEqual((await prisma.passwordReset.findUniqueOrThrow({ where: { id: httpReset.id } })).usedAt, null);
    assert.equal((await call("/api/auth/login", "POST", { email, password })).status, 401);
    cookie = await login(email, newPassword);
    assert.equal((await call("/api/auth/me", "GET", undefined, cookie)).status, 200);
    assert.equal(bcrypt.getRounds((await prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash), 12);
    console.log("PASS recuperación real: hash, 10 minutos, caducidad, dos consumos concurrentes, no reutilización y revocación de todas las sesiones.");
    const events = await prisma.auditEvent.findMany({ where: { actorId: registered.id, action: "LOGIN", result: "EXITO" } });
    assert.ok(events.length >= 2);
    const audited = await prisma.auditEvent.findMany({ where: { OR: [{ actorId: registered.id }, { resourceType: "User", resourceId: registered.id }] } });
    for (const event of audited) {
      const detail = JSON.stringify(event.detail);
      for (const secret of [email, password, newPassword, rawToken, registered.cedulaCifrada, registered.passwordHash, "1234567890"]) assert.ok(!detail.includes(secret));
    }
    console.log("PASS login auditado sin credenciales ni PII en detalle.");
  } finally {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map(({ id }) => id);
    const files = await prisma.fileRecord.findMany({ where: { ownerId: { in: ids } } });
    for (const file of files) {
      const resolved = path.resolve(file.storagePath);
      assert.equal(path.dirname(resolved), path.resolve("storage/private"));
      await unlink(resolved);
    }
    await prisma.$transaction([
      prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceType: "User", resourceId: { in: ids } }] } }),
      prisma.fileRecord.deleteMany({ where: { ownerId: { in: ids } } }),
      prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } }),
      prisma.session.deleteMany({ where: { userId: { in: ids } } }),
      prisma.userRole.deleteMany({ where: { userId: { in: ids } } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }),
    ]);
    assert.equal(await prisma.user.count({ where: { id: { in: ids } } }), 0);
    assert.equal(await prisma.fileRecord.count({ where: { ownerId: { in: ids } } }), 0);
    assert.equal(await prisma.passwordReset.count({ where: { userId: { in: ids } } }), 0);
    assert.equal(await prisma.session.count({ where: { userId: { in: ids } } }), 0);
    await prisma.$disconnect();
    console.log("PASS limpieza de fixtures y documentos propios.");
  }
}
main().catch(() => { console.error(`FAIL C1 en ${phase}. No se imprimen credenciales.`); process.exitCode = 1; });
