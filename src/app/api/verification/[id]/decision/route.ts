import { assertTrustedOrigin, requireRole } from "@/lib/auth/guards";
import { readJson } from "@/lib/auth/http";
import { decideReview, reviewErrorResponse } from "@/modules/reviews/review-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const verifier = await requireRole(request, ["VERIFICADOR"]);
    const { id } = await params;
    const rawBody = await readJson(request);
    const data = await decideReview(verifier.id, id, rawBody);
    return Response.json(
      { ok: true, data },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return reviewErrorResponse(error);
  }
}
