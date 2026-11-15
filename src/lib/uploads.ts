import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileKind, type FileRecord, type Role } from "@prisma/client";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/lib/audit";

export class UploadError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "UploadError";
  }
}
const invalid = (message: string) => new UploadError(400, "ARCHIVO_INVALIDO", message);
const megabyte = 1024 * 1024;
const formats: Record<string, { extensions: string[]; extension: string }> = {
  "image/jpeg": { extensions: ["jpg", "jpeg"], extension: "jpg" },
  "image/png": { extensions: ["png"], extension: "png" },
  "image/webp": { extensions: ["webp"], extension: "webp" },
  "application/pdf": { extensions: ["pdf"], extension: "pdf" },
};
function safeName(mimeType: string) {
  return `archivo.${formats[mimeType]?.extension ?? "bin"}`;
}
function privatePath(storagePath: string) {
  const root = path.resolve("storage/private");
  const resolved = path.resolve(storagePath);
  if (path.dirname(resolved) !== root) throw new UploadError(500, "ALMACENAMIENTO_INVALIDO", "No se pudo acceder al archivo.");
  return resolved;
}
async function removePhysicalFile(storagePath: string) {
  try { await unlink(privatePath(storagePath)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export async function validateUpload(file: File, kind: FileKind): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!Object.values(FileKind).includes(kind)) throw invalid("Selecciona un tipo de archivo válido.");
  if (file.size === 0) throw invalid("El archivo está vacío.");
  const name = /^([^./\\\u0000-\u001f\u007f]+)\.([a-z0-9]+)$/i.exec(file.name);
  if (!name || file.name.length > 180) throw invalid("Usa un nombre sin rutas ni dobles extensiones.");
  if (file.size > (kind === FileKind.FOTO ? 10 : 20) * megabyte) {
    throw new UploadError(413, "ARCHIVO_MUY_GRANDE", "El archivo supera el límite permitido (10 MB para imágenes y 20 MB para PDF).");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  let detected;
  try { detected = await fileTypeFromBuffer(buffer); }
  catch { throw invalid("No se pudo reconocer el contenido del archivo."); }
  const format = detected && formats[detected.mime];
  if (!detected || !format || !format.extensions.includes(name[2].toLowerCase()) || (file.type && file.type !== detected.mime)) {
    throw invalid("El contenido, la extensión y el tipo del archivo deben coincidir (JPEG, PNG, WebP o PDF).");
  }
  const isPdf = detected.mime === "application/pdf";
  if ((kind === FileKind.FOTO && isPdf) || (kind === FileKind.CERTIFICADO && !isPdf)) {
    throw invalid("Las fotos deben ser imágenes y los certificados deben ser PDF.");
  }
  const limit = (isPdf ? 20 : 10) * megabyte;
  if (buffer.length > limit) throw new UploadError(413, "ARCHIVO_MUY_GRANDE", `El archivo supera el límite de ${isPdf ? 20 : 10} MB.`);
  if (isPdf) {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw invalid("La cabecera del PDF no es válida.");
    return { buffer, mimeType: detected.mime };
  }
  try {
    // Sharp recodifica sin conservar EXIF, XMP ni otros metadatos por defecto.
    const sanitized = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().toBuffer();
    if (sanitized.length > limit) throw new UploadError(413, "ARCHIVO_MUY_GRANDE", "La imagen procesada supera los 10 MB.");
    return { buffer: sanitized, mimeType: detected.mime };
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw invalid("La imagen está dañada o no se puede procesar.");
  }
}

export async function saveValidatedUpload(file: File, options: {
  ownerId: string; articleId?: string; kind: FileKind;
}): Promise<FileRecord> {
  if (options.articleId) {
    const article = await prisma.article.findFirst({ where: { id: options.articleId, ownerId: options.ownerId }, select: { id: true } });
    if (!article) throw new UploadError(403, "ARTICULO_NO_PERMITIDO", "Solo puedes adjuntar archivos a tus artículos.");
    if (options.kind === FileKind.IDENTIDAD) throw invalid("El documento de identidad no se asocia a un artículo.");
  }
  const { buffer, mimeType } = await validateUpload(file, options.kind);
  const storagePath = path.join("storage", "private", randomUUID());
  await mkdir(path.resolve("storage/private"), { recursive: true, mode: 0o700 });
  try {
    await writeFile(privatePath(storagePath), buffer, { flag: "wx", mode: 0o600 });
  } catch (error) {
    // writeFile puede fallar después de escribir parte del binario. No borrar una colisión.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await removePhysicalFile(storagePath);
    throw new UploadError(500, "ARCHIVO_NO_GUARDADO", "No se pudo guardar el archivo. Inténtalo de nuevo.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.fileRecord.create({ data: {
        ...options, mimeType, storagePath, size: buffer.length,
        // No conservar nombres proporcionados por el usuario: pueden contener PII.
        originalName: safeName(mimeType),
      } });
      await writeAuditEvent({ actorId: options.ownerId, action: "ARCHIVO_CREADO", resourceType: "FileRecord", resourceId: record.id, result: "EXITO", detail: { kind: options.kind, size: buffer.length } }, tx);
      return record;
    });
  } catch {
    await removePhysicalFile(storagePath);
    throw new UploadError(500, "ARCHIVO_NO_GUARDADO", "No se pudo guardar el archivo. Inténtalo de nuevo.");
  }
}

export async function readAuthorizedFile(options: {
  fileId: string; requesterId?: string; roles?: Role[];
}): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
  const record = await prisma.fileRecord.findUnique({
    where: { id: options.fileId }, include: { article: { select: { status: true } } },
  });
  if (!record) throw new UploadError(404, "ARCHIVO_NO_ENCONTRADO", "El archivo no está disponible.");
  const isOwner = Boolean(options.requesterId && record.ownerId === options.requesterId);
  const isAdmin = Boolean(options.requesterId && options.roles?.includes("ADMIN_SUBASTAS"));
  let allowed = isOwner || isAdmin;
  if (!allowed && record.kind !== FileKind.IDENTIDAD) {
    allowed = record.kind === FileKind.FOTO && ["APROBADO", "ASOCIADO_SUBASTA"].includes(record.article?.status ?? "");
    if (!allowed && options.requesterId && options.roles?.includes("VERIFICADOR") && record.articleId) {
      allowed = Boolean(await prisma.review.findFirst({
        where: { articleId: record.articleId, verifierId: options.requesterId }, select: { id: true },
      }));
    }
  }
  if (!allowed) throw new UploadError(403, "ARCHIVO_NO_PERMITIDO", "No tienes permiso para consultar este archivo.");
  try {
    return { buffer: await readFile(privatePath(record.storagePath)), mimeType: record.mimeType, originalName: safeName(record.mimeType) };
  } catch {
    throw new UploadError(404, "ARCHIVO_NO_ENCONTRADO", "El archivo no está disponible.");
  }
}

export async function deleteFilesForDraft(articleId: string, ownerId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // Bloquea también nuevas referencias por FK mientras se comprueban las condiciones.
    await tx.$queryRaw`SELECT "id" FROM "Article" WHERE "id" = ${articleId} FOR UPDATE`;
    const article = await tx.article.findFirst({
      where: { id: articleId, ownerId, status: "BORRADOR", reviews: { none: {} }, auctions: { none: {} } },
      select: { id: true },
    });
    if (!article) throw new UploadError(409, "BORRADOR_NO_ELIMINABLE", "Solo puedes eliminar archivos de un borrador propio sin revisiones ni subastas.");
    const files = await tx.fileRecord.findMany({ where: { articleId }, select: { id: true, storagePath: true } });
    for (const file of files) await removePhysicalFile(file.storagePath);
    const { count } = await tx.fileRecord.deleteMany({ where: { id: { in: files.map(({ id }) => id) }, articleId } });
    await writeAuditEvent({ actorId: ownerId, action: "ARCHIVOS_BORRADOR_ELIMINADOS", resourceType: "Article", resourceId: articleId, result: "EXITO", detail: { count } }, tx);
    return count;
  });
}
