import { assertTrustedOrigin } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import { deleteSessionFromRawToken, readSessionToken, sessionCookie } from "@/lib/auth/session";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const token = readSessionToken(request.headers.get("cookie") ?? undefined);
    if (token) await deleteSessionFromRawToken(token);
    return Response.json({ ok: true, data: null }, { headers: { "Set-Cookie": sessionCookie("", new Date(0)), "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
