import { Prisma, type AuctionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitAuctionUpdated, type AuctionUpdatedPayload } from "@/lib/realtime";
import { notifyUser } from "@/modules/notifications/notification-service";

type LockedAuctionForClose = {
  id: string;
  articleId: string;
  opensAt: Date;
  closesAt: Date;
  status: AuctionStatus;
  winnerBidId: string | null;
  closedAt: Date | null;
};

export type ClosedAuctionSummary = {
  auctionId: string;
  status: "ADJUDICADA" | "CERRADA_SIN_OFERTAS";
  winnerBidId: string | null;
  winnerBuyerId: string | null;
  highestBid: string | null;
  bidCount: number;
  closedAt: string;
};

export type ActivatedAuctionSummary = {
  auctionId: string;
  status: "ACTIVA";
  opensAt: string;
  closesAt: string;
};

/**
 * Cierra de forma transaccional e idempotente todas las subastas con `status = 'ACTIVA'`
 * cuyo `closesAt <= serverNow`:
 * - Bloquea cada fila de `"Auction"` con `SELECT ... FOR UPDATE` parametrizado.
 * - Selecciona la oferta mayor válida (monto descendente, `acceptedAt` ascendente, `id` ascendente como desempate).
 * - Si no hay ofertas -> `CERRADA_SIN_OFERTAS`; si hay -> `ADJUDICADA` y `winnerBidId`.
 * - Guarda `closedAt`; idempotente (no adjudica dos veces si ya cambió de estado).
 * - Fuera de la transacción emite `auction:updated` y notifica al ganador y al vendedor (sin orden de pago en 1B).
 */
export async function closeDueAuctions(serverNow: Date = new Date()): Promise<ClosedAuctionSummary[]> {
  const dueCandidates = await prisma.auction.findMany({
    where: {
      status: "ACTIVA",
      closesAt: { lte: serverNow },
    },
    select: { id: true },
  });

  const closedResults: ClosedAuctionSummary[] = [];

  for (const candidate of dueCandidates) {
    const outcome = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<LockedAuctionForClose[]>`
        SELECT "id", "articleId", "opensAt", "closesAt", "status", "winnerBidId", "closedAt"
        FROM "Auction"
        WHERE "id" = ${candidate.id}
        FOR UPDATE
      `;

      const auction = lockedRows[0];
      if (!auction) return null;

      const closesAtDate = new Date(auction.closesAt);
      // Idempotencia: si ya fue cerrada/adjudicada o aún no venció según el reloj del servidor, omitir.
      if (auction.status !== "ACTIVA" || closesAtDate.getTime() > serverNow.getTime()) {
        return null;
      }

      const winningBid = await tx.bid.findFirst({
        where: { auctionId: auction.id },
        orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
        select: { id: true, buyerId: true, amount: true },
      });

      const bidCount = await tx.bid.count({ where: { auctionId: auction.id } });
      const article = await tx.article.findUnique({
        where: { id: auction.articleId },
        select: { ownerId: true, title: true },
      });

      const nextStatus: "ADJUDICADA" | "CERRADA_SIN_OFERTAS" = winningBid
        ? "ADJUDICADA"
        : "CERRADA_SIN_OFERTAS";
      const winnerBidId = winningBid ? winningBid.id : null;
      const highestBid = winningBid ? new Prisma.Decimal(winningBid.amount).toFixed(2) : null;

      await tx.auction.update({
        where: { id: auction.id },
        data: {
          status: nextStatus,
          winnerBidId,
          closedAt: serverNow,
        },
      });

      return {
        auctionId: auction.id,
        status: nextStatus,
        winnerBidId,
        winnerBuyerId: winningBid ? winningBid.buyerId : null,
        sellerId: article?.ownerId ?? null,
        articleTitle: article?.title ?? `Subasta #${auction.id}`,
        highestBid,
        bidCount,
        closesAtIso: closesAtDate.toISOString(),
        closedAtIso: serverNow.toISOString(),
      };
    });

    if (!outcome) continue;

    const realtimePayload: AuctionUpdatedPayload = {
      auctionId: outcome.auctionId,
      highestBid: outcome.highestBid,
      bidCount: outcome.bidCount,
      status: outcome.status,
      closesAt: outcome.closesAtIso,
    };
    emitAuctionUpdated(outcome.auctionId, realtimePayload);

    if (outcome.status === "ADJUDICADA" && outcome.winnerBuyerId && outcome.highestBid) {
      try {
        await notifyUser({
          userId: outcome.winnerBuyerId,
          type: "AUCTION_WON",
          title: "¡Ganaste la subasta!",
          body: `Tu oferta de $${outcome.highestBid} USD resultó adjudicada en «${outcome.articleTitle}».`,
          url: `/subastas/${outcome.auctionId}`,
        });
      } catch {
        // No revertir el cierre si falla el aviso.
      }
    }

    if (outcome.sellerId) {
      try {
        const bodyText =
          outcome.status === "ADJUDICADA" && outcome.highestBid
            ? `La subasta de «${outcome.articleTitle}» finalizó como ADJUDICADA por $${outcome.highestBid} USD.`
            : `La subasta de «${outcome.articleTitle}» finalizó sin ofertas registradas.`;
        await notifyUser({
          userId: outcome.sellerId,
          type: "AUCTION_CLOSED",
          title: "Subasta finalizada",
          body: bodyText,
          url: `/subastas/${outcome.auctionId}`,
        });
      } catch {
        // No revertir el cierre si falla el aviso.
      }
    }

    closedResults.push({
      auctionId: outcome.auctionId,
      status: outcome.status,
      winnerBidId: outcome.winnerBidId,
      winnerBuyerId: outcome.winnerBuyerId,
      highestBid: outcome.highestBid,
      bidCount: outcome.bidCount,
      closedAt: outcome.closedAtIso,
    });
  }

  return closedResults;
}

/**
 * Transiciona de forma transaccional `PROGRAMADA -> ACTIVA` cuando la hora del servidor
 * alcanzó `opensAt` (`opensAt <= serverNow < closesAt`) y emite `auction:updated`.
 */
export async function activateDueAuctions(
  serverNow: Date = new Date(),
): Promise<ActivatedAuctionSummary[]> {
  const dueScheduled = await prisma.auction.findMany({
    where: {
      status: "PROGRAMADA",
      opensAt: { lte: serverNow },
      closesAt: { gt: serverNow },
    },
    select: { id: true },
  });

  const activated: ActivatedAuctionSummary[] = [];

  for (const candidate of dueScheduled) {
    const outcome = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<LockedAuctionForClose[]>`
        SELECT "id", "articleId", "opensAt", "closesAt", "status", "winnerBidId", "closedAt"
        FROM "Auction"
        WHERE "id" = ${candidate.id}
        FOR UPDATE
      `;

      const auction = lockedRows[0];
      if (!auction) return null;

      const opensAtDate = new Date(auction.opensAt);
      const closesAtDate = new Date(auction.closesAt);
      if (
        auction.status !== "PROGRAMADA" ||
        opensAtDate.getTime() > serverNow.getTime() ||
        closesAtDate.getTime() <= serverNow.getTime()
      ) {
        return null;
      }

      await tx.auction.update({
        where: { id: auction.id },
        data: { status: "ACTIVA" },
      });

      const topBid = await tx.bid.findFirst({
        where: { auctionId: auction.id },
        orderBy: [{ amount: "desc" }, { acceptedAt: "asc" }, { id: "asc" }],
        select: { amount: true },
      });
      const bidCount = await tx.bid.count({ where: { auctionId: auction.id } });

      return {
        auctionId: auction.id,
        highestBid: topBid ? new Prisma.Decimal(topBid.amount).toFixed(2) : null,
        bidCount,
        opensAtIso: opensAtDate.toISOString(),
        closesAtIso: closesAtDate.toISOString(),
      };
    });

    if (!outcome) continue;

    emitAuctionUpdated(outcome.auctionId, {
      auctionId: outcome.auctionId,
      highestBid: outcome.highestBid,
      bidCount: outcome.bidCount,
      status: "ACTIVA",
      closesAt: outcome.closesAtIso,
    });

    activated.push({
      auctionId: outcome.auctionId,
      status: "ACTIVA",
      opensAt: outcome.opensAtIso,
      closesAt: outcome.closesAtIso,
    });
  }

  return activated;
}
