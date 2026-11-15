import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertTrustedOrigin, AuthError } from "@/lib/auth/guards";
import { authErrorResponse, readJson } from "@/lib/auth/http";
import { loginSchema } from "@/lib/auth/schemas";
import { createUserSession, sessionCookie, sessionUserSelect } from "@/lib/auth/session";
import { hasValidRoles } from "@/lib/auth/roles";
import { writeAuditEvent } from "@/lib/audit";

// Hash válido de coste 12 para ejecutar compare incluso si no existe el correo.
const DUMMY_HASH = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const input = loginSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({ where: { email: input.email }, select: { ...sessionUserSelect, passwordHash: true } });
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      await writeAuditEvent({ action: "LOGIN", resourceType: "User", result: "DENEGADO" });
      throw new AuthError(401, "CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos.");
    }
    if (user.status === "SUSPENDIDA" || user.status === "CERRADA") {
      await writeAuditEvent({ actorId: user.id, action: "LOGIN", resourceType: "User", resourceId: user.id, result: "DENEGADO" });
      throw new AuthError(403, "CUENTA_NO_ACTIVA", "Tu cuenta no tiene acceso. Contacta al administrador.");
    }
    if (!hasValidRoles(user.roles.map(({ role }) => role))) {
      await writeAuditEvent({ actorId: user.id, action: "LOGIN", resourceType: "User", resourceId: user.id, result: "DENEGADO" });
      throw new AuthError(403, "ROLES_INVALIDOS", "Tu cuenta tiene perfiles incompatibles. Contacta al administrador.");
    }
    await writeAuditEvent({ actorId: user.id, action: "LOGIN", resourceType: "User", resourceId: user.id, result: "EXITO" });
    const session = await createUserSession(user.id);
    const publicUser = { id: user.id, nombreCompleto: user.nombreCompleto, email: user.email, status: user.status, roles: user.roles.map(({ role }) => role) };
    return Response.json({ ok: true, data: { user: publicUser } }, { headers: { "Set-Cookie": sessionCookie(session.rawToken, session.expiresAt), "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
