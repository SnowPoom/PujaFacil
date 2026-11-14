import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertTrustedOrigin, AuthError } from "@/lib/auth/guards";
import { authErrorResponse, readJson } from "@/lib/auth/http";
import { loginSchema } from "@/lib/auth/schemas";
import { createUserSession, sessionCookie, sessionUserSelect } from "@/lib/auth/session";

// Hash válido de coste 12 para ejecutar compare incluso si no existe el correo.
const DUMMY_HASH = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const input = loginSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({ where: { email: input.email }, select: { ...sessionUserSelect, passwordHash: true } });
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new AuthError(401, "CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos.");
    if (user.status === "SUSPENDIDA" || user.status === "CERRADA") throw new AuthError(403, "CUENTA_NO_ACTIVA", "Tu cuenta no tiene acceso. Contacta al administrador.");
    const session = await createUserSession(user.id);
    const publicUser = { id: user.id, nombreCompleto: user.nombreCompleto, email: user.email, status: user.status, roles: user.roles.map(({ role }) => role) };
    return Response.json({ ok: true, data: { user: publicUser } }, { headers: { "Set-Cookie": sessionCookie(session.rawToken, session.expiresAt), "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
