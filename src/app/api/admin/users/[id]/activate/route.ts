import { assertTrustedOrigin, requireRole } from "@/lib/auth/guards";
import { readJson } from "@/lib/auth/http";
import { activateReviewedAccount, activationSchema, accountReviewErrorResponse } from "@/lib/auth/account-review";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const actor = await requireRole(request, ["ADMIN_SUBASTAS"]);
    const { id } = await params;
    const input = activationSchema.parse(await readJson(request));
    const data = await activateReviewedAccount(actor.id, id, input);
    return Response.json({ ok: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return accountReviewErrorResponse(error); }
}
