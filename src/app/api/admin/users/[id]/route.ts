import { requireRole } from "@/lib/auth/guards";
import { openAccountReview, accountReviewErrorResponse } from "@/lib/auth/account-review";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const actor = await requireRole(request, ["ADMIN_SUBASTAS"]);
    const { id } = await params;
    return Response.json({ ok: true, data: await openAccountReview(actor.id, id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return accountReviewErrorResponse(error); }
}
