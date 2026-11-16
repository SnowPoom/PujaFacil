import { randomBytes } from "node:crypto";
import { Prisma, type AuctionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasValidRoles } from "@/lib/auth/roles";
import { emitAuctionUpdated, type AuctionUpdatedPayload } from "@/lib/realtime";
import { usdAmountSchema } from "@/modules/auctions/auction-schema";

const FALLBACK_ALIAS = "Postor";

export const placeBidSchema = z
  .object({
    amount: usdAmountSchema,
    requestId: z
      .string({ error: "El identificador de la solicitud (requestId) es obligatorio." })
      .trim()
      .min(1, "El identificador de la solicitud (requestId) es obligatorio.")
      .max(100, "El requestId no puede exceder los 100 caracteres."),
  })
  .strict();

export type PlaceBidInput = {
  auctionId: string;
  buyerId: string;
  amount: string;
  requestId: string;
};

export type PlaceBidResult = {
  id: string;
  amount: string;
  auctionId: string;
  acceptedAt: string;
  alias: string;
  idempotent: boolean;
  summary: AuctionUpdatedPayload;
};

export type PublicBidHistoryItem = {
  alias: string;
  amount: string;
  acceptedAt: string;
};

export type PublicAuctionBidsSnapshot = {
  auctionId: string;
  title: string;
  category: string;
  status: AuctionStatus;
  startingPrice: string;
  minIncrement: string;
  highestBid: string | null;
  minNextBid: string;
  bidCount: number;
  opensAt: string;
  closesAt: string;
  items: PublicBidHistoryItem[];
};

export type UserBidItem = {
  id: string;
  auctionId: string;
  auctionTitle: string;
  auctionStatus: AuctionStatus;
  amount: string;
  acceptedAt: string;
  closesAt: string;
  alias: string;
  isLeadingOrWinner: boolean;
};

export class BidError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409,
    public readonly code: string,
    message: string,
    public readonly details?: { minRequired?: string; highestBid?: string | null },
  ) {
    super(message);
    this.name = "BidError";
  }
}

type LockedAuctionRow = {
  id: string;
  articleId: string;
  startingPrice: Prisma.Decimal | string;
  minIncrement: Prisma.Decimal | string;
  opensAt: Date;
  closesAt: Date;
  status: AuctionStatus;
};

function generateAliasCandidate(): string {
  return `Postor-${randomBytes(3).toString("hex")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type AliasClient = Pick<Prisma.TransactionClient, "auctionAlias">;

/**
 * Obtiene o crea el seudónimo `AuctionAlias` único por usuario y subasta (`Postor-xxxxxx`)
 * usando el cliente transaccional o global.
 */
export async function ensureAuctionAliasInClient(
  client: AliasClient,
  auctionId: string,
  userId: string,
): Promise<string> {
  const where = { auctionId_userId: { auctionId, userId } };
  const existing = await client.auctionAlias.findUnique({ where, select: { alias: true } });
  if (existing) return existing.alias;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await client.auctionAlias.create({
        data: { auctionId, userId, alias: generateAliasCandidate() },
        select: { alias: true },
      });
      return created.alias;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await client.auctionAlias.findUnique({ where, select: { alias: true } });
      if (raced) return raced.alias;
    }
  }
  throw new Error("No se pudo generar un seudónimo único para la subasta.");
}

/**
 * Registra una oferta de manera transaccional y consistente en PostgreSQL:
 * - Verifica usuario ACTIVA + COMPRADOR.
 * - Bloquea la fila de `Auction` con `SELECT ... FOR UPDATE` parametrizado (`$queryRaw`).
 * - Verifica que el comprador no sea el propietario del artículo (`OWN_ITEM`).
 * - Verifica que la subasta esté `ACTIVA` y dentro de `opensAt <= serverNow < closesAt` (`AUCTION_NOT_ACTIVE`).
 * - Maneja idempotencia por `(auctionId, buyerId, requestId)`: devuelve la misma oferta si coincide el importe;
 *   lanza 409 `DUPLICATE_REQUEST_CONFLICT` si el importe difiere.
 * - Valida importe con `Prisma.Decimal`: `>= startingPrice` si no hay ofertas, o `>= highestBid + minIncrement` (`BID_TOO_LOW`).
 * - Emite `auction:updated` a la sala `auction:<id>` DESPUÉS de confirmar la transacción.
 */
export async function placeBid(rawInput: PlaceBidInput): Promise<PlaceBidResult> {
  const auctionId = rawInput.auctionId?.trim();
  const buyerId = rawInput.buyerId?.trim();
  if (!auctionId) {
    throw new BidError(400, "SUBASTA_INVALIDA", "El identificador de la subasta es obligatorio.");
  }
  if (!buyerId) {
    throw new BidError(401, "NO_AUTENTICADO", "Inicia sesión para ofertar.");
  }

  const parsedInput = placeBidSchema.safeParse({
    amount: rawInput.amount,
    requestId: rawInput.requestId,
  });
  if (!parsedInput.success) {
    throw new BidError(
      400,
      "MONTO_INVALIDO",
      parsedInput.error.issues[0]?.message ?? "Revisa el importe y los datos de tu oferta.",
    );
  }

  const bidDecimal = new Prisma.Decimal(parsedInput.data.amount);
  const requestId = parsedInput.data.requestId;

  // 1. Verificar en PostgreSQL que la cuenta siga ACTIVA y tenga rol COMPRADOR válido.
  const buyer = await prisma.user.findUnique({
    where: { id: buyerId },
    select: { status: true, roles: { select: { role: true } } },
  });
  const roles = buyer?.roles.map(({ role }) => role) ?? [];
  if (!buyer || buyer.status !== "ACTIVA") {
    throw new BidError(403, "CUENTA_NO_ACTIVA", "Tu cuenta debe estar activa para realizar ofertas.");
  }
  if (!hasValidRoles(roles) || !roles.includes("COMPRADOR")) {
    throw new BidError(403, "ROL_NO_PERMITIDO", "Solo los usuarios con rol COMPRADOR pueden ofertar.");
  }

  // 2. Transacción PostgreSQL con bloqueo de fila SELECT ... FOR UPDATE parametrizado.
  const txResult = await prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<LockedAuctionRow[]>`
      SELECT "id", "articleId", "startingPrice", "minIncrement", "opensAt", "closesAt", "status"
      FROM "Auction"
      WHERE "id" = ${auctionId}
      FOR UPDATE
    `;

    const auction = lockedRows[0];
    if (!auction) {
      throw new BidError(404, "AUCTION_NOT_FOUND", "La subasta solicitada no existe.");
    }

    const article = await tx.article.findUnique({
      where: { id: auction.articleId },
      select: { ownerId: true },
    });
    if (!article) {
      throw new BidError(404, "ARTICLE_NOT_FOUND", "El artículo asociado a la subasta no existe.");
    }
    if (article.ownerId === buyerId) {
      throw new BidError(403, "OWN_ITEM", "No puedes ofertar en una subasta de tu propio artículo.");
    }

    const closesAtDate = new Date(auction.closesAt);
    const opensAtDate = new Date(auction.opensAt);

    // 2.a Idempotencia: comprobar si ya existe una oferta con este (auctionId, buyerId, requestId)
    const existingByRequest = await tx.bid.findUnique({
      where: {
        auctionId_buyerId_requestId: { auctionId, buyerId, requestId },
      },
      select: { id: true, amount: true, acceptedAt: true },
    });

    if (existingByRequest) {
      const existingAmount = new Prisma.Decimal(existingByRequest.amount);
      if (!existingAmount.equals(bidDecimal)) {
        throw new BidError(
          409,
          "DUPLICATE_REQUEST_CONFLICT",
          "El identificador de solicitud (requestId) ya fue utilizado con un importe distinto.",
        );
      }
      const alias = await ensureAuctionAliasInClient(tx, auctionId, buyerId);
      const topBid = await tx.bid.findFirst({
        where: { auctionId },
        orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
        select: { amount: true },
      });
      const bidCount = await tx.bid.count({ where: { auctionId } });
      return {
        id: existingByRequest.id,
        amount: existingAmount.toFixed(2),
        auctionId,
        acceptedAt: existingByRequest.acceptedAt.toISOString(),
        alias,
        idempotent: true,
        summary: {
          auctionId,
          highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
          bidCount,
          status: auction.status,
          closesAt: closesAtDate.toISOString(),
        } satisfies AuctionUpdatedPayload,
      };
    }

    // 2.b Validar estado ACTIVA y ventana horaria oficial del servidor
    const serverNow = new Date();
    if (
      auction.status !== "ACTIVA" ||
      serverNow.getTime() < opensAtDate.getTime() ||
      serverNow.getTime() >= closesAtDate.getTime()
    ) {
      throw new BidError(
        409,
        "AUCTION_NOT_ACTIVE",
        "La subasta no está activa o se encuentra fuera de su horario oficial.",
      );
    }

    // 2.c Consultar mayor oferta vigente dentro del bloqueo y calcular mínimo requerido
    const currentHighest = await tx.bid.findFirst({
      where: { auctionId },
      orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
      select: { id: true, amount: true, buyerId: true },
    });

    const startingPriceDec = new Prisma.Decimal(auction.startingPrice);
    const minIncrementDec = new Prisma.Decimal(auction.minIncrement);
    const highestDec = currentHighest ? new Prisma.Decimal(currentHighest.amount) : null;
    const minRequiredDec = highestDec ? highestDec.plus(minIncrementDec) : startingPriceDec;

    if (bidDecimal.lessThan(minRequiredDec)) {
      throw new BidError(
        409,
        "BID_TOO_LOW",
        `Tu oferta ($${bidDecimal.toFixed(2)}) debe ser de al menos $${minRequiredDec.toFixed(2)} USD.`,
        {
          minRequired: minRequiredDec.toFixed(2),
          highestBid: highestDec ? highestDec.toFixed(2) : null,
        },
      );
    }

    // 2.d Crear/recuperar alias del postor y registrar la nueva oferta
    const alias = await ensureAuctionAliasInClient(tx, auctionId, buyerId);
    const createdBid = await tx.bid.create({
      data: {
        auctionId,
        buyerId,
        amount: bidDecimal.toFixed(2),
        requestId,
      },
      select: { id: true, amount: true, acceptedAt: true },
    });

    const bidCount = await tx.bid.count({ where: { auctionId } });
    const formattedAmount = new Prisma.Decimal(createdBid.amount).toFixed(2);

    return {
      id: createdBid.id,
      amount: formattedAmount,
      auctionId,
      acceptedAt: createdBid.acceptedAt.toISOString(),
      alias,
      idempotent: false,
      summary: {
        auctionId,
        highestBid: formattedAmount,
        bidCount,
        status: auction.status,
        closesAt: closesAtDate.toISOString(),
      } satisfies AuctionUpdatedPayload,
    };
  });

  // 3. Emitir evento WebSocket FUERA de la transacción solo cuando se registró una oferta nueva.
  if (!txResult.idempotent) {
    emitAuctionUpdated(auctionId, txResult.summary);
  }

  return txResult;
}

/**
 * Devuelve el resumen público y el historial de ofertas de una subasta con `{alias, amount, acceptedAt}`
 * sin exponer jamás `buyerId`, `ownerId`, `email` ni nombres reales.
 */
export async function getAuctionBids(auctionId: string): Promise<PublicAuctionBidsSnapshot> {
  const id = auctionId?.trim();
  if (!id) {
    throw new BidError(400, "SUBASTA_INVALIDA", "El identificador de la subasta es obligatorio.");
  }

  const auction = await prisma.auction.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      startingPrice: true,
      minIncrement: true,
      opensAt: true,
      closesAt: true,
      article: { select: { title: true, category: true } },
    },
  });

  if (!auction || auction.status === "BORRADOR") {
    throw new BidError(404, "AUCTION_NOT_FOUND", "La subasta solicitada no existe o no es pública.");
  }

  const [bids, aliases] = await Promise.all([
    prisma.bid.findMany({
      where: { auctionId: id },
      orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
      select: { buyerId: true, amount: true, acceptedAt: true },
    }),
    prisma.auctionAlias.findMany({
      where: { auctionId: id },
      select: { userId: true, alias: true },
    }),
  ]);

  const aliasMap = new Map<string, string>();
  for (const a of aliases) {
    aliasMap.set(a.userId, a.alias);
  }

  const startingPriceDec = new Prisma.Decimal(auction.startingPrice);
  const minIncrementDec = new Prisma.Decimal(auction.minIncrement);
  const highestDec = bids.length > 0 ? new Prisma.Decimal(bids[0].amount) : null;
  const minNextDec = highestDec ? highestDec.plus(minIncrementDec) : startingPriceDec;

  const items: PublicBidHistoryItem[] = bids.map((b) => ({
    alias: aliasMap.get(b.buyerId) ?? FALLBACK_ALIAS,
    amount: new Prisma.Decimal(b.amount).toFixed(2),
    acceptedAt: b.acceptedAt.toISOString(),
  }));

  return {
    auctionId: auction.id,
    title: auction.article.title,
    category: auction.article.category,
    status: auction.status,
    startingPrice: startingPriceDec.toFixed(2),
    minIncrement: minIncrementDec.toFixed(2),
    highestBid: highestDec ? highestDec.toFixed(2) : null,
    minNextBid: minNextDec.toFixed(2),
    bidCount: bids.length,
    opensAt: auction.opensAt.toISOString(),
    closesAt: auction.closesAt.toISOString(),
    items,
  };
}

/**
 * Lista las ofertas realizadas por el usuario titular ordenadas por fecha descendente,
 * con código y título de subasta, monto, fecha y estado, sin revelar identidades de otros postores.
 */
export async function getUserBids(buyerId: string): Promise<UserBidItem[]> {
  const rows = await prisma.bid.findMany({
    where: { buyerId },
    orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      auctionId: true,
      amount: true,
      acceptedAt: true,
      auction: {
        select: {
          status: true,
          closesAt: true,
          winnerBidId: true,
          article: { select: { title: true } },
          bids: {
            orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { id: true },
          },
          aliases: {
            where: { userId: buyerId },
            select: { alias: true },
          },
        },
      },
    },
  });

  return rows.map((row) => {
    const topBidId = row.auction.bids[0]?.id;
    const isLeadingOrWinner =
      row.auction.winnerBidId !== null
        ? row.auction.winnerBidId === row.id
        : topBidId === row.id;

    return {
      id: row.id,
      auctionId: row.auctionId,
      auctionTitle: row.auction.article.title,
      auctionStatus: row.auction.status,
      amount: new Prisma.Decimal(row.amount).toFixed(2),
      acceptedAt: row.acceptedAt.toISOString(),
      closesAt: row.auction.closesAt.toISOString(),
      alias: row.auction.aliases[0]?.alias ?? FALLBACK_ALIAS,
      isLeadingOrWinner,
    };
  });
}
