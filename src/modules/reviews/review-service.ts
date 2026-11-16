import { Prisma, type ArticleStatus, type FileKind, type ReviewDecision } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuditError, writeAuditEvent } from "@/lib/audit";
import { authErrorResponse } from "@/lib/auth/http";
import { hasValidRoles } from "@/lib/auth/roles";
import { emitNotificationToUser } from "@/lib/realtime";
import {
  assignReviewSchema,
  decideReviewSchema,
  validateReviewAssignmentRules,
  validateReviewDecisionRules,
} from "./review-schema";

const SAFE_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export class ReviewServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReviewServiceError";
  }
}

export function reviewErrorResponse(error: unknown): Response {
  if (error instanceof ReviewServiceError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (error instanceof AuditError) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "AUDITORIA_NO_DISPONIBLE",
          message: "No se pudo registrar la auditoría de la operación. Inténtalo más tarde.",
        },
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const response = authErrorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export type SerializedReviewFile = {
  id: string;
  kind: FileKind;
  mimeType: string;
  originalName: string;
  size: number;
  createdAt: string;
};

export type AssignedReviewListItem = {
  id: string;
  articleId: string;
  title: string;
  category: string;
  condition: string;
  provenance: string;
  initialPrice: string;
  articleStatus: ArticleStatus;
  reviewStatus: ReviewDecision | null;
  comments: string | null;
  assignedAt: string;
  decidedAt: string | null;
  photosCount: number;
  hasCertificate: boolean;
  files: SerializedReviewFile[];
};

export type AssignedReviewDetail = AssignedReviewListItem & {
  description: string;
};

export type PendingArticleAdminItem = {
  id: string;
  title: string;
  category: string;
  condition: string;
  initialPrice: string;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
  photosCount: number;
  hasCertificate: boolean;
  openReview: {
    id: string;
    verifierId: string;
    assignedAt: string;
  } | null;
};

export type ActiveVerifierOption = {
  id: string;
  label: string;
};

/**
 * Asigna un artículo en estado PENDIENTE_REVISION a un verificador activo.
 * Solo un usuario con rol ADMIN_SUBASTAS y cuenta ACTIVA puede ejecutar esta acción.
 */
export async function assignReview(adminId: string, rawInput: unknown) {
  const input = assignReviewSchema.parse(rawInput);

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { id: true, status: true, roles: { select: { role: true } } },
  });
  const adminRoles = admin?.roles.map(({ role }) => role) ?? [];
  if (!admin || admin.status !== "ACTIVA") {
    throw new ReviewServiceError(
      403,
      "CUENTA_NO_ACTIVA",
      "Tu cuenta debe estar activa para asignar verificadores.",
    );
  }
  if (!hasValidRoles(adminRoles) || !adminRoles.includes("ADMIN_SUBASTAS")) {
    throw new ReviewServiceError(
      403,
      "ROL_NO_PERMITIDO",
      "Solo un administrador de subastas puede asignar verificadores.",
    );
  }

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Article" WHERE "id" = ${input.articleId} FOR UPDATE`;

    const article = await tx.article.findUnique({
      where: { id: input.articleId },
      select: { id: true, ownerId: true, title: true, status: true },
    });

    if (!article) {
      throw new ReviewServiceError(
        404,
        "ARTICULO_NO_ENCONTRADO",
        "El artículo solicitado no existe.",
      );
    }

    if (article.status !== "PENDIENTE_REVISION") {
      throw new ReviewServiceError(
        409,
        "ESTADO_ARTICULO_INVALIDO",
        `Solo se pueden asignar artículos en estado PENDIENTE_REVISION (actual: ${article.status}).`,
      );
    }

    const verifier = await tx.user.findUnique({
      where: { id: input.verifierId },
      select: { id: true, status: true, roles: { select: { role: true } } },
    });
    const verifierRoles = verifier?.roles.map(({ role }) => role) ?? [];

    if (
      !verifier ||
      verifier.status !== "ACTIVA" ||
      !hasValidRoles(verifierRoles) ||
      !verifierRoles.includes("VERIFICADOR")
    ) {
      throw new ReviewServiceError(
        400,
        "VERIFICADOR_INVALIDO",
        "El usuario seleccionado debe poseer el rol VERIFICADOR y tener su cuenta ACTIVA.",
      );
    }

    const ruleCheck = validateReviewAssignmentRules({
      actorRoles: adminRoles,
      verifierId: verifier.id,
      articleOwnerId: article.ownerId,
    });
    if (!ruleCheck.ok) {
      const status = ruleCheck.code === "ROL_NO_PERMITIDO" ? 403 : 409;
      throw new ReviewServiceError(status, ruleCheck.code, ruleCheck.message);
    }

    const existingOpen = await tx.review.findFirst({
      where: { articleId: article.id, status: null },
      select: { id: true },
    });
    if (existingOpen) {
      throw new ReviewServiceError(
        409,
        "REVISION_YA_ABIERTA",
        "Este artículo ya cuenta con una asignación de revisión abierta.",
      );
    }

    const review = await tx.review.create({
      data: {
        articleId: article.id,
        verifierId: verifier.id,
      },
      select: {
        id: true,
        articleId: true,
        verifierId: true,
        status: true,
        comments: true,
        assignedAt: true,
        decidedAt: true,
      },
    });

    await writeAuditEvent(
      {
        actorId: admin.id,
        action: "REVISION_ASIGNADA",
        resourceType: "Review",
        resourceId: review.id,
        result: "EXITO",
        detail: {
          status: "PENDIENTE_REVISION",
          role: "VERIFICADOR",
        },
      },
      tx,
    );

    const notification = await tx.notification.create({
      data: {
        userId: verifier.id,
        type: "REVISION_ASIGNADA",
        title: "Nuevo expediente de verificación asignado",
        body: `Se te asignó la revisión documental del artículo "${article.title}".`,
        url: `/verificacion/${review.id}`,
      },
    });

    return { review, notification };
  });

  emitNotificationToUser(txResult.notification.userId, {
    id: txResult.notification.id,
    type: txResult.notification.type,
    title: txResult.notification.title,
    body: txResult.notification.body,
    url: txResult.notification.url,
    createdAt: txResult.notification.createdAt.toISOString(),
  });

  return {
    id: txResult.review.id,
    articleId: txResult.review.articleId,
    verifierId: txResult.review.verifierId,
    status: txResult.review.status,
    comments: txResult.review.comments,
    assignedAt: txResult.review.assignedAt.toISOString(),
    decidedAt: txResult.review.decidedAt ? txResult.review.decidedAt.toISOString() : null,
  };
}

/**
 * Consulta los artículos en estado PENDIENTE_REVISION y los verificadores activos
 * para el panel de administración (/admin/verificaciones), sin exponer datos personales del vendedor.
 */
export async function listPendingArticlesForAdmin(): Promise<{
  articles: PendingArticleAdminItem[];
  verifiers: ActiveVerifierOption[];
}> {
  const [rawArticles, rawVerifiers] = await Promise.all([
    prisma.article.findMany({
      where: { status: "PENDIENTE_REVISION" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        title: true,
        category: true,
        condition: true,
        initialPrice: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        files: {
          where: { kind: { in: ["FOTO", "CERTIFICADO"] } },
          select: { id: true, kind: true },
        },
        reviews: {
          where: { status: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          select: { id: true, verifierId: true, assignedAt: true },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        status: "ACTIVA",
        roles: { some: { role: "VERIFICADOR" } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        roles: { select: { role: true } },
      },
    }),
  ]);

  const validVerifiers = rawVerifiers.filter((u) =>
    hasValidRoles(u.roles.map(({ role }) => role)),
  );

  const verifiers: ActiveVerifierOption[] = validVerifiers.map((u, idx) => ({
    id: u.id,
    label: `Verificador Especialista #${String(idx + 1).padStart(2, "0")} (${u.id.slice(-6)})`,
  }));

  const articles: PendingArticleAdminItem[] = rawArticles.map((art) => {
    const photosCount = art.files.filter((f) => f.kind === "FOTO").length;
    const hasCertificate = art.files.some((f) => f.kind === "CERTIFICADO");
    const open = art.reviews[0] ?? null;

    return {
      id: art.id,
      title: art.title,
      category: art.category,
      condition: art.condition,
      initialPrice: new Prisma.Decimal(art.initialPrice).toFixed(2),
      status: art.status,
      createdAt: art.createdAt.toISOString(),
      updatedAt: art.updatedAt.toISOString(),
      photosCount,
      hasCertificate,
      openReview: open
        ? {
            id: open.id,
            verifierId: open.verifierId,
            assignedAt: open.assignedAt.toISOString(),
          }
        : null,
    };
  });

  return { articles, verifiers };
}

/**
 * Consulta únicamente las asignaciones pertenecientes al verificador indicado,
 * sin exponer jamás datos personales ni identificadores del vendedor.
 */
export async function listAssignedReviews(
  verifierId: string,
): Promise<AssignedReviewListItem[]> {
  if (!SAFE_ID_REGEX.test(verifierId)) {
    return [];
  }

  const rows = await prisma.review.findMany({
    where: { verifierId },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      articleId: true,
      status: true,
      comments: true,
      assignedAt: true,
      decidedAt: true,
      article: {
        select: {
          id: true,
          title: true,
          category: true,
          condition: true,
          provenance: true,
          initialPrice: true,
          status: true,
          files: {
            where: { kind: { in: ["FOTO", "CERTIFICADO"] } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              kind: true,
              mimeType: true,
              originalName: true,
              size: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  const sorted = [...rows].sort((a, b) => {
    const aPending = a.status === null ? 0 : 1;
    const bPending = b.status === null ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return b.assignedAt.getTime() - a.assignedAt.getTime();
  });

  return sorted.map((row) => {
    const files: SerializedReviewFile[] = row.article.files.map((f) => ({
      id: f.id,
      kind: f.kind,
      mimeType: f.mimeType,
      originalName: f.originalName,
      size: f.size,
      createdAt: f.createdAt.toISOString(),
    }));
    const photosCount = files.filter((f) => f.kind === "FOTO").length;
    const hasCertificate = files.some((f) => f.kind === "CERTIFICADO");

    return {
      id: row.id,
      articleId: row.articleId,
      title: row.article.title,
      category: row.article.category,
      condition: row.article.condition,
      provenance: row.article.provenance,
      initialPrice: new Prisma.Decimal(row.article.initialPrice).toFixed(2),
      articleStatus: row.article.status,
      reviewStatus: row.status,
      comments: row.comments,
      assignedAt: row.assignedAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      photosCount,
      hasCertificate,
      files,
    };
  });
}

/**
 * Obtiene el detalle de un expediente de revisión asignado al verificador autenticado,
 * incluyendo archivos permitidos (FOTO / CERTIFICADO) y sin exponer datos del vendedor.
 */
export async function getAssignedReviewById(
  verifierId: string,
  reviewId: string,
): Promise<AssignedReviewDetail> {
  if (!SAFE_ID_REGEX.test(reviewId)) {
    throw new ReviewServiceError(
      404,
      "REVISION_NO_ENCONTRADA",
      "El expediente de verificación solicitado no existe.",
    );
  }

  const row = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      articleId: true,
      verifierId: true,
      status: true,
      comments: true,
      assignedAt: true,
      decidedAt: true,
      article: {
        select: {
          id: true,
          ownerId: true,
          title: true,
          description: true,
          category: true,
          condition: true,
          provenance: true,
          initialPrice: true,
          status: true,
          files: {
            where: { kind: { in: ["FOTO", "CERTIFICADO"] } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              kind: true,
              mimeType: true,
              originalName: true,
              size: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!row) {
    throw new ReviewServiceError(
      404,
      "REVISION_NO_ENCONTRADA",
      "El expediente de verificación solicitado no existe.",
    );
  }

  const ruleCheck = validateReviewDecisionRules({
    actorId: verifierId,
    assignedVerifierId: row.verifierId,
    articleOwnerId: row.article.ownerId,
  });
  if (!ruleCheck.ok) {
    throw new ReviewServiceError(403, ruleCheck.code, ruleCheck.message);
  }

  const files: SerializedReviewFile[] = row.article.files.map((f) => ({
    id: f.id,
    kind: f.kind,
    mimeType: f.mimeType,
    originalName: f.originalName,
    size: f.size,
    createdAt: f.createdAt.toISOString(),
  }));

  return {
    id: row.id,
    articleId: row.articleId,
    title: row.article.title,
    description: row.article.description,
    category: row.article.category,
    condition: row.article.condition,
    provenance: row.article.provenance,
    initialPrice: new Prisma.Decimal(row.article.initialPrice).toFixed(2),
    articleStatus: row.article.status,
    reviewStatus: row.status,
    comments: row.comments,
    assignedAt: row.assignedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    photosCount: files.filter((f) => f.kind === "FOTO").length,
    hasCertificate: files.some((f) => f.kind === "CERTIFICADO"),
    files,
  };
}

/**
 * Registra la decisión del verificador asignado sobre un expediente abierto,
 * actualizando Article.status, Review.status/comments/decidedAt, AuditEvent y Notification.
 */
export async function decideReview(
  verifierId: string,
  reviewId: string,
  rawInput: unknown,
) {
  if (!SAFE_ID_REGEX.test(reviewId)) {
    throw new ReviewServiceError(
      404,
      "REVISION_NO_ENCONTRADA",
      "El expediente de verificación solicitado no existe.",
    );
  }

  const input = decideReviewSchema.parse(rawInput);

  const verifier = await prisma.user.findUnique({
    where: { id: verifierId },
    select: { id: true, status: true, roles: { select: { role: true } } },
  });
  const verifierRoles = verifier?.roles.map(({ role }) => role) ?? [];
  if (!verifier || verifier.status !== "ACTIVA") {
    throw new ReviewServiceError(
      403,
      "CUENTA_NO_ACTIVA",
      "Tu cuenta debe estar activa para registrar dictámenes de verificación.",
    );
  }
  if (!hasValidRoles(verifierRoles) || !verifierRoles.includes("VERIFICADOR")) {
    throw new ReviewServiceError(
      403,
      "ROL_NO_PERMITIDO",
      "Solo los usuarios con rol VERIFICADOR pueden registrar dictámenes.",
    );
  }

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Review" WHERE "id" = ${reviewId} FOR UPDATE`;

    const existing = await tx.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        articleId: true,
        verifierId: true,
        status: true,
        decidedAt: true,
        article: {
          select: {
            id: true,
            ownerId: true,
            title: true,
            status: true,
          },
        },
      },
    });

    if (!existing) {
      throw new ReviewServiceError(
        404,
        "REVISION_NO_ENCONTRADA",
        "El expediente de verificación solicitado no existe.",
      );
    }

    const ruleCheck = validateReviewDecisionRules({
      actorId: verifier.id,
      assignedVerifierId: existing.verifierId,
      articleOwnerId: existing.article.ownerId,
    });
    if (!ruleCheck.ok) {
      throw new ReviewServiceError(403, ruleCheck.code, ruleCheck.message);
    }

    if (existing.status !== null || existing.decidedAt !== null) {
      throw new ReviewServiceError(
        409,
        "REVISION_YA_DECIDIDA",
        "Este expediente de verificación ya fue resuelto previamente y no puede decidirse de nuevo.",
      );
    }

    await tx.$queryRaw`SELECT "id" FROM "Article" WHERE "id" = ${existing.articleId} FOR UPDATE`;

    const lockedArticle = await tx.article.findUnique({
      where: { id: existing.articleId },
      select: { id: true, ownerId: true, title: true, status: true },
    });

    if (!lockedArticle || lockedArticle.status !== "PENDIENTE_REVISION") {
      throw new ReviewServiceError(
        409,
        "ESTADO_ARTICULO_INVALIDO",
        "El artículo ya no se encuentra en estado PENDIENTE_REVISION.",
      );
    }

    const decidedAt = new Date();

    const updatedReview = await tx.review.update({
      where: { id: existing.id },
      data: {
        status: input.decision,
        comments: input.comments,
        decidedAt,
      },
      select: {
        id: true,
        articleId: true,
        verifierId: true,
        status: true,
        comments: true,
        assignedAt: true,
        decidedAt: true,
      },
    });

    const updatedArticle = await tx.article.update({
      where: { id: lockedArticle.id },
      data: {
        status: input.decision,
      },
      select: {
        id: true,
        status: true,
      },
    });

    await writeAuditEvent(
      {
        actorId: verifier.id,
        action: "REVISION_DECIDIDA",
        resourceType: "Review",
        resourceId: updatedReview.id,
        result: "EXITO",
        detail: {
          previousStatus: "PENDIENTE_REVISION",
          status: input.decision,
        },
      },
      tx,
    );

    const notification = await tx.notification.create({
      data: {
        userId: lockedArticle.ownerId,
        type: "REVISION_DECIDIDA",
        title: `Resultado de revisión: ${input.decision}`,
        body: `El expediente de tu artículo "${lockedArticle.title}" fue resuelto con estado ${input.decision}.`,
        url: `/mis-articulos/${lockedArticle.id}`,
      },
    });

    return {
      review: updatedReview,
      articleStatus: updatedArticle.status,
      notification,
    };
  });

  emitNotificationToUser(txResult.notification.userId, {
    id: txResult.notification.id,
    type: txResult.notification.type,
    title: txResult.notification.title,
    body: txResult.notification.body,
    url: txResult.notification.url,
    createdAt: txResult.notification.createdAt.toISOString(),
  });

  return {
    review: {
      id: txResult.review.id,
      articleId: txResult.review.articleId,
      verifierId: txResult.review.verifierId,
      status: txResult.review.status,
      comments: txResult.review.comments,
      assignedAt: txResult.review.assignedAt.toISOString(),
      decidedAt: txResult.review.decidedAt ? txResult.review.decidedAt.toISOString() : null,
    },
    articleStatus: txResult.articleStatus,
  };
}
