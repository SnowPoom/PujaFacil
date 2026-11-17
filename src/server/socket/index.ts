import type { AccountStatus, Role } from "@prisma/client";
import type { Server, Socket } from "socket.io";
import { ZodError } from "zod";
import { getSessionFromCookieHeader } from "@/lib/auth/session";
import { armSocketSessionExpiry, bindSocketSession, emitAuthorizedRoom, reportSocketDeliveryFailure, SocketSessionError, withSocketSession } from "@/lib/auth/socket-session";
import { setSocketServer } from "@/lib/realtime";
import { activateDueAuctions, closeDueAuctions } from "@/modules/bids/auction-closer";
import { chatJoinSchema, chatSendSchema, type ChatMessageDto } from "@/modules/chat/chat-rules";
import { ChatError, saveMessage, validateRoomAccess } from "@/modules/chat/chat-service";

export const AUCTION_SCHEDULER_INTERVAL_MS = 10_000;

declare global {
  var __pfAuctionSchedulerTimer: ReturnType<typeof setInterval> | undefined;
  var __pfAuctionSchedulerRunning: boolean | undefined;
}

export type SocketUserData = {
  userId: string;
  roles: Role[];
  status: AccountStatus;
};

export type SocketAckError = {
  status: 400 | 401 | 403 | 404 | 409 | 500;
  code: string;
  message: string;
};

export type ChatJoinAck =
  | { ok: true; room: string; count: number }
  | { ok: false; error: SocketAckError };

export type ChatSendAck =
  | { ok: true; clientMessageId: string; message: ChatMessageDto }
  | { ok: false; error: SocketAckError };

function replyAck<T>(ack: unknown, payload: T): void {
  if (typeof ack === "function") {
    ack(payload);
  }
}

/**
 * Middleware de handshake de Socket.IO:
 * - Lee `pf_session` con el mismo resolver de sesiones usado por HTTP.
 * - Exige sesión válida y usuario no suspendido ni cerrado.
 * - Guarda `{ userId, roles, status }` en `socket.data` solo en memoria del servidor.
 * - Si no está autorizado, llama a `next(new Error("UNAUTHORIZED"))`.
 */
export async function authenticateSocketHandshake(
  socket: Pick<Socket, "handshake" | "data">,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const cookieHeader = socket.handshake.headers?.cookie;
    const session = await getSessionFromCookieHeader(cookieHeader);
    if (!session) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    const { user } = session;
    bindSocketSession(socket, { tokenHash: session.tokenHash, userId: user.id, expiresAt: session.expiresAt });
    // La credencial original ya no es necesaria después del handshake.
    delete socket.handshake.headers.cookie;
    const socketData: SocketUserData = {
      userId: user.id,
      roles: user.roles,
      status: user.status,
    };
    socket.data = socketData;
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
}

export type RevalidateSocketResult =
  | { ok: true; userId: string; roles: Role[]; status: AccountStatus }
  | { ok: false; error: SocketAckError; disconnected: boolean };

/**
 * Revalida en PostgreSQL antes de cada evento sensible (`chat:join`, `chat:send`):
 * - Comprueba la sesión original de la conexión, su vigencia y revocación.
 * - Comprueba que la cuenta siga `ACTIVA` y conserve roles válidos.
 * - Si el acceso fue revocado (suspendida/cerrada/sin usuario), desconecta el socket.
 */
export async function revalidateSocketAccount(
  socket: Pick<Socket, "data" | "disconnect">,
): Promise<RevalidateSocketResult> {
  const userId = (socket.data as Partial<SocketUserData> | undefined)?.userId;
  if (!userId) {
    socket.disconnect(true);
    return {
      ok: false,
      error: { status: 401, code: "UNAUTHORIZED", message: "Sesión no válida." },
      disconnected: true,
    };
  }
  try {
    return await withSocketSession(socket, (_tx, account) => {
      socket.data = { userId: account.userId, roles: account.roles, status: account.status } satisfies SocketUserData;
      return { ok: true as const, userId: account.userId, roles: account.roles, status: account.status };
    });
  } catch (err) {
    if (err instanceof SocketSessionError) {
      if (err.revoked) {
        socket.disconnect(true);
      }
      return {
        ok: false,
        error: { status: err.status, code: err.code, message: err.message },
        disconnected: err.revoked,
      };
    }
    socket.disconnect(true);
    return {
      ok: false,
      error: { status: 403, code: "ERROR_AUTORIZACION", message: "No se pudo verificar tu cuenta." },
      disconnected: true,
    };
  }
}

export function isChatRoom(room: string): boolean {
  return room === "general" || room.startsWith("auction:");
}

/**
 * Cuenta usuarios distintos por `socket.data.userId` presentes en la sala (no pestañas/sockets).
 * Opcionalmente excluye un socketId (útil durante `disconnecting` antes de que abandone las salas).
 */
export async function countDistinctRoomUsers(
  io: Server,
  room: string,
  excludeSocketId?: string,
): Promise<number> {
  const sockets = await io.in(room).fetchSockets();
  const uniqueUsers = new Set<string>();
  for (const s of sockets) {
    if (excludeSocketId && s.id === excludeSocketId) continue;
    const uid = (s.data as Partial<SocketUserData> | undefined)?.userId;
    if (uid) uniqueUsers.add(uid);
  }
  return uniqueUsers.size;
}

export async function emitRoomPresence(
  io: Server,
  room: string,
  excludeSocketId?: string,
): Promise<number> {
  const count = await countDistinctRoomUsers(io, room, excludeSocketId);
  await emitAuthorizedRoom(io, room, "chat:presence", { room, count });
  return count;
}

function mapErrorToSocketAckError(err: unknown): SocketAckError {
  if (err instanceof ChatError || err instanceof SocketSessionError) {
    return { status: err.status, code: err.code, message: err.message };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: "DATOS_INVALIDOS",
      message: err.issues[0]?.message ?? "Datos de solicitud no válidos.",
    };
  }
  return {
    status: 500,
    code: "ERROR_INTERNO",
    message: "No se pudo procesar la operación en el chat.",
  };
}

export async function handleChatJoin(
  io: Server,
  socket: Socket,
  payload: unknown,
  ack?: (response: ChatJoinAck) => void,
): Promise<void> {
  const revalidated = await revalidateSocketAccount(socket);
  if (!revalidated.ok) {
    replyAck(ack, { ok: false, error: revalidated.error });
    return;
  }

  try {
    const input = chatJoinSchema.parse(payload);
    const parsed = await withSocketSession(socket, async (tx) => {
      const room = await validateRoomAccess(input.room, "read", tx);
      await socket.join(room.room);
      return room;
    });

    // Si estaba en otra sala de chat distinta, salir de ella y actualizar su presencia.
    const previousChatRooms = [...socket.rooms].filter(
      (r) => r !== socket.id && isChatRoom(r) && r !== parsed.room,
    );
    for (const prevRoom of previousChatRooms) {
      await socket.leave(prevRoom);
      await emitRoomPresence(io, prevRoom);
    }

    const count = await emitRoomPresence(io, parsed.room);
    await withSocketSession(socket, () => replyAck(ack, { ok: true, room: parsed.room, count }));
  } catch (err) {
    if (err instanceof SocketSessionError && err.revoked) socket.disconnect(true);
    replyAck(ack, { ok: false, error: mapErrorToSocketAckError(err) });
  }
}

export async function handleChatSend(
  io: Server,
  socket: Socket,
  payload: unknown,
  ack?: (response: ChatSendAck) => void,
): Promise<void> {
  const revalidated = await revalidateSocketAccount(socket);
  if (!revalidated.ok) {
    replyAck(ack, { ok: false, error: revalidated.error });
    return;
  }

  try {
    const input = chatSendSchema.parse(payload);
    if (!socket.rooms.has(input.room)) {
      replyAck(ack, {
        ok: false,
        error: {
          status: 403,
          code: "NO_UNIDO_A_SALA",
          message: "Debes unirte a la sala antes de enviar mensajes.",
        },
      });
      return;
    }

    // Persiste en PostgreSQL ANTES de emitir chat:new (con alias seguro, sin email/nombre/userId).
    const message = await withSocketSession(socket, async (tx, account) => {
      if (!socket.rooms.has(input.room)) throw new ChatError(403, "NO_UNIDO_A_SALA", "Debes unirte a la sala antes de enviar mensajes.");
      return saveMessage({ room: input.room, authorId: account.userId, text: input.text }, tx);
    });

    await emitAuthorizedRoom(io, message.room, "chat:new", message);
    await withSocketSession(socket, () => replyAck(ack, { ok: true, clientMessageId: input.clientMessageId, message }));
  } catch (err) {
    if (err instanceof SocketSessionError && err.revoked) socket.disconnect(true);
    replyAck(ack, { ok: false, error: mapErrorToSocketAckError(err) });
  }
}

export async function runAuctionLifecycleTick(): Promise<void> {
  if (globalThis.__pfAuctionSchedulerRunning) return;
  globalThis.__pfAuctionSchedulerRunning = true;
  try {
    await activateDueAuctions();
    await closeDueAuctions();
  } catch {
    // Evitar que un fallo transitorio de conexión tumbe el proceso del servidor.
  } finally {
    globalThis.__pfAuctionSchedulerRunning = false;
  }
}

export function stopAuctionScheduler(): void {
  if (globalThis.__pfAuctionSchedulerTimer) {
    clearInterval(globalThis.__pfAuctionSchedulerTimer);
    globalThis.__pfAuctionSchedulerTimer = undefined;
  }
  globalThis.__pfAuctionSchedulerRunning = false;
}

/**
 * Registra un ÚNICO intervalo cada 10 s a nivel de servidor (nunca por conexión de cliente)
 * para activar subastas programadas vencidas y cerrar/adjudicar subastas activas vencidas,
 * limpiándolo automáticamente cuando se cierra el servidor HTTP/HTTPS.
 */
export function startAuctionScheduler(io: Server): ReturnType<typeof setInterval> {
  stopAuctionScheduler();
  const timer = setInterval(() => {
    void runAuctionLifecycleTick();
  }, AUCTION_SCHEDULER_INTERVAL_MS);
  timer.unref?.();
  globalThis.__pfAuctionSchedulerTimer = timer;

  const httpServer = (io as unknown as { httpServer?: { once?: (ev: string, fn: () => void) => void } })
    .httpServer;
  if (httpServer && typeof httpServer.once === "function") {
    httpServer.once("close", () => {
      stopAuctionScheduler();
    });
  }

  return timer;
}

export function registerSocketHandlers(io: Server): void {
  setSocketServer(io);
  startAuctionScheduler(io);
  io.use(authenticateSocketHandshake);

  io.on("connection", (socket) => {
    const data = socket.data as Partial<SocketUserData> | undefined;
    if (!data?.userId) {
      socket.disconnect(true);
      return;
    }
    armSocketSessionExpiry(socket);

    // Sala privada del usuario en el servidor (el cliente no puede unirse a la de otro usuario).
    void socket.join(`user:${data.userId}`);

    socket.on("chat:join", (payload: unknown, ack?: (response: ChatJoinAck) => void) => {
      void handleChatJoin(io, socket, payload, ack);
    });

    socket.on("chat:send", (payload: unknown, ack?: (response: ChatSendAck) => void) => {
      void handleChatSend(io, socket, payload, ack);
    });

    socket.on("disconnecting", () => {
      const chatRooms = [...socket.rooms].filter((r) => r !== socket.id && isChatRoom(r));
      for (const room of chatRooms) {
        void emitRoomPresence(io, room, socket.id).catch(() => reportSocketDeliveryFailure("chat:presence"));
      }
    });
  });
}
