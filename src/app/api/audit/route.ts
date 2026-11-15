import { requireRole } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import { listAuditEvents } from "@/lib/audit";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireRole(request, ["AUDITOR"]);
    const query = new URL(request.url).searchParams;
    const data = await listAuditEvents({
      page: query.get("page") ?? undefined, pageSize: query.get("pageSize") ?? undefined,
      action: query.get("action") || undefined,
    });
    return Response.json({ ok: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
