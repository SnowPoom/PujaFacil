import { requireActive, requireRole } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import { BidError, getUserBids } from "@/modules/bids/bid-service";

/**
 * GET /api/me/bids
 * Devuelve las ofertas realizadas por el titular activo (`COMPRADOR`),
 * ordenadas por fecha descendente, con código/título de subasta, monto, fecha y estado,
 * sin revelar jamás la identidad de otros postores.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireActive(request);
    const user = await requireRole(request, ["COMPRADOR"]);
    const items = await getUserBids(user.id);

    return Response.json(
      { ok: true, data: { items } },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof BidError) {
      return Response.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return authErrorResponse(error);
  }
}
