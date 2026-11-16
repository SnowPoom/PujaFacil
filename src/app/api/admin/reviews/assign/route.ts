import { assertTrustedOrigin, requireRole } from "@/lib/auth/guards";
import { readJson } from "@/lib/auth/http";
import { assignReview, reviewErrorResponse } from "@/modules/reviews/review-service";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const admin = await requireRole(request, ["ADMIN_SUBASTAS"]);
    const rawBody = await readJson(request);
    const review = await assignReview(admin.id, rawBody);
    return Response.json(
      { ok: true, data: { review } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
