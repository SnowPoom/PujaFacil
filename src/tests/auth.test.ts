import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, session: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() } }));
vi.mock("../lib/prisma", () => ({ prisma: db }));
const requestCookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: requestCookies }));
import { encryptCedula, decryptCedula } from "../lib/auth/crypto";
import { loginSchema, registerSchema, passwordSchema, forgotSchema } from "../lib/auth/schemas";
import { createUserSession, deleteSessionFromRawToken, getUserFromCookieHeader, hashToken, sessionCookie } from "../lib/auth/session";
import { assertTrustedOrigin, canAccessResource, hasRole, requireActive, requireRole, requireSession } from "../lib/auth/guards";
import { hasValidRoles } from "../lib/auth/roles";
import type { Role } from "@prisma/client";
import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { GET as me } from "../app/api/auth/me/route";
import { getCurrentUser, requireCurrentUser } from "../lib/auth/server";

const token = "a".repeat(64);
const user = { id: "ficticio", nombreCompleto: "Cuenta Ficticia", email: "demo@example.test", status: "ACTIVA" as const, roles: [{ role: "COMPRADOR" as const }] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENCRYPTION_KEY_HEX", "ab".repeat(32));
  db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user });
  db.user.findUnique.mockResolvedValue(user);
  requestCookies.mockResolvedValue({ toString: () => "" });
});
afterEach(() => vi.useRealTimers());

describe("Christian C0 — contrato HTTP con DB simulada", () => {
  const password = "Mi frase ficticia segura 2026!";
  const makeLogin = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  it("login devuelve cookie y solo perfil mínimo, incluso para cuenta pendiente", async () => {
    const hash = await bcrypt.hash(password, 4);
    db.user.findUnique.mockResolvedValue({ ...user, status: "PENDIENTE", passwordHash: hash });
    const response = await login(makeLogin({ email: "Demo@Example.test", password }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    const payload = await response.json();
    expect(Object.keys(payload.data.user).sort()).toEqual(["email", "id", "nombreCompleto", "roles", "status"]);
    expect(payload.data.user.status).toBe("PENDIENTE");
    expect(db.user.findUnique.mock.calls[0][0].where.email).toBe("demo@example.test");
    expect(db.session.create).toHaveBeenCalledOnce();
  });
  it("no revela si el correo existe y no crea sesiones con contraseña incorrecta", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const absent = await login(makeLogin({ email: user.email, password }));
    db.user.findUnique.mockResolvedValue({ ...user, passwordHash: await bcrypt.hash("otra", 4) });
    const wrong = await login(makeLogin({ email: user.email, password }));
    expect(absent.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await absent.json()).toEqual(await wrong.json());
    expect(db.session.create).not.toHaveBeenCalled();
  });
  it("bloquea login de cuenta suspendida y solicitudes de otro origen", async () => {
    db.user.findUnique.mockResolvedValue({ ...user, status: "SUSPENDIDA", passwordHash: await bcrypt.hash(password, 4) });
    expect((await login(makeLogin({ email: user.email, password }))).status).toBe(403);
    db.user.findUnique.mockClear();
    expect((await login(makeLogin({ email: user.email, password }, "https://otro.test"))).status).toBe(403);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
  it("rechaza JSON inválido con formato de error común", async () => {
    const request = new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { origin: "http://localhost:3000" }, body: "{" });
    const response = await login(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "DATOS_INVALIDOS" } });
  });
  it("me exige sesión, devuelve perfil mínimo y evita caché", async () => {
    expect((await me(new Request("http://localhost:3000/api/auth/me"))).status).toBe(401);
    const response = await me(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, data: { user: { ...user, roles: ["COMPRADOR"] } } });
  });
  it("logout elimina sesión y expira cookie, y admite repetición", async () => {
    const req = new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { origin: "http://localhost:3000", cookie: `pf_session=${token}` } });
    const response = await logout(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: hashToken(token) } });
    expect((await logout(new Request(req.url, { method: "POST", headers: { origin: "http://localhost:3000" } }))).status).toBe(200);
  });
});
const request = () => new Request("http://localhost:3000/api/test", { headers: { cookie: `pf_session=${token}` } });

describe("Christian C0 — autenticación", () => {
  it("verifica bcrypt con sal y rechaza otra contraseña", async () => {
    const password = "Mi frase ficticia segura 2026!";
    const hash = await bcrypt.hash(password, 12);
    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare("otra", hash)).toBe(false);
  });
  it("cifra con IV diferente y detecta manipulación", () => {
    const encrypted = encryptCedula("1234567890");
    expect(encrypted).not.toContain("1234567890");
    expect(encryptCedula("1234567890")).not.toBe(encrypted);
    expect(decryptCedula(encrypted)).toBe("1234567890");
    const [iv, data, tag] = encrypted.split(":");
    expect(() => decryptCedula(`${iv}:${data}:${tag[0] === "0" ? "1" : "0"}${tag.slice(1)}`)).toThrow();
  });
  it("valida registro, normaliza email y evita roles privilegiados", () => {
    const input = { nombreCompleto: "Cuenta Ficticia", email: "Demo@Example.test", password: "Mi frase ficticia segura 2026!", cedula: "1234567890", roles: ["COMPRADOR"] };
    expect(registerSchema.parse(input).email).toBe("demo@example.test");
    expect(registerSchema.safeParse({ ...input, roles: ["ADMIN_SUBASTAS"] }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, cedula: "123" }).success).toBe(false);
    expect(passwordSchema.safeParse("password123456789").success).toBe(false);
    expect(loginSchema.safeParse({ email: input.email, password: "" }).success).toBe(false);
  });
  it("guarda solo hash SHA-256 y caduca en siete días", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T17:00:00Z"));
    db.session.create.mockResolvedValue({});
    const start = Date.now();
    const result = await createUserSession(user.id);
    expect(result.rawToken).toMatch(/^[a-f\d]{64}$/);
    const expectedHash = createHash("sha256").update(result.rawToken).digest("hex");
    expect(db.session.create).toHaveBeenCalledWith({ data: { userId: user.id, tokenHash: expectedHash, expiresAt: result.expiresAt } });
    expect(expectedHash).not.toBe(result.rawToken);
    expect(result.expiresAt.getTime() - start).toBe(604_800_000);
    expect(sessionCookie(result.rawToken, result.expiresAt)).toContain(`Expires=${result.expiresAt.toUTCString()}`);
  });
  it("no consulta DB sin cookie y rechaza sesiones vencidas", async () => {
    expect(await getUserFromCookieHeader()).toBeNull();
    expect(db.session.findUnique).not.toHaveBeenCalled();
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(0), user });
    expect(await getUserFromCookieHeader(`pf_session=${token}`)).toBeNull();
    await expect(requireSession(new Request("http://localhost:3000"))).rejects.toMatchObject({ status: 401 });
  });
  it("proyecta datos mínimos y rechaza cuentas suspendidas/cerradas", async () => {
    expect(await getUserFromCookieHeader(`pf_session=${token}`)).toEqual({ ...user, roles: ["COMPRADOR"] });
    for (const status of ["SUSPENDIDA", "CERRADA"]) {
      db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: { ...user, status } });
      expect(await getUserFromCookieHeader(`pf_session=${token}`)).toBeNull();
    }
  });
  it("permite sesión pendiente pero prohíbe operaciones y roles ajenos", async () => {
    await expect(requireRole(request(), ["ADMIN_SUBASTAS"])).rejects.toMatchObject({ status: 403 });
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: { ...user, status: "PENDIENTE" } });
    expect((await requireSession(request())).status).toBe("PENDIENTE");
    await expect(requireActive(request())).rejects.toMatchObject({ status: 403 });
    expect(canAccessResource(null, user.id)).toBe(false);
    expect(canAccessResource({ ...user, roles: ["ADMIN_SUBASTAS"] }, "otro")).toBe(false);
  });
  it("rechaza CSRF con origen ausente o diferente", () => {
    const make = (origin?: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: origin ? { origin } : {} });
    expect(() => assertTrustedOrigin(make())).toThrow();
    expect(() => assertTrustedOrigin(make("https://otro.test"))).toThrow();
    expect(() => assertTrustedOrigin(make("http://localhost:3000"))).not.toThrow();
  });
  it("configura cookie segura y revoca sesión por hash", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = sessionCookie(token, new Date(Date.now() + 60_000));
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(flag);
    await deleteSessionFromRawToken(token);
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: hashToken(token) } });
  });
  it("rechaza una sesión revocada y la cookie malformada sin consultar otra sesión", async () => {
    db.session.findUnique.mockResolvedValue(null);
    expect(await getUserFromCookieHeader(`pf_session=${token}`)).toBeNull();
    await expect(requireSession(request())).rejects.toMatchObject({ status: 401 });
    db.session.findUnique.mockClear();
    expect(await getUserFromCookieHeader("pf_session=token-invalido")).toBeNull();
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });
  it("rechaza al llegar exactamente a expiresAt y acepta antes del límite", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const expiresAt = new Date("2026-11-14T17:00:00Z");
    db.session.findUnique.mockResolvedValue({ expiresAt, user });
    vi.setSystemTime(expiresAt.getTime() - 1);
    expect(await getUserFromCookieHeader(`pf_session=${token}`)).not.toBeNull();
    vi.setSystemTime(expiresAt);
    await expect(requireSession(request())).rejects.toMatchObject({ status: 401 });
    expect((await me(request())).status).toBe(401);
  });
  it("vuelve a consultar estado y roles, sin conservar privilegios de la sesión anterior", async () => {
    expect((await requireRole(request(), ["COMPRADOR"])).id).toBe(user.id);
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: { ...user, roles: [{ role: "VENDEDOR" }] } });
    await expect(requireRole(request(), ["COMPRADOR"])).rejects.toMatchObject({ status: 403 });
    expect((await requireRole(request(), ["VENDEDOR", "ADMIN_SUBASTAS"])).id).toBe(user.id);
    await expect(requireRole(request(), [])).rejects.toMatchObject({ status: 403 });
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: { ...user, status: "SUSPENDIDA" } });
    await expect(requireSession(request())).rejects.toMatchObject({ status: 401 });
  });
  it("rechaza auditor combinado con roles comerciales en sesión, roles y propiedad", async () => {
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: { ...user, roles: [{ role: "AUDITOR" }, { role: "COMPRADOR" }] } });
    await expect(requireRole(request(), ["COMPRADOR"])).rejects.toMatchObject({ status: 401 });
    await expect(requireRole(request(), ["AUDITOR"])).rejects.toMatchObject({ status: 401 });
    expect(hasRole({ ...user, roles: ["AUDITOR", "COMPRADOR"] }, "AUDITOR")).toBe(false);
    expect(canAccessResource({ ...user, roles: ["AUDITOR", "COMPRADOR"] }, user.id)).toBe(false);
    expect(canAccessResource({ ...user, roles: ["AUDITOR"] }, user.id)).toBe(true);
  });
  it("rechaza Origin null y cross-site aun si Origin coincide, sin confiar en forwarded headers", () => {
    const cases: Record<string, string>[] = [
      { origin: "null" },
      { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
      { origin: "https://otro.test", "x-forwarded-host": "otro.test", "x-forwarded-proto": "https" },
    ];
    for (const headers of cases) {
      expect(() => assertTrustedOrigin(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers }))).toThrow();
    }
  });
  it("no marca Secure en desarrollo y rechaza claves o ciphertext inválidos", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookie(token, new Date())).not.toContain("Secure");
    expect(() => decryptCedula("invalido")).toThrow();
    vi.stubEnv("ENCRYPTION_KEY_HEX", "clave-invalida");
    expect(() => encryptCedula("1234567890")).toThrow();
  });
});

const allRoles: Role[] = ["COMPRADOR", "VENDEDOR", "VERIFICADOR", "ADMIN_SUBASTAS", "AUDITOR"];
const permittedSets = new Set(["COMPRADOR", "VENDEDOR", "COMPRADOR,VENDEDOR", "VERIFICADOR", "ADMIN_SUBASTAS", "AUDITOR"]);
const roleCases = Array.from({ length: 32 }, (_, mask) => {
  const roles = allRoles.filter((_, index) => mask & (1 << index));
  return { roles, permitted: permittedSets.has([...roles].sort().join(",")) };
});

describe("Christian C0 — exclusividad de roles 1B", () => {
  it.each(roleCases)("valida el conjunto $roles (permitido: $permitted)", async ({ roles, permitted }) => {
    expect(hasValidRoles(roles)).toBe(permitted);
    const account = { ...user, roles: roles.map((role) => ({ role })) };
    db.user.findUnique.mockResolvedValue(account);
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: account });
    if (permitted) {
      expect((await requireSession(request())).roles).toEqual(roles);
      for (const role of roles) expect((await requireRole(request(), [role])).id).toBe(user.id);
      await createUserSession(user.id);
      expect(db.session.create).toHaveBeenCalledOnce();
    } else {
      expect(await getUserFromCookieHeader(`pf_session=${token}`)).toBeNull();
      await expect(requireSession(request())).rejects.toMatchObject({ status: 401 });
      await expect(requireActive(request())).rejects.toMatchObject({ status: 401 });
      await expect(requireRole(request(), allRoles)).rejects.toMatchObject({ status: 401 });
      await expect(createUserSession(user.id)).rejects.toThrow("roles inválidos");
      expect(db.session.create).not.toHaveBeenCalled();
    }
  });
  it("rechaza también roles repetidos y desconocidos", () => {
    expect(hasValidRoles(["COMPRADOR", "COMPRADOR"])).toBe(false);
    expect(hasValidRoles(["DESCONOCIDO" as Role])).toBe(false);
  });
  it("login no emite cookie ni crea sesión con perfiles incompatibles", async () => {
    const password = "Mi frase ficticia segura 2026!";
    db.user.findUnique.mockResolvedValue({ ...user, passwordHash: await bcrypt.hash(password, 4), roles: [{ role: "ADMIN_SUBASTAS" }, { role: "VENDEDOR" }] });
    const response = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify({ email: user.email, password }) }));
    expect(response.status).toBe(403);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "ROLES_INVALIDOS" } });
    expect(db.session.create).not.toHaveBeenCalled();
  });
  it("invalida el acceso de una sesión existente al asignar un rol incompatible", async () => {
    expect((await requireRole(request(), ["COMPRADOR"])).id).toBe(user.id);
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: { ...user, roles: [{ role: "COMPRADOR" }, { role: "VERIFICADOR" }] } });
    expect((await me(request())).status).toBe(401);
    await expect(requireRole(request(), ["VERIFICADOR"])).rejects.toMatchObject({ status: 401 });
  });
});

describe("Christian C0 — normalización y contraseñas", () => {
  it("normaliza espacios y mayúsculas antes de validar email en los esquemas existentes", () => {
    const email = "  Demo@Example.test  ";
    expect(loginSchema.parse({ email, password: "clave-existente" }).email).toBe("demo@example.test");
    expect(forgotSchema.parse({ email }).email).toBe("demo@example.test");
    expect(registerSchema.parse({ nombreCompleto: "Cuenta Ficticia", email, password: "Mi frase ficticia segura 2026!", cedula: "1234567890", roles: ["COMPRADOR", "VENDEDOR"] }).email).toBe("demo@example.test");
    expect(loginSchema.safeParse({ email: "demo @example.test", password: "clave" }).success).toBe(false);
  });
  it("login usa el correo normalizado sin modificar la contraseña existente", async () => {
    const password = " Clave existente de prueba ";
    db.user.findUnique.mockResolvedValue({ ...user, passwordHash: await bcrypt.hash(password, 4) });
    const response = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify({ email: "  Demo@Example.test  ", password }) }));
    expect(response.status).toBe(200);
    expect(db.user.findUnique.mock.calls[0][0].where).toEqual({ email: "demo@example.test" });
  });
  it.each(["a".repeat(20), "Ab".repeat(10), "1234".repeat(5), "98765432109876543210", "P a s s w o r d 2026!", "Administrador2026!", "adminadminadmin", "--------------------", "QwertyQwertyQwerty"])('rechaza una clave común o patrón débil: %s', (password) => {
    expect(passwordSchema.safeParse(password).success).toBe(false);
  });
  it("conserva longitud 15–64 y acepta frases sin exigir combinaciones de caracteres", () => {
    const minimum = "v7Mx2Rq9Hs4Lp8N";
    const maximum = "Una frase con palabras distintas que puedo recordar".padEnd(64, "x");
    expect(passwordSchema.parse(minimum)).toBe(minimum);
    expect(passwordSchema.parse(maximum)).toBe(maximum);
    expect(passwordSchema.parse("una frase larga con palabras variadas")).toBe("una frase larga con palabras variadas");
    expect(passwordSchema.safeParse(minimum.slice(1)).success).toBe(false);
    expect(passwordSchema.safeParse(maximum + "x").success).toBe(false);
  });
});

describe("Christian C0 — sesión SSR usada por /panel", () => {
  it("redirige a iniciar-sesion sin cookie válida", async () => {
    expect(await getCurrentUser()).toBeNull();
    await expect(requireCurrentUser()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/iniciar-sesion;307;" });
  });
  it("permite SSR pendiente y redirige si la sesión ya está revocada", async () => {
    requestCookies.mockResolvedValue({ toString: () => `pf_session=${token}` });
    db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: { ...user, status: "PENDIENTE" } });
    expect((await requireCurrentUser()).status).toBe("PENDIENTE");
    db.session.findUnique.mockResolvedValue(null);
    await expect(requireCurrentUser()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/iniciar-sesion;307;" });
  });
});

describe("Christian C0 — privacidad de respuestas HTTP", () => {
  it("no incluye token ni credenciales en JSON de login/me y limita el select del usuario", async () => {
    const password = "Mi frase ficticia segura 2026!";
    db.user.findUnique.mockResolvedValue({ ...user, passwordHash: await bcrypt.hash(password, 4) });
    const response = await login(new Request("http://localhost:3000/api/auth/login", {
      method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify({ email: user.email, password }),
    }));
    const rawToken = response.headers.get("set-cookie")!.split(";")[0].split("=")[1];
    for (const body of [await response.text(), await (await me(request())).text()]) {
      for (const secret of [password, rawToken, "passwordHash", "cedulaCifrada", "tokenHash", "telefono", "direccion"]) expect(body).not.toContain(secret);
    }
    expect(db.session.findUnique.mock.calls[0][0].select.user.select).toEqual({
      id: true, nombreCompleto: true, email: true, status: true, roles: { select: { role: true } },
    });
  });
  it("no devuelve ni registra el detalle confidencial de un error de DB", async () => {
    const secret = "dato-confidencial-ficticio";
    db.session.findUnique.mockRejectedValue(new Error(secret));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await me(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(secret);
    expect(logger).toHaveBeenCalledWith("[auth] No se pudo completar la operación.");
  });
});
