import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ArticleInput } from "./article-schema";

/* ================================================================== *
 *  PujaFácil — Servicio de dominio de Artículos                      *
 *  Propietario: módulo articles (capa de dominio)                    *
 * ================================================================== */

// ─── Error de dominio ────────────────────────────────────────────────

export class ArticleServiceError extends Error {
  public readonly statusCode: 400 | 403 | 404 | 409;
  public readonly code: string;

  constructor(
    statusCode: 400 | 403 | 404 | 409,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "ArticleServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ─── Helpers internos ────────────────────────────────────────────────

/**
 * Serializa un artículo de Prisma a un objeto seguro para JSON:
 * - `Decimal` → string con 2 decimales
 * - `Date`   → ISO string
 */
function serializeArticle(article: RawArticle) {
  return {
    ...article,
    initialPrice: article.initialPrice.toFixed(2),
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    files: article.files?.map(serializeFile),
  };
}

type RawArticle = Prisma.ArticleGetPayload<{
  include: { files: true };
}>;

type RawFile = Prisma.FileRecordGetPayload<object>;

function serializeFile(file: RawFile) {
  return {
    ...file,
    createdAt: file.createdAt.toISOString(),
  };
}

/** Serialización ligera para listados (sin relación files). */
function serializeArticleLight(
  article: Omit<RawArticle, "files"> & { files?: undefined },
) {
  return {
    ...article,
    initialPrice: article.initialPrice.toFixed(2),
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

/** Busca un artículo propio; lanza 404 si no existe o no pertenece al usuario. */
async function findOwnArticleOrFail(userId: string, id: string) {
  const article = await prisma.article.findUnique({
    where: { id },
    include: { files: true },
  });

  if (!article || article.ownerId !== userId) {
    throw new ArticleServiceError(
      404,
      "NOT_FOUND",
      "El artículo solicitado no existe o no te pertenece",
    );
  }
  return article;
}

// ─── 1. listOwnArticles ─────────────────────────────────────────────

export async function listOwnArticles(
  userId: string,
  params: { q?: string; page?: number; pageSize?: number },
) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 8;

  const where: Prisma.ArticleWhereInput = { ownerId: userId };

  if (params.q) {
    const search = params.q;
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.article.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items: items.map((item) =>
      serializeArticleLight(item as Omit<RawArticle, "files"> & { files?: undefined }),
    ),
    page,
    pageSize,
    total,
    pages,
  };
}

// ─── 2. getOwnArticle ───────────────────────────────────────────────

export async function getOwnArticle(userId: string, id: string) {
  const article = await findOwnArticleOrFail(userId, id);
  return serializeArticle(article);
}

// ─── 3. createDraft ─────────────────────────────────────────────────

export async function createDraft(userId: string, input: ArticleInput) {
  const article = await prisma.article.create({
    data: {
      ownerId: userId,
      title: input.title,
      description: input.description,
      category: input.category,
      condition: input.condition,
      provenance: input.provenance,
      initialPrice: new Prisma.Decimal(input.initialPrice),
      status: "BORRADOR",
    },
    include: { files: true },
  });

  return serializeArticle(article);
}

// ─── 4. updateDraft ──────────────────────────────────────────────────

const EDITABLE_STATUSES = new Set(["BORRADOR", "REQUIERE_CORRECCIONES"]);

export async function updateDraft(
  userId: string,
  id: string,
  input: Partial<ArticleInput>,
) {
  const existing = await findOwnArticleOrFail(userId, id);

  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw new ArticleServiceError(
      409,
      "INVALID_STATE",
      `No se puede editar un artículo en estado "${existing.status}". Solo se permiten ediciones en estado BORRADOR o REQUIERE_CORRECCIONES`,
    );
  }

  const data: Prisma.ArticleUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.condition !== undefined) data.condition = input.condition;
  if (input.provenance !== undefined) data.provenance = input.provenance;
  if (input.initialPrice !== undefined) {
    data.initialPrice = new Prisma.Decimal(input.initialPrice);
  }

  const updated = await prisma.article.update({
    where: { id },
    data,
    include: { files: true },
  });

  return serializeArticle(updated);
}

// ─── 5. deleteDraft ──────────────────────────────────────────────────

export async function deleteDraft(userId: string, id: string) {
  const existing = await findOwnArticleOrFail(userId, id);

  if (existing.status !== "BORRADOR") {
    throw new ArticleServiceError(
      409,
      "CANNOT_DELETE",
      `Solo se pueden eliminar artículos en estado BORRADOR (actual: "${existing.status}")`,
    );
  }

  // Verificar que no tenga subastas ni revisiones asociadas
  const [auctionCount, reviewCount] = await Promise.all([
    prisma.auction.count({ where: { articleId: id } }),
    prisma.review.count({ where: { articleId: id } }),
  ]);

  if (auctionCount > 0 || reviewCount > 0) {
    throw new ArticleServiceError(
      409,
      "CANNOT_DELETE",
      "No se puede eliminar este artículo porque tiene subastas o revisiones asociadas",
    );
  }

  // uploads.ts no existe aún en el repo: borramos FileRecords asociados en transacción.
  await prisma.$transaction(async (tx) => {
    await tx.fileRecord.deleteMany({ where: { articleId: id } });
    await tx.article.delete({ where: { id } });
  });

  return { deleted: true };
}

// ─── 6. submitForReview ──────────────────────────────────────────────

export async function submitForReview(userId: string, id: string) {
  const existing = await findOwnArticleOrFail(userId, id);

  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw new ArticleServiceError(
      409,
      "INVALID_STATE",
      `No se puede enviar a verificación un artículo en estado "${existing.status}". Solo se permite en estado BORRADOR o REQUIERE_CORRECCIONES`,
    );
  }

  // Verificar que tenga al menos una foto adjunta
  const photoCount = await prisma.fileRecord.count({
    where: { articleId: id, kind: "FOTO" },
  });

  if (photoCount === 0) {
    throw new ArticleServiceError(
      400,
      "MISSING_PHOTO",
      "Debes adjuntar al menos una fotografía antes de enviar el artículo a verificación",
    );
  }

  const updated = await prisma.article.update({
    where: { id },
    data: { status: "PENDIENTE_REVISION" },
    include: { files: true },
  });

  return serializeArticle(updated);
}
