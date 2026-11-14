import { requireSession } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireSession(request);
    return Response.json({ ok: true, data: { user } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
