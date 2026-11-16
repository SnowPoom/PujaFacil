import { assertTrustedOrigin, requireRole } from "@/lib/auth/guards";
import { readJson } from "@/lib/auth/http";
import { auctionErrorResponse, suspendAuction } from "@/modules/auctions/auction-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const admin = await requireRole(request, ["ADMIN_SUBASTAS"]);
    const { id } = await params;
    const rawBody = await readJson(request);
    const data = await suspendAuction(
      admin.id,
      id,
      rawBody as string | { reason?: unknown },
    );
    return Response.json(
      { ok: true, data },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return auctionErrorResponse(error);
  }
}
