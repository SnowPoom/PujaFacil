import type { AccountStatus, Prisma, Role } from "@prisma/client";
import type { Server, Socket } from "socket.io";
import { prisma } from "@/lib/prisma";
import { hasValidRoles } from "@/lib/auth/roles";

type Binding = { tokenHash: string; userId: string; expiresAt: Date };
type Account = { userId: string; status: AccountStatus; roles: Role[] };
export type ProtectedSocketEvent = "chat:new" | "chat:presence" | "auction:updated" | "notification:new";
export type RoomEmissionResult = { sent: number; skipped: number; failed: number };

// Solo códigos de eventos internos y cantidades: nunca payload, identidad,
// cookie, hash de sesión ni el error completo de Prisma.
export function reportSocketDeliveryFailure(event: ProtectedSocketEvent, failed = 1): void {
  console.error("[realtime] ENTREGA_NO_DISPONIBLE", { event, failed });
}
// El hash no se serializa en socket.data ni se entrega a otros adaptadores/clientes.
declare global {
  var __pfSocketSessionBindings: WeakMap<object, Binding> | undefined;
  var __pfSocketDeliveryQueues: WeakMap<object, Promise<void>> | undefined;
}
// Next empaqueta los Route Handlers aparte del servidor Node personalizado.
// Compartir el registro permite que logout/reset desconecten esos mismos sockets.
const bindings = globalThis.__pfSocketSessionBindings ??= new WeakMap<object, Binding>();
const deliveryQueues = globalThis.__pfSocketDeliveryQueues ??= new WeakMap<object, Promise<void>>();

function deliverInOrder(socket: object, work: () => Promise<void>): Promise<void> {
  const previous = deliveryQueues.get(socket);
  // Un fallo se informa en su emisor; no debe bloquear eventos posteriores.
  // El registro es compartido también por los emisores de los Route Handlers.
  const current = previous ? previous.then(work, work) : work();
  deliveryQueues.set(socket, current);
  const release = () => { if (deliveryQueues.get(socket) === current) deliveryQueues.delete(socket); };
  void current.then(release, release);
  return current;
}
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
export async function emitAuthorizedRoom(io: Server, room: string, event: ProtectedSocketEvent, payload: unknown): Promise<RoomEmissionResult> {
  // sent significa despachado a Socket.IO, no un ACK de recepción del cliente.
  const result: RoomEmissionResult = { sent: 0, skipped: 0, failed: 0 };
  await Promise.all([...io.sockets.sockets.values()].filter((socket) => socket.rooms.has(room)).map((socket) => deliverInOrder(socket, async () => {
    // Una espera en la cola no conserva ni membresía ni autorización antiguas.
    if (!socket.connected || !socket.rooms.has(room)) { result.skipped++; return; }
    let dispatched = false;
    try {
      await withSocketSession(socket, () => {
        if (socket.connected && socket.rooms.has(room)) {
          socket.emit(event, payload);
          dispatched = true;
          result.sent++;
        } else result.skipped++;
      });
    } catch (error) {
      // Sin DB o con sesión revocada no se entregan datos. Pendiente puede seguir
      // conectado para activarse, pero no recibe eventos protegidos.
      if (error instanceof SocketSessionError) {
        if (!dispatched) result.skipped++;
      }
      else result.failed++;
      if (!(error instanceof SocketSessionError) || error.revoked) socket.disconnect(true);
    }
  })));
  // Las denegaciones esperadas son distintas a perder una entrega por un fallo.
  if (result.failed) reportSocketDeliveryFailure(event, result.failed);
  return result;
}
