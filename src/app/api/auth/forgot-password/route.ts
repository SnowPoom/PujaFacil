import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertTrustedOrigin } from "@/lib/auth/guards";
import { authErrorResponse, readJson } from "@/lib/auth/http";
import { forgotSchema } from "@/lib/auth/schemas";
import { hashToken } from "@/lib/auth/session";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const { email } = forgotSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const token = randomBytes(32).toString("hex");
      await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600000) } });
      if (process.env.NODE_ENV === "development" || process.env.PASSWORD_RESET_DELIVERY === "console") {
        console.log(`[auth] Recuperación: ${new URL(`/restablecer-clave?token=${token}`, request.url).href}`);
      }
    }
    return Response.json({ ok: true, data: { message: "Si existe una cuenta con ese correo, se ha generado un enlace de recuperación válido por 10 minutos." } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
