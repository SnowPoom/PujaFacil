import { assertTrustedOrigin, requireRole } from "@/lib/auth/guards";
import { activateAuction, auctionErrorResponse } from "@/modules/auctions/auction-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const admin = await requireRole(request, ["ADMIN_SUBASTAS"]);
    const { id } = await params;
    const data = await activateAuction(admin.id, id);
    return Response.json(
      { ok: true, data },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return auctionErrorResponse(error);
  }
}
