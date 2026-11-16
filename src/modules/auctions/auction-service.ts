import { Prisma, type AuctionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuditError, writeAuditEvent } from "@/lib/audit";
import { authErrorResponse } from "@/lib/auth/http";
import { hasValidRoles } from "@/lib/auth/roles";
import { emitAuctionUpdated, emitNotificationToUser } from "@/lib/realtime";
import {
  createAuctionSchema,
  isWithinServerAuctionWindow,
  suspendAuctionSchema,
  validateStartingPriceAgainstArticle,
} from "./auction-schema";

const SAFE_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
const FALLBACK_WINNER_ALIAS = "Postor";

export const PUBLIC_AUCTION_STATUSES: readonly AuctionStatus[] = [
  "PROGRAMADA",
  "ACTIVA",
  "ADJUDICADA",
  "CERRADA_SIN_OFERTAS",
] as const;

const FORBIDDEN_CLIENT_FIELDS = ["buyerId", "status", "winnerBidId"] as const;

export class AuctionServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuctionServiceError";
  }
}

export function auctionErrorResponse(error: unknown): Response {
  if (error instanceof AuctionServiceError) {
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

export type PublicAuctionDetail = {
  id: string;
  article: {
    id: string;
    title: string;
    category: string;
    description: string;
    photoFileIds: string[];
  };
  status: AuctionStatus;
  startingPrice: string;
  minIncrement: string;
  opensAt: string;
  closesAt: string;
  highestBid: string | null;
  bidCount: number;
  winnerAlias?: string;
};

export type PublicAuctionListItem = {
  id: string;
  articleId: string;
  title: string;
  category: string;
  photoFileIds: string[];
  status: AuctionStatus;
  startingPrice: string;
  minIncrement: string;
  opensAt: string;
  closesAt: string;
  highestBid: string | null;
  bidCount: number;
  winnerAlias?: string;
};

export type PublicAuctionListResult = {
  items: PublicAuctionListItem[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

export type AdminAuctionItem = {
  id: string;
  articleId: string;
  articleTitle: string;
  category: string;
  startingPrice: string;
  minIncrement: string;
  opensAt: string;
  closesAt: string;
  status: AuctionStatus;
  bidCount: number;
  highestBid: string | null;
  winnerAlias?: string;
};

export type ApprovedArticleOption = {
  id: string;
  title: string;
  category: string;
  initialPrice: string;
};

export type SellerAuctionItem = {
  auctionId: string;
  articleId: string;
  articleTitle: string;
  category: string;
  startingPrice: string;
  minIncrement: string;
  highestBid: string | null;
  bidCount: number;
  status: AuctionStatus;
  opensAt: string;
  closesAt: string;
  winnerAlias?: string;
};

export type AdminDashboardSummary = {
  pendingArticlesCount: number;
  scheduledAuctionsCount: number;
  activeAuctionsCount: number;
  validBidsCount: number;
};

const listPublicAuctionsInputSchema = z.object({
  status: z.string().trim().optional(),
  q: z.string().trim().max(120, "La búsqueda no puede superar 120 caracteres.").optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(9),
});

async function assertAdminSubastasActor(adminId: string) {
  const normalizedId = adminId?.trim();
  if (!normalizedId || !SAFE_ID_REGEX.test(normalizedId)) {
    throw new AuctionServiceError(
      403,
      "ROL_NO_PERMITIDO",
      "Solo un administrador de subastas activo puede ejecutar esta operación.",
    );
  }

  const admin = await prisma.user.findUnique({
    where: { id: normalizedId },
    select: { id: true, status: true, roles: { select: { role: true } } },
  });

  const roles = admin?.roles.map(({ role }) => role) ?? [];
  if (!admin || admin.status !== "ACTIVA") {
    throw new AuctionServiceError(
      403,
      "CUENTA_NO_ACTIVA",
      "Tu cuenta debe estar activa para administrar subastas.",
    );
  }

  if (!hasValidRoles(roles) || !roles.includes("ADMIN_SUBASTAS")) {
    throw new AuctionServiceError(
      403,
      "ROL_NO_PERMITIDO",
      "Solo un usuario con rol ADMIN_SUBASTAS puede modificar subastas.",
    );
  }

  return admin;
}

function assertNoForbiddenClientFields(rawInput: unknown): void {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return;
  }
  const record = rawInput as Record<string, unknown>;
  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (field in record) {
      throw new AuctionServiceError(
        400,
        "CAMPOS_PROHIBIDOS_CLIENTE",
        `El campo '${field}' es controlado exclusivamente por el servidor y no se admite desde el cliente.`,
      );
    }
  }
}

function resolveWinnerAlias(params: {
  status: AuctionStatus;
  winnerBidId: string | null;
  bids: Array<{ id: string; buyerId: string; amount: Prisma.Decimal | string }>;
  aliases: Array<{ userId: string; alias: string }>;
}): string | undefined {
  const { status, winnerBidId, bids, aliases } = params;
  if (status !== "ADJUDICADA") {
    return undefined;
  }

  const aliasMap = new Map<string, string>();
  for (const item of aliases) {
    aliasMap.set(item.userId, item.alias);
  }

  const winningBid =
    (winnerBidId ? bids.find((b) => b.id === winnerBidId) : undefined) ?? bids[0];

  if (!winningBid) {
    return undefined;
  }

  return aliasMap.get(winningBid.buyerId) ?? FALLBACK_WINNER_ALIAS;
}

/**
 * Crea y programa una subasta a partir de un artículo en estado APROBADO.
 * - Solo ADMIN_SUBASTAS con cuenta ACTIVA.
 * - Rechaza buyerId, status o winnerBidId procedentes del cliente.
 * - Valida artículo APROBADO y que no tenga otra subasta simultánea en curso (BORRADOR, PROGRAMADA o ACTIVA).
 * - Valida startingPrice >= article.initialPrice, minIncrement > 0 y opensAt < closesAt.
 * - Transiciona BORRADOR -> PROGRAMADA y actualiza Article.status = ASOCIADO_SUBASTA.
 * - Registra evento de auditoría sin PII y notifica al vendedor.
 */
export async function createAuction(
  adminId: string,
  rawInput: unknown,
  serverNow: Date = new Date(),
) {
  assertNoForbiddenClientFields(rawInput);
  const input = createAuctionSchema.parse(rawInput);
  const admin = await assertAdminSubastasActor(adminId);

  const opensAtDate = new Date(input.opensAt);
  const closesAtDate = new Date(input.closesAt);

  if (opensAtDate.getTime() >= closesAtDate.getTime()) {
    throw new AuctionServiceError(
      400,
      "FECHAS_SUBASTA_INVALIDAS",
      "La fecha de apertura debe ser estrictamente anterior a la fecha de cierre.",
    );
  }

  if (closesAtDate.getTime() <= serverNow.getTime()) {
    throw new AuctionServiceError(
      400,
      "FECHA_CIERRE_PASADA",
      "La fecha de cierre debe ser posterior a la hora actual del servidor.",
    );
  }

  const startingPriceDec = new Prisma.Decimal(input.startingPrice);
  const minIncrementDec = new Prisma.Decimal(input.minIncrement);

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Article" WHERE "id" = ${input.articleId} FOR UPDATE`;

    const article = await tx.article.findUnique({
      where: { id: input.articleId },
      select: {
        id: true,
        ownerId: true,
        title: true,
        category: true,
        initialPrice: true,
        status: true,
      },
    });

    if (!article) {
      throw new AuctionServiceError(
        404,
        "ARTICULO_NO_ENCONTRADO",
        "El artículo indicado no existe.",
      );
    }

    if (article.status !== "APROBADO") {
      throw new AuctionServiceError(
        409,
        "ARTICULO_NO_APROBADO",
        `Solo se pueden programar subastas para artículos en estado APROBADO (actual: ${article.status}).`,
      );
    }

    const simultaneousAuction = await tx.auction.findFirst({
      where: {
        articleId: article.id,
        status: { in: ["BORRADOR", "PROGRAMADA", "ACTIVA"] },
      },
      select: { id: true, status: true },
    });

    if (simultaneousAuction) {
      throw new AuctionServiceError(
        409,
        "SUBASTA_SIMULTANEA_EXISTENTE",
        "El artículo ya cuenta con una subasta simultánea en curso o programada.",
      );
    }

    const priceValidation = validateStartingPriceAgainstArticle(
      startingPriceDec,
      article.initialPrice,
    );
    if (!priceValidation.ok) {
      throw new AuctionServiceError(400, priceValidation.code, priceValidation.message);
    }

    const createdAuction = await tx.auction.create({
      data: {
        articleId: article.id,
        createdById: admin.id,
        startingPrice: startingPriceDec.toFixed(2),
        minIncrement: minIncrementDec.toFixed(2),
        opensAt: opensAtDate,
        closesAt: closesAtDate,
        status: "PROGRAMADA",
      },
      select: {
        id: true,
        articleId: true,
        startingPrice: true,
        minIncrement: true,
        opensAt: true,
        closesAt: true,
        status: true,
        createdAt: true,
      },
    });

    await tx.article.update({
      where: { id: article.id },
      data: { status: "ASOCIADO_SUBASTA" },
    });

    await writeAuditEvent(
      {
        actorId: admin.id,
        action: "SUBASTA_PROGRAMADA",
        resourceType: "Auction",
        resourceId: createdAuction.id,
        result: "EXITO",
        detail: {
          previousStatus: "BORRADOR",
          status: "PROGRAMADA",
          articleStatus: "ASOCIADO_SUBASTA",
          role: "ADMIN_SUBASTAS",
        },
      },
      tx,
    );

    const notification = await tx.notification.create({
      data: {
        userId: article.ownerId,
        type: "SUBASTA_PROGRAMADA",
        title: "Subasta programada para tu artículo",
        body: `Tu artículo "${article.title}" fue programado para subasta con precio de salida de $${startingPriceDec.toFixed(2)} USD.`,
        url: `/subastas/${createdAuction.id}`,
      },
    });

    return { createdAuction, article, notification };
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
    id: txResult.createdAuction.id,
    articleId: txResult.createdAuction.articleId,
    articleTitle: txResult.article.title,
    category: txResult.article.category,
    startingPrice: new Prisma.Decimal(txResult.createdAuction.startingPrice).toFixed(2),
    minIncrement: new Prisma.Decimal(txResult.createdAuction.minIncrement).toFixed(2),
    opensAt: txResult.createdAuction.opensAt.toISOString(),
    closesAt: txResult.createdAuction.closesAt.toISOString(),
    status: txResult.createdAuction.status,
    bidCount: 0,
    highestBid: null,
  };
}

/**
 * Lista las subastas públicas (PROGRAMADA, ACTIVA, ADJUDICADA, CERRADA_SIN_OFERTAS)
 * con filtro por estado, búsqueda por texto (título o categoría) y paginación.
 * Nunca expone datos personales de vendedores ni compradores.
 */
export async function listPublicAuctions(rawQuery: {
  status?: string;
  q?: string;
  page?: number | string;
  pageSize?: number | string;
} = {}): Promise<PublicAuctionListResult> {
  const parsed = listPublicAuctionsInputSchema.parse(rawQuery);
  const rawStatus = parsed.status?.trim().toUpperCase();

  let statusesFilter: AuctionStatus[] = [...PUBLIC_AUCTION_STATUSES];
  if (rawStatus && rawStatus !== "TODAS") {
    if (!PUBLIC_AUCTION_STATUSES.includes(rawStatus as AuctionStatus)) {
      throw new AuctionServiceError(
        400,
        "ESTADO_FILTRO_INVALIDO",
        "El filtro de estado solicitado no es válido para el catálogo público.",
      );
    }
    statusesFilter = [rawStatus as AuctionStatus];
  }

  const trimmedQuery = parsed.q?.trim() ?? "";
  const where: Prisma.AuctionWhereInput = {
    status: { in: statusesFilter },
    ...(trimmedQuery
      ? {
          article: {
            OR: [
              { title: { contains: trimmedQuery, mode: "insensitive" } },
              { category: { contains: trimmedQuery, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const skip = (parsed.page - 1) * parsed.pageSize;

  const [rows, total] = await Promise.all([
    prisma.auction.findMany({
      where,
      skip,
      take: parsed.pageSize,
      orderBy: [{ status: "asc" }, { closesAt: "asc" }, { id: "desc" }],
      select: {
        id: true,
        articleId: true,
        status: true,
        startingPrice: true,
        minIncrement: true,
        opensAt: true,
        closesAt: true,
        winnerBidId: true,
        article: {
          select: {
            id: true,
            title: true,
            category: true,
            files: {
              where: { kind: "FOTO" },
              orderBy: { createdAt: "asc" },
              select: { id: true },
            },
          },
        },
        bids: {
          orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
          select: { id: true, buyerId: true, amount: true },
        },
        aliases: {
          select: { userId: true, alias: true },
        },
      },
    }),
    prisma.auction.count({ where }),
  ]);

  const items: PublicAuctionListItem[] = rows.map((row) => {
    const topBid = row.bids[0];
    const winnerAlias = resolveWinnerAlias({
      status: row.status,
      winnerBidId: row.winnerBidId,
      bids: row.bids,
      aliases: row.aliases,
    });

    return {
      id: row.id,
      articleId: row.article.id,
      title: row.article.title,
      category: row.article.category,
      photoFileIds: row.article.files.map((f) => f.id),
      status: row.status,
      startingPrice: new Prisma.Decimal(row.startingPrice).toFixed(2),
      minIncrement: new Prisma.Decimal(row.minIncrement).toFixed(2),
      opensAt: row.opensAt.toISOString(),
      closesAt: row.closesAt.toISOString(),
      highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
      bidCount: row.bids.length,
      ...(winnerAlias ? { winnerAlias } : {}),
    };
  });

  return {
    items,
    page: parsed.page,
    pageSize: parsed.pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / parsed.pageSize)),
  };
}

/**
 * Devuelve el detalle público de una subasta cumpliendo exactamente el contrato acordado:
 * { id, article: { id, title, category, description, photoFileIds }, status, startingPrice,
 *   minIncrement, opensAt, closesAt, highestBid, bidCount, winnerAlias? }
 * Sin exponer identidades reales de vendedores ni compradores.
 */
export async function getPublicAuction(id: string): Promise<PublicAuctionDetail> {
  const normalizedId = id?.trim();
  if (!normalizedId || !SAFE_ID_REGEX.test(normalizedId)) {
    throw new AuctionServiceError(
      404,
      "SUBASTA_NO_ENCONTRADA",
      "La subasta solicitada no existe.",
    );
  }

  const auction = await prisma.auction.findUnique({
    where: { id: normalizedId },
    select: {
      id: true,
      status: true,
      startingPrice: true,
      minIncrement: true,
      opensAt: true,
      closesAt: true,
      winnerBidId: true,
      article: {
        select: {
          id: true,
          title: true,
          category: true,
          description: true,
          files: {
            where: { kind: "FOTO" },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          },
        },
      },
      bids: {
        orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
        select: { id: true, buyerId: true, amount: true },
      },
      aliases: {
        select: { userId: true, alias: true },
      },
    },
  });

  if (!auction || auction.status === "BORRADOR") {
    throw new AuctionServiceError(
      404,
      "SUBASTA_NO_ENCONTRADA",
      "La subasta solicitada no existe o no es pública.",
    );
  }

  const topBid = auction.bids[0];
  const winnerAlias = resolveWinnerAlias({
    status: auction.status,
    winnerBidId: auction.winnerBidId,
    bids: auction.bids,
    aliases: auction.aliases,
  });

  return {
    id: auction.id,
    article: {
      id: auction.article.id,
      title: auction.article.title,
      category: auction.article.category,
      description: auction.article.description,
      photoFileIds: auction.article.files.map((file) => file.id),
    },
    status: auction.status,
    startingPrice: new Prisma.Decimal(auction.startingPrice).toFixed(2),
    minIncrement: new Prisma.Decimal(auction.minIncrement).toFixed(2),
    opensAt: auction.opensAt.toISOString(),
    closesAt: auction.closesAt.toISOString(),
    highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
    bidCount: auction.bids.length,
    ...(winnerAlias ? { winnerAlias } : {}),
  };
}

/**
 * Lista todas las subastas para la bandeja de supervisión administrativa (/admin/subastas),
 * sin incluir datos sensibles de usuarios.
 */
export async function listAdminAuctions(): Promise<AdminAuctionItem[]> {
  const rows = await prisma.auction.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      articleId: true,
      startingPrice: true,
      minIncrement: true,
      opensAt: true,
      closesAt: true,
      status: true,
      winnerBidId: true,
      article: {
        select: {
          title: true,
          category: true,
        },
      },
      bids: {
        orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
        select: { id: true, buyerId: true, amount: true },
      },
      aliases: {
        select: { userId: true, alias: true },
      },
    },
  });

  return rows.map((row) => {
    const topBid = row.bids[0];
    const winnerAlias = resolveWinnerAlias({
      status: row.status,
      winnerBidId: row.winnerBidId,
      bids: row.bids,
      aliases: row.aliases,
    });

    return {
      id: row.id,
      articleId: row.articleId,
      articleTitle: row.article.title,
      category: row.article.category,
      startingPrice: new Prisma.Decimal(row.startingPrice).toFixed(2),
      minIncrement: new Prisma.Decimal(row.minIncrement).toFixed(2),
      opensAt: row.opensAt.toISOString(),
      closesAt: row.closesAt.toISOString(),
      status: row.status,
      bidCount: row.bids.length,
      highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
      ...(winnerAlias ? { winnerAlias } : {}),
    };
  });
}

/**
 * Lista los artículos en estado APROBADO que no tienen ninguna subasta activa/programada en curso,
 * listos para ser seleccionados en el formulario de programación de /admin/subastas.
 */
export async function listApprovedArticlesForScheduling(): Promise<ApprovedArticleOption[]> {
  const articles = await prisma.article.findMany({
    where: {
      status: "APROBADO",
      auctions: {
        none: {
          status: { in: ["BORRADOR", "PROGRAMADA", "ACTIVA"] },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      category: true,
      initialPrice: true,
    },
  });

  return articles.map((article) => ({
    id: article.id,
    title: article.title,
    category: article.category,
    initialPrice: new Prisma.Decimal(article.initialPrice).toFixed(2),
  }));
}

/**
 * Activa una subasta programada cuando el reloj del servidor se encuentra dentro de la ventana
 * oficial (opensAt <= serverNow < closesAt).
 * - Solo ADMIN_SUBASTAS activo.
 * - Transición PROGRAMADA (o BORRADOR) -> ACTIVA.
 * - Asegura Article.status = ASOCIADO_SUBASTA.
 * - Registra evento de auditoría sin PII y emite actualización en tiempo real.
 */
export async function activateAuction(
  adminId: string,
  id: string,
  serverNow: Date = new Date(),
) {
  const normalizedId = id?.trim();
  if (!normalizedId || !SAFE_ID_REGEX.test(normalizedId)) {
    throw new AuctionServiceError(404, "SUBASTA_NO_ENCONTRADA", "La subasta indicada no existe.");
  }

  const admin = await assertAdminSubastasActor(adminId);

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${normalizedId} FOR UPDATE`;

    const auction = await tx.auction.findUnique({
      where: { id: normalizedId },
      select: {
        id: true,
        articleId: true,
        startingPrice: true,
        minIncrement: true,
        opensAt: true,
        closesAt: true,
        status: true,
        article: {
          select: {
            id: true,
            title: true,
            category: true,
            status: true,
          },
        },
        bids: {
          orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { amount: true },
        },
        _count: {
          select: { bids: true },
        },
      },
    });

    if (!auction) {
      throw new AuctionServiceError(
        404,
        "SUBASTA_NO_ENCONTRADA",
        "La subasta indicada no existe.",
      );
    }

    if (auction.status !== "PROGRAMADA" && auction.status !== "BORRADOR") {
      throw new AuctionServiceError(
        409,
        "TRANSICION_ESTADO_INVALIDA",
        `Solo se puede activar una subasta en estado PROGRAMADA (actual: ${auction.status}).`,
      );
    }

    if (serverNow.getTime() < auction.opensAt.getTime()) {
      throw new AuctionServiceError(
        409,
        "APERTURA_NO_ALCANZADA",
        "No se puede activar la subasta antes de la fecha y hora oficial de apertura del servidor.",
      );
    }

    if (
      !isWithinServerAuctionWindow(auction.opensAt, auction.closesAt, serverNow) ||
      serverNow.getTime() >= auction.closesAt.getTime()
    ) {
      throw new AuctionServiceError(
        409,
        "SUBASTA_EXPIRADA",
        "La ventana horaria de la subasta ya concluyó según el reloj del servidor.",
      );
    }

    const updated = await tx.auction.update({
      where: { id: auction.id },
      data: { status: "ACTIVA" },
      select: {
        id: true,
        articleId: true,
        startingPrice: true,
        minIncrement: true,
        opensAt: true,
        closesAt: true,
        status: true,
      },
    });

    if (auction.article.status !== "ASOCIADO_SUBASTA") {
      await tx.article.update({
        where: { id: auction.articleId },
        data: { status: "ASOCIADO_SUBASTA" },
      });
    }

    await writeAuditEvent(
      {
        actorId: admin.id,
        action: "SUBASTA_ACTIVADA",
        resourceType: "Auction",
        resourceId: updated.id,
        result: "EXITO",
        detail: {
          previousStatus: auction.status,
          status: "ACTIVA",
          articleStatus: "ASOCIADO_SUBASTA",
          role: "ADMIN_SUBASTAS",
        },
      },
      tx,
    );

    const topBid = auction.bids[0];
    return {
      updated,
      articleTitle: auction.article.title,
      category: auction.article.category,
      highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
      bidCount: auction._count.bids,
    };
  });

  emitAuctionUpdated(txResult.updated.id, {
    auctionId: txResult.updated.id,
    highestBid: txResult.highestBid,
    bidCount: txResult.bidCount,
    status: txResult.updated.status,
    closesAt: txResult.updated.closesAt.toISOString(),
  });

  return {
    id: txResult.updated.id,
    articleId: txResult.updated.articleId,
    articleTitle: txResult.articleTitle,
    category: txResult.category,
    startingPrice: new Prisma.Decimal(txResult.updated.startingPrice).toFixed(2),
    minIncrement: new Prisma.Decimal(txResult.updated.minIncrement).toFixed(2),
    opensAt: txResult.updated.opensAt.toISOString(),
    closesAt: txResult.updated.closesAt.toISOString(),
    status: txResult.updated.status,
    bidCount: txResult.bidCount,
    highestBid: txResult.highestBid,
  };
}

/**
 * Suspende una subasta en estado PROGRAMADA o ACTIVA dejando constancia del motivo obligatorio (RN-040).
 * - Solo ADMIN_SUBASTAS activo.
 * - No modifica ni inventa ofertas previas.
 * - Registra auditoría sin PII y emite actualización en tiempo real.
 */
export async function suspendAuction(
  adminId: string,
  id: string,
  reasonInput: string | { reason?: unknown },
) {
  const normalizedId = id?.trim();
  if (!normalizedId || !SAFE_ID_REGEX.test(normalizedId)) {
    throw new AuctionServiceError(404, "SUBASTA_NO_ENCONTRADA", "La subasta indicada no existe.");
  }

  const rawPayload =
    typeof reasonInput === "string" ? { reason: reasonInput } : (reasonInput ?? {});
  const parsedReason = suspendAuctionSchema.parse(rawPayload);

  const admin = await assertAdminSubastasActor(adminId);

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Auction" WHERE "id" = ${normalizedId} FOR UPDATE`;

    const auction = await tx.auction.findUnique({
      where: { id: normalizedId },
      select: {
        id: true,
        articleId: true,
        startingPrice: true,
        minIncrement: true,
        opensAt: true,
        closesAt: true,
        status: true,
        article: {
          select: {
            id: true,
            ownerId: true,
            title: true,
            category: true,
          },
        },
        bids: {
          orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { amount: true },
        },
        _count: {
          select: { bids: true },
        },
      },
    });

    if (!auction) {
      throw new AuctionServiceError(
        404,
        "SUBASTA_NO_ENCONTRADA",
        "La subasta indicada no existe.",
      );
    }

    if (auction.status !== "PROGRAMADA" && auction.status !== "ACTIVA") {
      throw new AuctionServiceError(
        409,
        "TRANSICION_ESTADO_INVALIDA",
        `Solo se puede suspender una subasta en estado PROGRAMADA o ACTIVA (actual: ${auction.status}).`,
      );
    }

    const updated = await tx.auction.update({
      where: { id: auction.id },
      data: { status: "SUSPENDIDA" },
      select: {
        id: true,
        articleId: true,
        startingPrice: true,
        minIncrement: true,
        opensAt: true,
        closesAt: true,
        status: true,
      },
    });

    await writeAuditEvent(
      {
        actorId: admin.id,
        action: "SUBASTA_SUSPENDIDA",
        resourceType: "Auction",
        resourceId: updated.id,
        result: "EXITO",
        detail: {
          previousStatus: auction.status,
          status: "SUSPENDIDA",
          role: "ADMIN_SUBASTAS",
          reasonLength: parsedReason.reason.length,
        },
      },
      tx,
    );

    const notification = await tx.notification.create({
      data: {
        userId: auction.article.ownerId,
        type: "SUBASTA_SUSPENDIDA",
        title: "Subasta suspendida por administración",
        body: `La subasta del artículo "${auction.article.title}" fue suspendida. Motivo: ${parsedReason.reason}`,
        url: "/mis-subastas",
      },
    });

    const topBid = auction.bids[0];
    return {
      updated,
      articleTitle: auction.article.title,
      category: auction.article.category,
      highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
      bidCount: auction._count.bids,
      notification,
    };
  });

  emitAuctionUpdated(txResult.updated.id, {
    auctionId: txResult.updated.id,
    highestBid: txResult.highestBid,
    bidCount: txResult.bidCount,
    status: txResult.updated.status,
    closesAt: txResult.updated.closesAt.toISOString(),
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
    id: txResult.updated.id,
    articleId: txResult.updated.articleId,
    articleTitle: txResult.articleTitle,
    category: txResult.category,
    startingPrice: new Prisma.Decimal(txResult.updated.startingPrice).toFixed(2),
    minIncrement: new Prisma.Decimal(txResult.updated.minIncrement).toFixed(2),
    opensAt: txResult.updated.opensAt.toISOString(),
    closesAt: txResult.updated.closesAt.toISOString(),
    status: txResult.updated.status,
    bidCount: txResult.bidCount,
    highestBid: txResult.highestBid,
  };
}

/**
 * Lista las subastas asociadas a los artículos de un vendedor (filtradas por Article.ownerId),
 * mostrando exclusivamente estados comerciales y seudónimo del ganador, sin PII de compradores.
 */
export async function listSellerAuctions(ownerId: string): Promise<SellerAuctionItem[]> {
  const normalizedOwnerId = ownerId?.trim();
  if (!normalizedOwnerId || !SAFE_ID_REGEX.test(normalizedOwnerId)) {
    return [];
  }

  const rows = await prisma.auction.findMany({
    where: {
      article: {
        ownerId: normalizedOwnerId,
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      articleId: true,
      startingPrice: true,
      minIncrement: true,
      opensAt: true,
      closesAt: true,
      status: true,
      winnerBidId: true,
      article: {
        select: {
          title: true,
          category: true,
        },
      },
      bids: {
        orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
        select: { id: true, buyerId: true, amount: true },
      },
      aliases: {
        select: { userId: true, alias: true },
      },
    },
  });

  return rows.map((row) => {
    const topBid = row.bids[0];
    const winnerAlias = resolveWinnerAlias({
      status: row.status,
      winnerBidId: row.winnerBidId,
      bids: row.bids,
      aliases: row.aliases,
    });

    return {
      auctionId: row.id,
      articleId: row.articleId,
      articleTitle: row.article.title,
      category: row.article.category,
      startingPrice: new Prisma.Decimal(row.startingPrice).toFixed(2),
      minIncrement: new Prisma.Decimal(row.minIncrement).toFixed(2),
      highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
      bidCount: row.bids.length,
      status: row.status,
      opensAt: row.opensAt.toISOString(),
      closesAt: row.closesAt.toISOString(),
      ...(winnerAlias ? { winnerAlias } : {}),
    };
  });
}

/**
 * Obtiene los contadores operativos para el resumen de administración (/admin).
 */
export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const [
    pendingArticlesCount,
    scheduledAuctionsCount,
    activeAuctionsCount,
    validBidsCount,
  ] = await Promise.all([
    prisma.article.count({ where: { status: "PENDIENTE_REVISION" } }),
    prisma.auction.count({ where: { status: "PROGRAMADA" } }),
    prisma.auction.count({ where: { status: "ACTIVA" } }),
    prisma.bid.count(),
  ]);

  return {
    pendingArticlesCount,
    scheduledAuctionsCount,
    activeAuctionsCount,
    validBidsCount,
  };
}
