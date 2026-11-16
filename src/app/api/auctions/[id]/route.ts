import { auctionErrorResponse, getPublicAuction } from "@/modules/auctions/auction-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const data = await getPublicAuction(id);
    return Response.json(
      { ok: true, data },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return auctionErrorResponse(error);
  }
}
