import type { AccountStatus, Prisma, Role } from "@prisma/client";
import type { Server, Socket } from "socket.io";
import { prisma } from "@/lib/prisma";
import { hasValidRoles } from "@/lib/auth/roles";

type Binding = { tokenHash: string; userId: string; expiresAt: Date };
type Account = { userId: string; status: AccountStatus; roles: Role[] };
// El hash no se serializa en socket.data ni se entrega a otros adaptadores/clientes.
declare global {
  var __pfSocketSessionBindings: WeakMap<object, Binding> | undefined;
}
// Next empaqueta los Route Handlers aparte del servidor Node personalizado.
// Compartir el registro permite que logout/reset desconecten esos mismos sockets.
const bindings = globalThis.__pfSocketSessionBindings ??= new WeakMap<object, Binding>();
export function bindSocketSession(socket: object, binding: Binding): void {
  bindings.set(socket, binding);
}
export class SocketSessionError extends Error {
  constructor(public status: 401 | 403, public code: string, message: string, public revoked = true) { super(message); }
}
const invalidSession = () => new SocketSessionError(401, "UNAUTHORIZED", "Sesión no válida.");

/** Orden de locks compatible con reset: User -> Session. DELETE/UPDATE de sesión
 * espera hasta terminar la operación; si revocación ganó, la lectura la rechaza.
 * También bloquea retirada de roles. No usa un snapshot anterior al bloqueo.
 */
export async function withSocketSession<T>(
  socket: object,
  work: (tx: Prisma.TransactionClient, account: Account) => Promise<T> | T,
): Promise<T> {
  const binding = bindings.get(socket);
  if (!binding) throw invalidSession();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${binding.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "tokenHash" = ${binding.tokenHash} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${binding.userId} FOR SHARE`;
    const session = await tx.session.findUnique({ where: { tokenHash: binding.tokenHash }, select: { userId: true, expiresAt: true } });
    if (!session || session.userId !== binding.userId || session.expiresAt <= new Date()) throw invalidSession();
    const user = await tx.user.findUnique({ where: { id: binding.userId }, select: { status: true, roles: { select: { role: true } } } });
    const roles = user?.roles.map(({ role }) => role) ?? [];
    if (!user || user.status === "SUSPENDIDA" || user.status === "CERRADA" || !hasValidRoles(roles)) {
      throw new SocketSessionError(403, "ACCESO_REVOCADO", "Tu cuenta ya no tiene acceso al chat.");
    }
    if (user.status !== "ACTIVA") throw new SocketSessionError(403, "CUENTA_NO_ACTIVA", "Tu cuenta debe estar activa para usar el chat.", false);
    if (session.expiresAt <= new Date()) throw invalidSession();
    const result = await work(tx, { userId: binding.userId, status: user.status, roles });
    // Si caducó durante una operación lenta, se revierte también su escritura.
    if (session.expiresAt <= new Date()) throw invalidSession();
    return result;
  });
}

export function disconnectSocketSessions(io: Server | undefined, match: { tokenHash?: string; userId?: string }): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    const binding = bindings.get(socket);
    if (binding && (match.tokenHash ? binding.tokenHash === match.tokenHash : binding.userId === match.userId)) socket.disconnect(true);
  }
}

export function armSocketSessionExpiry(socket: Socket): void {
  const binding = bindings.get(socket);
  if (!binding) { socket.disconnect(true); return; }
  const expire = () => {
    const remaining = binding.expiresAt.getTime() - Date.now();
    if (remaining <= 0) { socket.disconnect(true); return; }
    timer = setTimeout(expire, Math.min(remaining, 2_147_483_647)); timer.unref();
  };
  let timer: ReturnType<typeof setTimeout>;
  expire();
  socket.once("disconnect", () => clearTimeout(timer));
}

/** Todos los eventos de salas pasan por aquí, incluidos chat/presencia, pujas y
 * notificaciones. La comprobación no es un sondeo: ocurre antes de cada entrega.
 * La entrega síncrona se hace bajo el lock; una revocación concurrente espera.
 */
export async function emitAuthorizedRoom(io: Server, room: string, event: string, payload: unknown): Promise<void> {
  await Promise.all([...io.sockets.sockets.values()].filter((socket) => socket.rooms.has(room)).map(async (socket) => {
    try {
      await withSocketSession(socket, () => {
        if (socket.connected && socket.rooms.has(room)) socket.emit(event, payload);
      });
    } catch (error) {
      // Sin DB o con sesión revocada no se entregan datos. Pendiente puede seguir
      // conectado para activarse, pero no recibe eventos protegidos.
      if (!(error instanceof SocketSessionError) || error.revoked) socket.disconnect(true);
    }
  }));
}
