import { prisma } from "@/lib/prisma";
import { assertTrustedOrigin, requireSession } from "@/lib/auth/guards";
import { authErrorResponse, readJson } from "@/lib/auth/http";
import { profileSchema } from "@/lib/auth/schemas";

export async function PATCH(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const user = await requireSession(request);
    const input = profileSchema.parse(await readJson(request));
    const profile = await prisma.user.update({ where: { id: user.id }, data: input, select: { telefono: true, direccion: true } });
    return Response.json({ ok: true, data: profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
