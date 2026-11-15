import { requireRole } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import { listAccounts } from "@/lib/auth/accounts";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireRole(request, ["ADMIN_SUBASTAS"]);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json({ ok: true, data: await listAccounts(query) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
