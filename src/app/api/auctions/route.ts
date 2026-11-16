import { assertTrustedOrigin, requireRole } from "@/lib/auth/guards";
import { readJson } from "@/lib/auth/http";
import {
  auctionErrorResponse,
  createAuction,
  listPublicAuctions,
} from "@/modules/auctions/auction-service";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const data = await listPublicAuctions({
      status: searchParams.get("status") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });
    return Response.json(
      { ok: true, data },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return auctionErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const admin = await requireRole(request, ["ADMIN_SUBASTAS"]);
    const rawBody = await readJson(request);
    const data = await createAuction(admin.id, rawBody);
    return Response.json(
      { ok: true, data },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return auctionErrorResponse(error);
  }
}
