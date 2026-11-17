import type { AuctionStatus } from "@prisma/client";
import type { Server } from "socket.io";
import { emitAuthorizedRoom } from "@/lib/auth/socket-session";

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

export function emitAuctionUpdated(auctionId: string, payload: AuctionUpdatedPayload): boolean {
  const io = globalThis.__pfSocketIo;
  if (!io) return false;
  void emitAuthorizedRoom(io, `auction:${auctionId}`, "auction:updated", payload).catch(() => {});
  return true;
}

export function emitNotificationToUser(userId: string, payload: NotificationRealtimePayload): boolean {
  const io = globalThis.__pfSocketIo;
  if (!io) return false;
  void emitAuthorizedRoom(io, `user:${userId}`, "notification:new", payload).catch(() => {});
  return true;
}
