import { assertTrustedOrigin, requireActive, requireRole } from "@/lib/auth/guards";
import { authErrorResponse, readJson } from "@/lib/auth/http";
import { BidError, getAuctionBids, placeBid, placeBidSchema } from "@/modules/bids/bid-service";

type AuctionBidsRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/auctions/[id]/bids
 * Historial público de ofertas de la subasta con `{ alias, amount, acceptedAt }`
 * y resumen de precios actuales, sin exponer jamás `userId` ni datos personales.
 */
export async function GET(_request: Request, context: AuctionBidsRouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const snapshot = await getAuctionBids(id);
    return Response.json(
      { ok: true, data: snapshot },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof BidError) {
      return Response.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return authErrorResponse(error);
  }
}

/**
 * POST /api/auctions/[id]/bids
 * Registra una oferta de un comprador activo:
 * - Valida CSRF (`assertTrustedOrigin`), cuenta activa (`requireActive`) y rol `COMPRADOR` (`requireRole`).
 * - Valida JSON `{ amount: "151.00", requestId: "uuid" }`.
 * - Ejecuta `placeBid` transaccional y responde `{ ok: true, data: { id, amount, auctionId, acceptedAt, alias } }`.
 */
export async function POST(request: Request, context: AuctionBidsRouteContext): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    await requireActive(request);
    const user = await requireRole(request, ["COMPRADOR"]);

    const { id: auctionId } = await context.params;
    const input = placeBidSchema.parse(await readJson(request));

    const result = await placeBid({
      auctionId,
      buyerId: user.id,
      amount: input.amount,
      requestId: input.requestId,
    });

    return Response.json(
      {
        ok: true,
        data: {
          id: result.id,
          amount: result.amount,
          auctionId: result.auctionId,
          acceptedAt: result.acceptedAt,
          alias: result.alias,
        },
      },
      {
        status: result.idempotent ? 200 : 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof BidError) {
      return Response.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return authErrorResponse(error);
  }
}
