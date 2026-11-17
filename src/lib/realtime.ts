import type { AuctionStatus } from "@prisma/client";
import type { Server } from "socket.io";
import { emitAuthorizedRoom, reportSocketDeliveryFailure } from "@/lib/auth/socket-session";

// Instancia de Socket.IO compartida en el mismo proceso Node de `server.ts`.
// Nunca usar `window`: solo `globalThis` en el servidor.
declare global {
  var __pfSocketIo: Server | undefined;
}

export type AuctionUpdatedPayload = {
  auctionId: string;
  highestBid: string | null;
  bidCount: number;
  status: AuctionStatus;
  closesAt: string;
};

export type NotificationRealtimePayload = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
};

export function setSocketServer(io: Server): void {
  globalThis.__pfSocketIo = io;
}

export function getSocketServer(): Server | undefined {
  return globalThis.__pfSocketIo;
}

/** true: emisión asíncrona programada con servidor disponible; false: no hay
 * servidor. No confirma recepción del cliente. Los fallos posteriores se registran
 * sin revertir la operación comercial que ya fue confirmada en PostgreSQL.
 */
export function emitAuctionUpdated(auctionId: string, payload: AuctionUpdatedPayload): boolean {
  const io = globalThis.__pfSocketIo;
  if (!io) return false;
  void emitAuthorizedRoom(io, `auction:${auctionId}`, "auction:updated", payload)
    .catch(() => reportSocketDeliveryFailure("auction:updated"));
  return true;
}

/** Mismo contrato de programación que emitAuctionUpdated; la notificación
 * persistida sigue disponible por HTTP aunque falle el aviso en tiempo real.
 */
export function emitNotificationToUser(userId: string, payload: NotificationRealtimePayload): boolean {
  const io = globalThis.__pfSocketIo;
  if (!io) return false;
  void emitAuthorizedRoom(io, `user:${userId}`, "notification:new", payload)
    .catch(() => reportSocketDeliveryFailure("notification:new"));
  return true;
}
