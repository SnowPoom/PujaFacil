import { requireRole } from "@/lib/auth/guards";
import { listAssignedReviews, reviewErrorResponse } from "@/modules/reviews/review-service";

export async function GET(request: Request): Promise<Response> {
  try {
    const verifier = await requireRole(request, ["VERIFICADOR"]);
    const items = await listAssignedReviews(verifier.id);
    return Response.json(
      { ok: true, data: { items } },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
