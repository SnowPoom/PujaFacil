import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, session: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() } }));
vi.mock("../lib/prisma", () => ({ prisma: db }));
import { encryptCedula, decryptCedula } from "../lib/auth/crypto";
import { loginSchema, registerSchema, passwordSchema } from "../lib/auth/schemas";
import { createUserSession, deleteSessionFromRawToken, getUserFromCookieHeader, hashToken, sessionCookie } from "../lib/auth/session";
import { assertTrustedOrigin, canAccessResource, requireActive, requireRole, requireSession } from "../lib/auth/guards";
import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { GET as me } from "../app/api/auth/me/route";

const token = "a".repeat(64);
const user = { id: "ficticio", nombreCompleto: "Cuenta Ficticia", email: "demo@example.test", status: "ACTIVA" as const, roles: [{ role: "COMPRADOR" as const }] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENCRYPTION_KEY_HEX", "ab".repeat(32));
  db.session.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user });
});

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
    db.session.create.mockResolvedValue({});
    const start = Date.now();
    const result = await createUserSession(user.id);
    expect(result.rawToken).toMatch(/^[a-f\d]{64}$/);
    expect(db.session.create).toHaveBeenCalledWith({ data: { userId: user.id, tokenHash: hashToken(result.rawToken), expiresAt: result.expiresAt } });
    expect(result.expiresAt.getTime() - start).toBeGreaterThanOrEqual(604_800_000);
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
});
