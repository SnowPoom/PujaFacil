import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertTrustedOrigin } from "@/lib/auth/guards";
import { authErrorResponse, readJson } from "@/lib/auth/http";
import { resetSchema } from "@/lib/auth/schemas";
import { hashToken, sessionCookie } from "@/lib/auth/session";
import { getSocketServer } from "@/lib/realtime";
import { disconnectSocketSessions } from "@/lib/auth/socket-session";

class InvalidReset extends Error {}
export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const { token, newPassword } = resetSchema.parse(await readJson(request));
    const tokenHash = hashToken(token);
    const reset = await prisma.passwordReset.findUnique({ where: { tokenHash }, select: { id: true, userId: true, usedAt: true, expiresAt: true } });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date()) throw new InvalidReset();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction(async (tx) => {
      // Reclamo condicional: dos solicitudes simultáneas no pueden consumir el mismo token.
      const now = new Date();
      const claimed = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claimed.count !== 1) throw new InvalidReset();
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: reset.userId } });
      await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: now } });
    });
    disconnectSocketSessions(getSocketServer(), { userId: reset.userId });
    return Response.json({ ok: true, data: { message: "Contraseña actualizada. Inicia sesión con tu nueva contraseña." } },
      { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", new Date(0)) } });
  } catch (error) {
    if (error instanceof InvalidReset) return Response.json({ ok: false, error: { code: "TOKEN_INVALIDO", message: "El enlace no es válido, ya se utilizó o caducó. Solicita uno nuevo." } }, { status: 400 });
    return authErrorResponse(error);
  }
}
