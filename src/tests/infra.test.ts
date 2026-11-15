import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import sharp from "sharp";
import { FileKind, type Role } from "@prisma/client";

const db = vi.hoisted(() => ({
  fileRecord: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  article: { findFirst: vi.fn() }, review: { findFirst: vi.fn() },
  auditEvent: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  session: { findUnique: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn(),
}));
const disk = vi.hoisted(() => ({ mkdir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("node:fs/promises", () => disk);

import { deleteFilesForDraft, readAuthorizedFile, saveValidatedUpload, validateUpload } from "@/lib/uploads";
import { listAuditEvents, writeAuditEvent } from "@/lib/audit";
import { POST as upload } from "@/app/api/files/route";
import { GET as download } from "@/app/api/files/[id]/route";
import { GET as audit } from "@/app/api/audit/route";

const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const token = "a".repeat(64);
const cookie = `pf_session=${token}`;
const user = { id: "titular", nombreCompleto: "Persona Ficticia", email: "demo@example.test", status: "ACTIVA", roles: [{ role: "VENDEDOR" }] };
const event = { id: "evento", action: "ARCHIVO_CREADO", resourceType: "FileRecord", resourceId: "archivo", result: "EXITO", detail: {}, createdAt: new Date("2026-11-15T17:00:00Z") };
const record = { id: "archivo", ownerId: "titular", articleId: "articulo", kind: FileKind.FOTO, mimeType: "image/png", originalName: "nombre-privado.png", storagePath: path.join("storage", "private", "ficticio"), size: 100, createdAt: event.createdAt, article: { status: "BORRADOR" } };
const png = () => sharp({ create: { width: 4, height: 4, channels: 3, background: "navy" } }).png().toBuffer();
const imageFile = async (name = "foto.png", type = "image/png") => new File([new Uint8Array(await png())], name, { type });
const fileRequest = (form: FormData, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/files", { method: "POST", headers: { origin: "http://localhost:3000", cookie, ...headers }, body: form });
const makeForm = (file: File, kind = "FOTO", articleId?: string) => {
  const form = new FormData(); form.set("file", file); form.set("kind", kind);
  if (articleId) form.set("articleId", articleId);
  return form;
};

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (input) => typeof input === "function" ? input(db) : Promise.all(input));
  db.fileRecord.findUnique.mockResolvedValue(record);
  db.fileRecord.create.mockResolvedValue(record);
  db.article.findFirst.mockResolvedValue({ id: "articulo" });
  db.auditEvent.create.mockResolvedValue(event);
  db.auditEvent.findMany.mockResolvedValue([event]);
  db.auditEvent.count.mockResolvedValue(1);
  db.session.findUnique.mockResolvedValue({ user, expiresAt: new Date(Date.now() + 60_000) });
  disk.readFile.mockResolvedValue(Buffer.from("contenido ficticio"));
});

describe("Jonathan J2 — validación real de archivos", () => {
  it.each(["jpeg", "png", "webp"] as const)("acepta %s y elimina EXIF y perfiles", async (format) => {
    const input = await sharp(await png()).withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const mimeType = `image/${format}`;
    const output = await validateUpload(new File([new Uint8Array(input)], `foto.${format}`, { type: mimeType }), FileKind.FOTO);
    expect(output.mimeType).toBe(mimeType);
    const metadata = await sharp(output.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });
  it.each([FileKind.CERTIFICADO, FileKind.IDENTIDAD])("acepta PDF para %s con firma real", async (kind) => {
    const output = await validateUpload(new File([new Uint8Array(pdf)], "documento.pdf", { type: "application/pdf" }), kind);
    expect(output).toEqual({ buffer: pdf, mimeType: "application/pdf" });
  });
  it("acepta identidad en imagen y tipo MIME omitido si el contenido coincide", async () => {
    expect((await validateUpload(await imageFile("foto.png", ""), FileKind.IDENTIDAD)).mimeType).toBe("image/png");
  });
  it("rechaza ejecutable camuflado, PDF falso e imagen dañada", async () => {
    const exe = Buffer.alloc(256); exe.write("MZ");
    await expect(validateUpload(new File([exe], "foto.png", { type: "image/png" }), FileKind.FOTO)).rejects.toMatchObject({ status: 400 });
    await expect(validateUpload(new File(["documento falso"], "documento.pdf", { type: "application/pdf" }), FileKind.CERTIFICADO)).rejects.toMatchObject({ status: 400 });
    const broken = (await png()).subarray(0, 40);
    await expect(validateUpload(new File([new Uint8Array(broken)], "foto.png", { type: "image/png" }), FileKind.FOTO)).rejects.toMatchObject({ status: 400 });
  });
  it.each(["foto.exe.png", "foto.png.exe", "../foto.png", "foto.png\r\nx-test:1"])("rechaza nombre inseguro %s", async (name) => {
    await expect(validateUpload(await imageFile(name), FileKind.FOTO)).rejects.toMatchObject({ status: 400 });
  });
  it("rechaza extensión, MIME o categoría que no coinciden", async () => {
    await expect(validateUpload(await imageFile("foto.jpg"), FileKind.FOTO)).rejects.toMatchObject({ status: 400 });
    await expect(validateUpload(await imageFile("foto.png", "image/jpeg"), FileKind.FOTO)).rejects.toMatchObject({ status: 400 });
    await expect(validateUpload(await imageFile(), FileKind.CERTIFICADO)).rejects.toMatchObject({ status: 400 });
    await expect(validateUpload(new File([new Uint8Array(pdf)], "foto.pdf"), FileKind.FOTO)).rejects.toMatchObject({ status: 400 });
  });
  it.each([FileKind.FOTO, FileKind.CERTIFICADO, FileKind.IDENTIDAD])("rechaza vacíos para %s", async (kind) => {
    await expect(validateUpload(new File([], "vacio.png"), kind)).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    [FileKind.FOTO, "image/png", "foto.png", 10],
    [FileKind.IDENTIDAD, "image/png", "foto.png", 10],
    [FileKind.IDENTIDAD, "application/pdf", "documento.pdf", 20],
    [FileKind.CERTIFICADO, "application/pdf", "documento.pdf", 20],
  ] as const)("rechaza exceso de tamaño %s %s", async (kind, type, name, max) => {
    const bytes = Buffer.alloc(max * 1024 * 1024 + 1);
    (type === "application/pdf" ? pdf : await png()).copy(bytes);
    await expect(validateUpload(new File([bytes], name, { type }), kind)).rejects.toMatchObject({ status: 413 });
  });
});

describe("Jonathan J2 — permisos de lectura", () => {
  const cases: { kind: FileKind; status?: string; requesterId?: string; roles?: Role[]; assigned?: boolean; allowed: boolean }[] = [];
  for (const kind of Object.values(FileKind)) {
    cases.push({ kind, requesterId: "titular", allowed: true });
    cases.push({ kind, requesterId: "admin", roles: ["ADMIN_SUBASTAS"], allowed: true });
    cases.push({ kind, requesterId: "auditor", roles: ["AUDITOR"], allowed: false });
    cases.push({ kind, requesterId: "ajeno", roles: ["COMPRADOR"], allowed: false });
    cases.push({ kind, requesterId: "verificador", roles: ["VERIFICADOR"], assigned: true, allowed: kind !== FileKind.IDENTIDAD });
    cases.push({ kind, requesterId: "verificador", roles: ["VERIFICADOR"], assigned: false, allowed: false });
    cases.push({ kind, roles: ["ADMIN_SUBASTAS"], allowed: false });
    for (const status of ["BORRADOR", "PENDIENTE_REVISION", "REQUIERE_CORRECCIONES", "RECHAZADO", "APROBADO", "ASOCIADO_SUBASTA", "ARCHIVADO"]) {
      cases.push({ kind, status, allowed: kind === FileKind.FOTO && ["APROBADO", "ASOCIADO_SUBASTA"].includes(status) });
    }
  }
  it.each(cases)("$kind, estado $status, solicitante $requesterId: acceso $allowed", async ({ kind, status, requesterId, roles, assigned, allowed }) => {
    db.fileRecord.findUnique.mockResolvedValue({ ...record, kind, article: { status: status ?? "BORRADOR" } });
    db.review.findFirst.mockResolvedValue(assigned ? { id: "revision" } : null);
    const read = readAuthorizedFile({ fileId: "archivo", requesterId, roles });
    if (allowed) {
      expect(await read).toEqual({ buffer: Buffer.from("contenido ficticio"), mimeType: "image/png", originalName: "archivo.png" });
      expect(disk.readFile).toHaveBeenCalledOnce();
    } else {
      await expect(read).rejects.toMatchObject({ status: 403 });
      expect(disk.readFile).not.toHaveBeenCalled();
    }
    if (assigned && kind !== FileKind.IDENTIDAD) expect(db.review.findFirst).toHaveBeenCalledWith({ where: { articleId: "articulo", verifierId: "verificador" }, select: { id: true } });
  });
  it("no publica fotos sin artículo y no lee rutas fuera del almacenamiento privado", async () => {
    db.fileRecord.findUnique.mockResolvedValue({ ...record, article: null, articleId: null });
    await expect(readAuthorizedFile({ fileId: "archivo" })).rejects.toMatchObject({ status: 403 });
    db.fileRecord.findUnique.mockResolvedValue({ ...record, storagePath: ".env" });
    await expect(readAuthorizedFile({ fileId: "archivo", requesterId: "titular" })).rejects.toMatchObject({ status: 404 });
    expect(disk.readFile).not.toHaveBeenCalled();
  });
  it("devuelve error controlado si falta el registro o el binario", async () => {
    db.fileRecord.findUnique.mockResolvedValueOnce(null);
    await expect(readAuthorizedFile({ fileId: "ausente" })).rejects.toMatchObject({ status: 404 });
    disk.readFile.mockRejectedValue(new Error("ruta privada"));
    await expect(readAuthorizedFile({ fileId: "archivo", requesterId: "titular" })).rejects.toMatchObject({ status: 404, message: "El archivo no está disponible." });
  });
});

describe("Jonathan J2 — almacenamiento y borrado", () => {
  it("guarda con UUID privado, nombre neutro y auditoría transaccional", async () => {
    await saveValidatedUpload(await imageFile("cedula-ficticia.png"), { ownerId: "titular", articleId: "articulo", kind: FileKind.FOTO });
    const data = db.fileRecord.create.mock.calls[0][0].data;
    expect(data.storagePath).toMatch(/storage[\\/]private[\\/][a-f0-9-]{36}$/);
    expect(data.originalName).toBe("archivo.png");
    expect(data.size).toBe(disk.writeFile.mock.calls[0][1].length);
    expect(disk.writeFile.mock.calls[0][2]).toEqual({ flag: "wx", mode: 0o600 });
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ARCHIVO_CREADO", actorId: "titular" }) }));
  });
  it.each(["registro", "auditoria"])("elimina binario si falla %s", async (failure) => {
    (failure === "registro" ? db.fileRecord.create : db.auditEvent.create).mockRejectedValue(new Error("dato privado"));
    await expect(saveValidatedUpload(await imageFile(), { ownerId: "titular", kind: FileKind.FOTO })).rejects.toMatchObject({ code: "ARCHIVO_NO_GUARDADO" });
    expect(disk.unlink).toHaveBeenCalledWith(disk.writeFile.mock.calls[0][0]);
  });
  it("no crea registro si falla el disco ni guarda archivos en artículos ajenos", async () => {
    disk.writeFile.mockRejectedValueOnce(new Error("disco lleno"));
    await expect(saveValidatedUpload(await imageFile(), { ownerId: "titular", kind: FileKind.FOTO })).rejects.toThrow();
    expect(db.fileRecord.create).not.toHaveBeenCalled();
    expect(disk.unlink).toHaveBeenCalledWith(disk.writeFile.mock.calls[0][0]);
    disk.writeFile.mockClear();
    db.article.findFirst.mockResolvedValue(null);
    await expect(saveValidatedUpload(await imageFile(), { ownerId: "titular", articleId: "ajeno", kind: FileKind.FOTO })).rejects.toMatchObject({ status: 403 });
    expect(disk.writeFile).not.toHaveBeenCalled();
  });
  it("no elimina un archivo preexistente ante una colisión del nombre aleatorio", async () => {
    disk.writeFile.mockRejectedValue(Object.assign(new Error(), { code: "EEXIST" }));
    await expect(saveValidatedUpload(await imageFile(), { ownerId: "titular", kind: FileKind.FOTO })).rejects.toMatchObject({ code: "ARCHIVO_NO_GUARDADO" });
    expect(disk.unlink).not.toHaveBeenCalled();
    expect(db.fileRecord.create).not.toHaveBeenCalled();
  });
  it("borra archivos del borrador después de bloquear y validar titular, revisiones y subastas", async () => {
    db.fileRecord.findMany.mockResolvedValue([record]);
    db.fileRecord.deleteMany.mockResolvedValue({ count: 1 });
    expect(await deleteFilesForDraft("articulo", "titular")).toBe(1);
    expect(db.$queryRaw).toHaveBeenCalledOnce();
    expect(db.article.findFirst).toHaveBeenCalledWith({ where: { id: "articulo", ownerId: "titular", status: "BORRADOR", reviews: { none: {} }, auctions: { none: {} } }, select: { id: true } });
    expect(disk.unlink).toHaveBeenCalledWith(path.resolve(record.storagePath));
    expect(db.fileRecord.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [record.id] }, articleId: "articulo" } });
  });
  it("no borra si el borrador no cumple las condiciones", async () => {
    db.article.findFirst.mockResolvedValue(null);
    await expect(deleteFilesForDraft("articulo", "ajeno")).rejects.toMatchObject({ status: 409 });
    expect(disk.unlink).not.toHaveBeenCalled();
    expect(db.fileRecord.deleteMany).not.toHaveBeenCalled();
  });
  it("permite reintentar binarios ausentes y conserva registros ante errores reales del disco", async () => {
    db.fileRecord.findMany.mockResolvedValue([record]);
    db.fileRecord.deleteMany.mockResolvedValue({ count: 1 });
    disk.unlink.mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" }));
    expect(await deleteFilesForDraft("articulo", "titular")).toBe(1);
    db.fileRecord.deleteMany.mockClear();
    disk.unlink.mockRejectedValueOnce(Object.assign(new Error(), { code: "EACCES" }));
    await expect(deleteFilesForDraft("articulo", "titular")).rejects.toThrow();
    expect(db.fileRecord.deleteMany).not.toHaveBeenCalled();
  });
});

describe("Jonathan J2 — auditoría y privacidad", () => {
  it("elimina campos sensibles recursivamente, normaliza claves y oculta texto libre", async () => {
    const detail = { password: "privado", email: "demo@example.test", cedula: "1234567890", cedulaCifrada: "cifrado", accessToken: "privado", Cookie: "privado", api_secret: "privado", nombreCompleto: "Persona", teléfono: "123", originalName: "cedula.pdf", count: 2, status: "ACTIVA", enabled: true, nested: { cookies: "privado", result: "EXITO", arbitrary: "demo@example.test" }, items: [{ contraseña: "privado", status: "BORRADOR" }] };
    await writeAuditEvent({ actorId: "titular", action: "CUENTA_ACTIVADA", resourceType: "User", resourceId: "cuenta", result: "EXITO", detail });
    expect(db.auditEvent.create.mock.calls[0][0].data.detail).toEqual({ count: 2, status: "ACTIVA", enabled: true, nested: { result: "EXITO", arbitrary: "[REDACTADO]" }, items: [{ status: "BORRADOR" }] });
    expect(detail.password).toBe("privado");
  });
  it("corta ciclos y no revela datos Prisma cuando falla la inserción", async () => {
    const detail: Record<string, unknown> = {}; detail.loop = detail;
    await writeAuditEvent({ action: "PRUEBA", resourceType: "System", result: "EXITO", detail });
    expect(JSON.stringify(db.auditEvent.create.mock.calls[0][0].data.detail).length).toBeLessThan(500);
    db.auditEvent.create.mockRejectedValue(new Error("password=privado"));
    await expect(writeAuditEvent({ action: "PRUEBA", resourceType: "System", result: "ERROR" })).rejects.toMatchObject({ name: "AuditError", message: "No se pudo registrar el evento de auditoría." });
  });
  it("pagina con filtro, orden estable y sin consultar relaciones de usuarios", async () => {
    db.auditEvent.findMany.mockResolvedValue([{ ...event, detail: { email: "legado@example.test", text: "Persona Ficticia" } }]);
    db.auditEvent.count.mockResolvedValue(41);
    const data = await listAuditEvents({ page: 2, pageSize: 20, action: "ARCHIVO_CREADO" });
    expect(data).toMatchObject({ page: 2, pageSize: 20, total: 41, pages: 3, items: [{ detail: { text: "[REDACTADO]" } }] });
    const query = db.auditEvent.findMany.mock.calls[0][0];
    expect(query).toMatchObject({ skip: 20, take: 20, where: { action: "ARCHIVO_CREADO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(query.select).not.toHaveProperty("actor");
    expect(query.select).not.toHaveProperty("actorId");
  });
});

describe("Jonathan J2 — contratos HTTP", () => {
  it("POST devuelve solo metadatos autorizados y exige sesión activa y mismo origen", async () => {
    const response = await upload(fileRequest(makeForm(await imageFile(), "FOTO", "articulo")));
    expect(response.status).toBe(201);
    expect(Object.keys((await response.json()).data).sort()).toEqual(["createdAt", "id", "kind", "originalName", "size"]);
    expect((await upload(fileRequest(makeForm(await imageFile()), { origin: "https://otro.test" }))).status).toBe(403);
    expect((await upload(fileRequest(makeForm(await imageFile()), { cookie: "" }))).status).toBe(401);
    db.session.findUnique.mockResolvedValue({ user: { ...user, status: "PENDIENTE" }, expiresAt: new Date(Date.now() + 60_000) });
    expect((await upload(fileRequest(makeForm(await imageFile())))).status).toBe(403);
  });
  it("POST rechaza formulario incompleto, tipo inválido y artículo ajeno", async () => {
    expect((await upload(fileRequest(new FormData()))).status).toBe(400);
    expect((await upload(fileRequest(makeForm(await imageFile(), "EJECUTABLE")))).status).toBe(400);
    db.article.findFirst.mockResolvedValue(null);
    expect((await upload(fileRequest(makeForm(await imageFile(), "FOTO", "ajeno")))).status).toBe(403);
  });
  it("GET resuelve params asíncronos, transmite bytes y evita caché y nombres personales", async () => {
    const response = await download(new Request("http://localhost:3000/api/files/archivo", { headers: { cookie } }), { params: Promise.resolve({ id: "archivo" }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("contenido ficticio");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="archivo.png"');
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await download(new Request("http://localhost:3000/api/files/archivo"), { params: Promise.resolve({ id: "archivo" }) })).status).toBe(403);
  });
  it("API de auditoría exige AUDITOR activo, valida paginación y no expone identidad", async () => {
    const request = (query = "") => new Request(`http://localhost:3000/api/audit${query}`, { headers: { cookie } });
    expect((await audit(request())).status).toBe(403);
    expect(db.auditEvent.findMany).not.toHaveBeenCalled();
    db.session.findUnique.mockResolvedValue({ user: { ...user, roles: [{ role: "AUDITOR" }] }, expiresAt: new Date(Date.now() + 60_000) });
    for (const query of ["?page=0", "?pageSize=101", "?page=texto", "?page=1.5"]) expect((await audit(request(query))).status).toBe(400);
    const response = await audit(request("?page=1&pageSize=20&action=ARCHIVO_CREADO"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toMatch(/nombreCompleto|actorId|email|cedula|storagePath/);
    expect((await audit(new Request("http://localhost:3000/api/audit"))).status).toBe(401);
  });
});
