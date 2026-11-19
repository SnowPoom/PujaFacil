import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  session: { findUnique: vi.fn() },
  article: { findUnique: vi.fn() },
  auction: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  auctionAlias: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  bid: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  chatMessage: { create: vi.fn(), findMany: vi.fn() },
  notification: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: db }));
// Estas pruebas de negocio aíslan el transporte. La autorización de destinatarios
// se verifica por separado con PostgreSQL y sockets reales en la integración.
vi.mock("../lib/auth/socket-session", async (original) => ({
  ...await original<typeof import("../lib/auth/socket-session")>(),
  emitAuthorizedRoom: vi.fn(async (io, room, event, payload) => { io.to(room).emit(event, payload); }),
}));
import { bindSocketSession } from "../lib/auth/socket-session";

function sessionSocket<T extends { data: { userId: string } }>(socket: T): never {
  const expiresAt = new Date(Date.now() + 60_000);
  bindSocketSession(socket, { tokenHash: "a".repeat(64), userId: socket.data.userId, expiresAt });
  db.session.findUnique.mockResolvedValue({ userId: socket.data.userId, expiresAt });
  return socket as never;
}

import { chatSendSchema, historyQuerySchema, HIDDEN_DATA, parseRoom, sanitizeChatText } from "../modules/chat/chat-rules";
import {
  assertCanChat,
  ChatError,
  GENERAL_ALIAS,
  getHistory,
  getOrCreateAuctionAlias,
  saveMessage,
  validateRoomAccess,
} from "../modules/chat/chat-service";
import {
  AUCTION_SCHEDULER_INTERVAL_MS,
  authenticateSocketHandshake,
  countDistinctRoomUsers,
  emitRoomPresence,
  handleChatJoin,
  handleChatSend,
  registerSocketHandlers,
  revalidateSocketAccount,
  runAuctionLifecycleTick,
  startAuctionScheduler,
  stopAuctionScheduler,
} from "../server/socket/index";
import { emitAuctionUpdated, emitNotificationToUser, getSocketServer, setSocketServer } from "../lib/realtime";
import { getAuctionBids, getUserBids, placeBid } from "../modules/bids/bid-service";
import { GET as getAuctionBidsRoute, POST as postAuctionBidRoute } from "../app/api/auctions/[id]/bids/route";
import { GET as getMyBidsRoute } from "../app/api/me/bids/route";
import { GET as getChatMessages } from "../app/api/chat/messages/route";
import {
  listNotifications,
  markNotificationRead,
  notifyUser,
} from "../modules/notifications/notification-service";
import { GET as getNotificationsRoute } from "../app/api/notifications/route";
import { PATCH as patchNotificationReadRoute } from "../app/api/notifications/[id]/route";
import { activateDueAuctions, closeDueAuctions } from "../modules/bids/auction-closer";

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
});

describe("Kevin 14/11 — Etapa 1: reglas de sala y mensaje", () => {
  it("acepta solo la sala general y salas de subasta con id válido", () => {
    expect(parseRoom("general")).toEqual({ kind: "general", room: "general" });
    expect(parseRoom("auction:ckx1a2b3c4d5e6f7g8h9i0j1k")).toEqual({ kind: "auction", room: "auction:ckx1a2b3c4d5e6f7g8h9i0j1k", auctionId: "ckx1a2b3c4d5e6f7g8h9i0j1k" });
    expect(parseRoom("auction:demo-subasta-programada")?.kind).toBe("auction");
    for (const invalid of ["", "General", "auction:", "auction:<script>", "auction:../x", "user:abc", "auction:ABC", null, 42, { room: "general" }]) {
      expect(parseRoom(invalid)).toBeNull();
    }
  });

  it("sanitiza markup, emails y teléfonos", () => {
    expect(sanitizeChatText("<b>hola</b> <script>alert(1)</script>")).toBe("hola alert(1)");
    expect(sanitizeChatText("escríbeme a demo@example.test")).toBe(`escríbeme a ${HIDDEN_DATA}`);
    expect(sanitizeChatText("llama al 099 123 4567 o +593991234567")).toBe(`llama al ${HIDDEN_DATA} o ${HIDDEN_DATA}`);
    expect(sanitizeChatText("ofrezco 150.00 por el lote")).toBe("ofrezco 150.00 por el lote");
    expect(sanitizeChatText("  \u0000hola\u0007  ")).toBe("hola");
    expect(sanitizeChatText("<><>")).toBe("");
  });

  it("valida longitud de texto y clientMessageId", () => {
    expect(chatSendSchema.safeParse({ room: "general", text: "hola", clientMessageId: "m1" }).success).toBe(true);
    expect(chatSendSchema.safeParse({ room: "general", text: "   ", clientMessageId: "m1" }).success).toBe(false);
    expect(chatSendSchema.safeParse({ room: "general", text: "x".repeat(501), clientMessageId: "m1" }).success).toBe(false);
    expect(chatSendSchema.safeParse({ room: "general", text: "hola", clientMessageId: "" }).success).toBe(false);
    expect(chatSendSchema.safeParse({ room: "general", text: "hola", clientMessageId: "x".repeat(101) }).success).toBe(false);
  });

  it("limita el historial a 30 mensajes", () => {
    expect(historyQuerySchema.parse({ room: "general" }).limit).toBe(30);
    expect(historyQuerySchema.parse({ room: "general", limit: "10" }).limit).toBe(10);
    expect(historyQuerySchema.safeParse({ room: "general", limit: "31" }).success).toBe(false);
  });
});

describe("Kevin 14/11 — Etapa 2: servicio de chat (chat-service.ts)", () => {
  it("assertCanChat permite cuenta ACTIVA con rol válido y rechaza PENDIENTE o SUSPENDIDA", async () => {
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    await expect(assertCanChat("u1")).resolves.toEqual({ status: "ACTIVA", roles: ["COMPRADOR"] });

    db.user.findUnique.mockResolvedValueOnce({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    await expect(assertCanChat("u2")).rejects.toMatchObject({ status: 403, code: "CUENTA_NO_ACTIVA", revoked: false });

    db.user.findUnique.mockResolvedValueOnce({ status: "SUSPENDIDA", roles: [{ role: "COMPRADOR" }] });
    await expect(assertCanChat("u3")).rejects.toMatchObject({ status: 403, code: "ACCESO_REVOCADO", revoked: true });
  });

  it("validateRoomAccess verifica visibilidad de subasta y modo lectura/escritura", async () => {
    await expect(validateRoomAccess("general", "write")).resolves.toEqual({ kind: "general", room: "general" });
    await expect(validateRoomAccess("invalida", "read")).rejects.toMatchObject({ status: 400, code: "SALA_INVALIDA" });

    db.auction.findUnique.mockResolvedValueOnce(null);
    await expect(validateRoomAccess("auction:noexiste", "read")).rejects.toMatchObject({ status: 404, code: "SALA_NO_DISPONIBLE" });

    db.auction.findUnique.mockResolvedValueOnce({ status: "BORRADOR" });
    await expect(validateRoomAccess("auction:borrador1", "read")).rejects.toMatchObject({ status: 404, code: "SALA_NO_DISPONIBLE" });

    db.auction.findUnique.mockResolvedValueOnce({ status: "ADJUDICADA" });
    await expect(validateRoomAccess("auction:adj1", "read")).resolves.toEqual({ kind: "auction", room: "auction:adj1", auctionId: "adj1" });

    db.auction.findUnique.mockResolvedValueOnce({ status: "ADJUDICADA" });
    await expect(validateRoomAccess("auction:adj1", "write")).rejects.toMatchObject({ status: 409, code: "SALA_SOLO_LECTURA" });
  });

  it("getOrCreateAuctionAlias reutiliza alias existente o genera uno nuevo con formato Postor-xxxxxx", async () => {
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-a1b2c3" });
    await expect(getOrCreateAuctionAlias("sub1", "u1")).resolves.toBe("Postor-a1b2c3");
    expect(db.auctionAlias.create).not.toHaveBeenCalled();

    db.auctionAlias.findUnique.mockResolvedValueOnce(null);
    db.auctionAlias.create.mockImplementationOnce(async ({ data }: { data: { alias: string } }) => ({ alias: data.alias }));
    const createdAlias = await getOrCreateAuctionAlias("sub1", "u2");
    expect(createdAlias).toMatch(/^Postor-[a-f0-9]{6}$/);

    // Manejo de colisión P2002 concurrente
    db.auctionAlias.findUnique.mockResolvedValueOnce(null);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6.19.0" });
    db.auctionAlias.create.mockRejectedValueOnce(p2002);
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-raced0" });
    await expect(getOrCreateAuctionAlias("sub1", "u3")).resolves.toBe("Postor-raced0");
  });

  it("saveMessage sanitiza, persiste y oculta authorId tanto en general como en subasta", async () => {
    const now = new Date("2026-11-14T15:00:00.000Z");
    db.chatMessage.create.mockResolvedValueOnce({
      id: "msg1",
      room: "general",
      text: `Hola ${HIDDEN_DATA}`,
      createdAt: now,
    });

    const msgGeneral = await saveMessage({ room: "general", authorId: "u1", text: "<b>Hola</b> user@correo.com" });
    expect(msgGeneral).toEqual({
      id: "msg1",
      room: "general",
      text: `Hola ${HIDDEN_DATA}`,
      authorAlias: GENERAL_ALIAS,
      createdAt: now.toISOString(),
    });
    expect(Object.keys(msgGeneral)).not.toContain("authorId");

    db.auction.findUnique.mockResolvedValueOnce({ status: "ACTIVA" });
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-ff0011" });
    db.chatMessage.create.mockResolvedValueOnce({
      id: "msg2",
      room: "auction:sub1",
      text: "Oferta lista",
      createdAt: now,
    });

    const msgAuction = await saveMessage({ room: "auction:sub1", authorId: "u1", text: "Oferta lista" });
    expect(msgAuction.authorAlias).toBe("Postor-ff0011");

    await expect(saveMessage({ room: "general", authorId: "u1", text: "<script></script>" })).rejects.toBeInstanceOf(ChatError);
  });

  it("getHistory devuelve mensajes en orden cronológico con alias por subasta y sin identidades reales", async () => {
    const t1 = new Date("2026-11-14T15:00:00.000Z");
    const t2 = new Date("2026-11-14T15:01:00.000Z");
    db.auction.findUnique.mockResolvedValueOnce({ status: "PROGRAMADA" });
    // findMany devuelve descendente (más reciente primero)
    db.chatMessage.findMany.mockResolvedValueOnce([
      { id: "m2", room: "auction:sub1", text: "Segundo", createdAt: t2, authorId: "u2" },
      { id: "m1", room: "auction:sub1", text: "Primero", createdAt: t1, authorId: "u1" },
    ]);
    db.auctionAlias.findMany.mockResolvedValueOnce([
      { userId: "u1", alias: "Postor-111111" },
      { userId: "u2", alias: "Postor-222222" },
    ]);

    const history = await getHistory("auction:sub1", 30);
    expect(history).toEqual([
      { id: "m1", room: "auction:sub1", text: "Primero", authorAlias: "Postor-111111", createdAt: t1.toISOString() },
      { id: "m2", room: "auction:sub1", text: "Segundo", authorAlias: "Postor-222222", createdAt: t2.toISOString() },
    ]);
  });
});

describe("Kevin 14/11 — Etapa 3: Handshake Socket.IO y revalidación", () => {
  const validToken = "a".repeat(64);

  it("authenticateSocketHandshake acepta cookie pf_session válida y guarda solo userId, roles, status en socket.data", async () => {
    db.session.findUnique.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "user-123",
        nombreCompleto: "Usuario Ficticio",
        email: "user@pujafacil.test",
        status: "ACTIVA",
        roles: [{ role: "COMPRADOR" }],
      },
    });

    const socket = { handshake: { headers: { cookie: `pf_session=${validToken}` } } as never, data: {} };
    const next = vi.fn();
    await authenticateSocketHandshake(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toEqual({
      userId: "user-123",
      roles: ["COMPRADOR"],
      status: "ACTIVA",
    });
    expect(Object.keys(socket.data)).not.toContain("email");
    expect(Object.keys(socket.data)).not.toContain("nombreCompleto");
  });

  it("authenticateSocketHandshake rechaza con UNAUTHORIZED si falta cookie, expiró o usuario está SUSPENDIDA/CERRADA", async () => {
    const nextNoCookie = vi.fn();
    await authenticateSocketHandshake({ handshake: { headers: {} } as never, data: {} }, nextNoCookie);
    expect(nextNoCookie).toHaveBeenCalledOnce();
    expect(nextNoCookie.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((nextNoCookie.mock.calls[0][0] as Error).message).toBe("UNAUTHORIZED");

    db.session.findUnique.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "user-susp",
        nombreCompleto: "Suspendido",
        email: "susp@pujafacil.test",
        status: "SUSPENDIDA",
        roles: [{ role: "COMPRADOR" }],
      },
    });
    const nextSusp = vi.fn();
    await authenticateSocketHandshake(
      { handshake: { headers: { cookie: `pf_session=${validToken}` } } as never, data: {} },
      nextSusp,
    );
    expect((nextSusp.mock.calls[0][0] as Error).message).toBe("UNAUTHORIZED");
  });

  it("revalidateSocketAccount comprueba en PostgreSQL que siga ACTIVA y desconecta si fue revocada", async () => {
    const disconnect = vi.fn();
    const socket = { data: { userId: "u1", roles: ["COMPRADOR"], status: "ACTIVA" }, disconnect };

    // Caso 1: Sigue activa
    db.user.findUnique.mockResolvedValue({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }, { role: "VENDEDOR" }] });
    const okRes = await revalidateSocketAccount(sessionSocket(socket));
    expect(okRes).toEqual({ ok: true, userId: "u1", roles: ["COMPRADOR", "VENDEDOR"], status: "ACTIVA" });
    expect(disconnect).not.toHaveBeenCalled();

    // Caso 2: Cuenta PENDIENTE -> devuelve 403 sin desconectar forzosamente
    db.user.findUnique.mockResolvedValue({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    const pendingRes = await revalidateSocketAccount(sessionSocket(socket));
    expect(pendingRes).toMatchObject({ ok: false, error: { status: 403, code: "CUENTA_NO_ACTIVA" }, disconnected: false });
    expect(disconnect).not.toHaveBeenCalled();

    // Caso 3: Cuenta SUSPENDIDA -> devuelve 403 y desconecta el socket
    db.user.findUnique.mockResolvedValue({ status: "SUSPENDIDA", roles: [{ role: "COMPRADOR" }] });
    const revokedRes = await revalidateSocketAccount(sessionSocket(socket));
    expect(revokedRes).toMatchObject({ ok: false, error: { status: 403, code: "ACCESO_REVOCADO" }, disconnected: true });
    expect(disconnect).toHaveBeenCalledWith(true);
  });
});

describe("Kevin 14/11 — Etapa 4: chat:join y presencia por usuarios distintos", () => {
  it("countDistinctRoomUsers cuenta usuarios únicos por userId (no pestañas duplicadas) y permite excluir socket en desconexión", async () => {
    const fakeSockets = [
      { id: "s1", data: { userId: "u1" } },
      { id: "s2", data: { userId: "u1" } }, // segunda pestaña del mismo usuario u1
      { id: "s3", data: { userId: "u2" } },
    ];
    const io = {
      in: vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue(fakeSockets) }),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    };

    await expect(countDistinctRoomUsers(io as never, "general")).resolves.toBe(2);
    // Si s3 (u2) se está desconectando, queda solo u1 (aunque tenga 2 pestañas s1 y s2) -> 1
    await expect(countDistinctRoomUsers(io as never, "general", "s3")).resolves.toBe(1);
    // Si s1 (una pestaña de u1) se desconecta, s2 sigue abierta para u1 y s3 para u2 -> siguen siendo 2
    await expect(countDistinctRoomUsers(io as never, "general", "s1")).resolves.toBe(2);
  });

  it("handleChatJoin une a sala general o subasta válida, emite chat:presence y responde ACK ok:true", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    db.auction.findUnique.mockResolvedValueOnce({ status: "PROGRAMADA" });

    const emitFn = vi.fn();
    const io = {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockResolvedValue([
          { id: "s1", data: { userId: "u1" } },
          { id: "s2", data: { userId: "u2" } },
        ]),
      }),
      to: vi.fn().mockReturnValue({ emit: emitFn }),
    };
    const join = vi.fn();
    const leave = vi.fn();
    const socket = {
      id: "s1",
      data: { userId: "u1", roles: ["COMPRADOR"], status: "ACTIVA" },
      rooms: new Set(["s1"]),
      join,
      leave,
      disconnect: vi.fn(),
    };
    const ack = vi.fn();

    await handleChatJoin(io as never, sessionSocket(socket), { room: "auction:demo-subasta-programada" }, ack);

    expect(join).toHaveBeenCalledWith("auction:demo-subasta-programada");
    expect(emitFn).toHaveBeenCalledWith("chat:presence", { room: "auction:demo-subasta-programada", count: 2 });
    expect(ack).toHaveBeenCalledWith({ ok: true, room: "auction:demo-subasta-programada", count: 2 });
  });

  it("handleChatJoin rechaza cuenta PENDIENTE (403) y sala de subasta inexistente (404) sin unir al socket", async () => {
    const join = vi.fn();
    const socket = {
      id: "s1",
      data: { userId: "u-pend", roles: ["COMPRADOR"], status: "PENDIENTE" },
      rooms: new Set(["s1"]),
      join,
      leave: vi.fn(),
      disconnect: vi.fn(),
    };

    // Cuenta PENDIENTE
    db.user.findUnique.mockResolvedValue({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    const ackPending = vi.fn();
    await handleChatJoin({} as never, sessionSocket(socket), { room: "general" }, ackPending);
    expect(ackPending).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 403, code: "CUENTA_NO_ACTIVA" }),
    });
    expect(join).not.toHaveBeenCalled();

    // Subasta inexistente con cuenta ACTIVA
    db.user.findUnique.mockResolvedValue({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    db.auction.findUnique.mockResolvedValueOnce(null);
    const ackNotFound = vi.fn();
    await handleChatJoin({} as never, sessionSocket(socket), { room: "auction:no-existe" }, ackNotFound);
    expect(ackNotFound).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 404, code: "SALA_NO_DISPONIBLE" }),
    });
    expect(join).not.toHaveBeenCalled();
  });

  it("emitRoomPresence actualiza la presencia al desconectar un socket", async () => {
    const emitFn = vi.fn();
    const io = {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockResolvedValue([
          { id: "s1", data: { userId: "u1" } },
          { id: "s2", data: { userId: "u2" } },
        ]),
      }),
      to: vi.fn().mockReturnValue({ emit: emitFn }),
    };

    const countAfterDisconnect = await emitRoomPresence(io as never, "general", "s2");
    expect(countAfterDisconnect).toBe(1);
    expect(emitFn).toHaveBeenCalledWith("chat:presence", { room: "general", count: 1 });
  });
});

describe("Kevin 14/11 — Etapa 5: chat:send (persistencia antes de emitir y autorizaciones)", () => {
  it("handleChatSend persiste en PostgreSQL ANTES de emitir chat:new y usa alias seguro sin datos personales", async () => {
    const callOrder: string[] = [];
    const now = new Date("2026-11-14T16:00:00.000Z");

    db.user.findUnique.mockResolvedValue({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    db.auction.findUnique.mockResolvedValueOnce({ status: "ACTIVA" });
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-cafe01" });
    db.chatMessage.create.mockImplementationOnce(async () => {
      callOrder.push("db:create");
      return { id: "msg-100", room: "auction:sub-activa", text: `Hola ${HIDDEN_DATA}`, createdAt: now };
    });

    const emitFn = vi.fn().mockImplementation(() => {
      callOrder.push("socket:emit");
    });
    const io = { to: vi.fn().mockReturnValue({ emit: emitFn }) };
    const socket = {
      id: "s1",
      data: { userId: "u1", roles: ["COMPRADOR"], status: "ACTIVA" },
      rooms: new Set(["s1", "auction:sub-activa"]),
      disconnect: vi.fn(),
    };
    const ack = vi.fn();

    await handleChatSend(
      io as never,
      sessionSocket(socket),
      { room: "auction:sub-activa", text: "<b>Hola</b> mi correo es a@b.com", clientMessageId: "cli-1" },
      ack,
    );

    expect(callOrder).toEqual(["db:create", "socket:emit"]);
    const expectedDto = {
      id: "msg-100",
      room: "auction:sub-activa",
      text: `Hola ${HIDDEN_DATA}`,
      authorAlias: "Postor-cafe01",
      createdAt: now.toISOString(),
    };
    expect(emitFn).toHaveBeenCalledWith("chat:new", expectedDto);
    expect(ack).toHaveBeenCalledWith({ ok: true, clientMessageId: "cli-1", message: expectedDto });
  });

  it("handleChatSend rechaza cuenta PENDIENTE (403) y socket que no se ha unido a la sala (403)", async () => {
    const emitFn = vi.fn();
    const io = { to: vi.fn().mockReturnValue({ emit: emitFn }) };

    // 1. Cuenta PENDIENTE
    db.user.findUnique.mockResolvedValue({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    const socketPending = {
      id: "s-pend",
      data: { userId: "u-pend", roles: ["COMPRADOR"], status: "PENDIENTE" },
      rooms: new Set(["s-pend", "general"]),
      disconnect: vi.fn(),
    };
    const ackPending = vi.fn();
    await handleChatSend(io as never, sessionSocket(socketPending), { room: "general", text: "Hola", clientMessageId: "c1" }, ackPending);
    expect(ackPending).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 403, code: "CUENTA_NO_ACTIVA" }),
    });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
    expect(emitFn).not.toHaveBeenCalled();

    // 2. Cuenta ACTIVA pero no unida a la sala
    db.user.findUnique.mockResolvedValue({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    const socketNotJoined = {
      id: "s-active",
      data: { userId: "u1", roles: ["COMPRADOR"], status: "ACTIVA" },
      rooms: new Set(["s-active"]), // No está en "general"
      disconnect: vi.fn(),
    };
    const ackNotJoined = vi.fn();
    await handleChatSend(io as never, sessionSocket(socketNotJoined), { room: "general", text: "Hola", clientMessageId: "c2" }, ackNotJoined);
    expect(ackNotJoined).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 403, code: "NO_UNIDO_A_SALA" }),
    });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
    expect(emitFn).not.toHaveBeenCalled();
  });

  it("handleChatSend rechaza payload inválido de Zod (400) sin escribir en base de datos", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    const socket = {
      id: "s1",
      data: { userId: "u1", roles: ["COMPRADOR"], status: "ACTIVA" },
      rooms: new Set(["s1", "general"]),
      disconnect: vi.fn(),
    };
    const ack = vi.fn();
    await handleChatSend({} as never, sessionSocket(socket), { room: "general", text: "   ", clientMessageId: "" }, ack);
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 400, code: "DATOS_INVALIDOS" }),
    });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });
});

describe("Kevin 14/11 — Etapa 6: GET /api/chat/messages", () => {
  const validToken = "a".repeat(64);
  const activeSession = {
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "u1",
      nombreCompleto: "Usuario Activo",
      email: "activo@pujafacil.test",
      status: "ACTIVA" as const,
      roles: [{ role: "COMPRADOR" as const }],
    },
  };

  it("responde 401 sin sesión y 403 con cuenta PENDIENTE", async () => {
    const unauthRes = await getChatMessages(new Request("http://localhost:3000/api/chat/messages?room=general"));
    expect(unauthRes.status).toBe(401);
    expect(await unauthRes.json()).toMatchObject({ ok: false, error: { code: "NO_AUTENTICADO" } });

    db.session.findUnique.mockResolvedValueOnce({
      ...activeSession,
      user: { ...activeSession.user, status: "PENDIENTE" },
    });
    const pendingRes = await getChatMessages(
      new Request("http://localhost:3000/api/chat/messages?room=general", {
        headers: { cookie: `pf_session=${validToken}` },
      }),
    );
    expect(pendingRes.status).toBe(403);
    expect(await pendingRes.json()).toMatchObject({ ok: false, error: { code: "CUENTA_NO_ACTIVA" } });
  });

  it("responde 400 ante sala o limit inválidos y 404 ante subasta inexistente", async () => {
    db.session.findUnique.mockResolvedValue(activeSession);

    const badRoomRes = await getChatMessages(
      new Request("http://localhost:3000/api/chat/messages?room=auction:<script>", {
        headers: { cookie: `pf_session=${validToken}` },
      }),
    );
    expect(badRoomRes.status).toBe(400);
    expect(await badRoomRes.json()).toMatchObject({ ok: false, error: { code: "SALA_INVALIDA" } });

    const badLimitRes = await getChatMessages(
      new Request("http://localhost:3000/api/chat/messages?room=general&limit=99", {
        headers: { cookie: `pf_session=${validToken}` },
      }),
    );
    expect(badLimitRes.status).toBe(400);
    expect(await badLimitRes.json()).toMatchObject({ ok: false, error: { code: "DATOS_INVALIDOS" } });

    db.auction.findUnique.mockResolvedValueOnce(null);
    const missingAuctionRes = await getChatMessages(
      new Request("http://localhost:3000/api/chat/messages?room=auction:no-existe", {
        headers: { cookie: `pf_session=${validToken}` },
      }),
    );
    expect(missingAuctionRes.status).toBe(404);
    expect(await missingAuctionRes.json()).toMatchObject({ ok: false, error: { code: "SALA_NO_DISPONIBLE" } });
  });

  it("responde 200 con últimos mensajes ordenados y alias de subasta sin exponer identidades", async () => {
    db.session.findUnique.mockResolvedValueOnce(activeSession);
    db.auction.findUnique.mockResolvedValueOnce({ status: "PROGRAMADA" });
    const t1 = new Date("2026-11-14T17:00:00.000Z");
    const t2 = new Date("2026-11-14T17:01:00.000Z");
    db.chatMessage.findMany.mockResolvedValueOnce([
      { id: "m2", room: "auction:demo-subasta-programada", text: "Segundo", createdAt: t2, authorId: "u2" },
      { id: "m1", room: "auction:demo-subasta-programada", text: "Primero", createdAt: t1, authorId: "u1" },
    ]);
    db.auctionAlias.findMany.mockResolvedValueOnce([
      { userId: "u1", alias: "Pujador-Alfa" },
      { userId: "u2", alias: "Postor-bb2233" },
    ]);

    const res = await getChatMessages(
      new Request("http://localhost:3000/api/chat/messages?room=auction:demo-subasta-programada&limit=30", {
        headers: { cookie: `pf_session=${validToken}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "m1",
            room: "auction:demo-subasta-programada",
            text: "Primero",
            authorAlias: "Pujador-Alfa",
            createdAt: t1.toISOString(),
          },
          {
            id: "m2",
            room: "auction:demo-subasta-programada",
            text: "Segundo",
            authorAlias: "Postor-bb2233",
            createdAt: t2.toISOString(),
          },
        ],
      },
    });
  });
});

describe("Kevin 15/11 — Etapa 1: Puente realtime.ts (globalThis en servidor Node)", () => {
  it("registerSocketHandlers registra io en globalThis y emitAuctionUpdated / emitNotificationToUser emiten a las salas correctas", () => {
    const emitFn = vi.fn();
    const fakeIo = {
      use: vi.fn(),
      on: vi.fn(),
      to: vi.fn().mockReturnValue({ emit: emitFn }),
    };

    registerSocketHandlers(fakeIo as never);
    expect(getSocketServer()).toBe(fakeIo);
    stopAuctionScheduler();

    const auctionPayload = {
      auctionId: "sub-1",
      highestBid: "160.00",
      bidCount: 3,
      status: "ACTIVA" as const,
      closesAt: "2026-11-17T18:00:00.000Z",
    };
    expect(emitAuctionUpdated("sub-1", auctionPayload)).toBe(true);
    expect(fakeIo.to).toHaveBeenCalledWith("auction:sub-1");
    expect(emitFn).toHaveBeenCalledWith("auction:updated", auctionPayload);

    const notifPayload = {
      id: "notif-1",
      type: "OUTBID",
      title: "Tu oferta fue superada",
      body: "Otro postor ofertó $160.00",
      url: "/subastas/sub-1",
      createdAt: "2026-11-15T18:00:00.000Z",
    };
    expect(emitNotificationToUser("u-99", notifPayload)).toBe(true);
    expect(fakeIo.to).toHaveBeenCalledWith("user:u-99");
    expect(emitFn).toHaveBeenCalledWith("notification:new", notifPayload);

    setSocketServer(undefined as never);
    expect(emitAuctionUpdated("sub-1", auctionPayload)).toBe(false);
  });
});

describe("Kevin 15/11 — Etapa 2: Servicio transaccional de ofertas (bid-service.ts)", () => {
  const activeBuyer = { status: "ACTIVA" as const, roles: [{ role: "COMPRADOR" as const }] };
  const makeActiveAuctionRow = () => ({
    id: "sub-1",
    articleId: "art-1",
    startingPrice: new Prisma.Decimal("150.00"),
    minIncrement: new Prisma.Decimal("10.00"),
    opensAt: new Date(Date.now() - 3_600_000),
    closesAt: new Date(Date.now() + 3_600_000),
    status: "ACTIVA" as const,
  });

  it("acepta oferta válida, bloquea con SELECT FOR UPDATE y emite auction:updated DESPUÉS de la transacción", async () => {
    const eventsOrder: string[] = [];
    const emitFn = vi.fn().mockImplementation(() => {
      eventsOrder.push("socket:auction:updated");
    });
    setSocketServer({ to: vi.fn().mockReturnValue({ emit: emitFn }) } as never);

    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$transaction.mockImplementationOnce(async (callback: (tx: typeof db) => Promise<unknown>) => {
      eventsOrder.push("tx:start");
      const res = await callback(db);
      eventsOrder.push("tx:commit");
      return res;
    });
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    db.bid.findFirst.mockResolvedValueOnce({ id: "b-prev", amount: new Prisma.Decimal("150.00"), buyerId: "buyer-prev" });
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-aa1122" });
    const acceptedAt = new Date("2026-11-15T18:00:00.000Z");
    db.bid.create.mockResolvedValueOnce({
      id: "bid-new",
      amount: new Prisma.Decimal("160.00"),
      acceptedAt,
    });
    db.bid.count.mockResolvedValueOnce(2);

    const result = await placeBid({
      auctionId: "sub-1",
      buyerId: "buyer-1",
      amount: "160.00",
      requestId: "req-1",
    });

    expect(eventsOrder).toEqual(["tx:start", "tx:commit", "socket:auction:updated"]);
    expect(result).toMatchObject({
      id: "bid-new",
      amount: "160.00",
      auctionId: "sub-1",
      acceptedAt: acceptedAt.toISOString(),
      alias: "Postor-aa1122",
      idempotent: false,
    });
    expect(emitFn).toHaveBeenCalledWith(
      "auction:updated",
      expect.objectContaining({
        auctionId: "sub-1",
        highestBid: "160.00",
        bidCount: 2,
        status: "ACTIVA",
      }),
    );
    setSocketServer(undefined as never);
  });

  it("rechaza monto bajo (BID_TOO_LOW 409) tanto frente al precio inicial como frente a oferta máxima + minIncrement", async () => {
    // Caso 1: sin ofertas previas, mínimo = startingPrice (150.00), envía 149.99
    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    db.bid.findFirst.mockResolvedValueOnce(null);

    await expect(
      placeBid({ auctionId: "sub-1", buyerId: "buyer-1", amount: "149.99", requestId: "req-low-1" }),
    ).rejects.toMatchObject({ status: 409, code: "BID_TOO_LOW" });

    // Caso 2: oferta previa de 150.00 + incremento 10.00 = mínimo 160.00, envía 155.00
    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    db.bid.findFirst.mockResolvedValueOnce({ id: "b1", amount: new Prisma.Decimal("150.00"), buyerId: "buyer-2" });

    await expect(
      placeBid({ auctionId: "sub-1", buyerId: "buyer-1", amount: "155.00", requestId: "req-low-2" }),
    ).rejects.toMatchObject({ status: 409, code: "BID_TOO_LOW" });
    expect(db.bid.create).not.toHaveBeenCalled();
  });

  it("rechaza al propietario del artículo (OWN_ITEM 403), cuenta PENDIENTE (403) y subasta cerrada/no activa (AUCTION_NOT_ACTIVE 409)", async () => {
    // 1. Cuenta PENDIENTE
    db.user.findUnique.mockResolvedValueOnce({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    await expect(
      placeBid({ auctionId: "sub-1", buyerId: "buyer-pend", amount: "160.00", requestId: "r1" }),
    ).rejects.toMatchObject({ status: 403, code: "CUENTA_NO_ACTIVA" });

    // 2. Propietario del propio artículo
    db.user.findUnique.mockResolvedValueOnce({
      status: "ACTIVA",
      roles: [{ role: "COMPRADOR" }, { role: "VENDEDOR" }],
    });
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "owner-user" });
    await expect(
      placeBid({ auctionId: "sub-1", buyerId: "owner-user", amount: "160.00", requestId: "r2" }),
    ).rejects.toMatchObject({ status: 403, code: "OWN_ITEM" });

    // 3. Subasta fuera de horario (closesAt en el pasado)
    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([
      { ...makeActiveAuctionRow(), closesAt: new Date(Date.now() - 1000) },
    ]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    await expect(
      placeBid({ auctionId: "sub-1", buyerId: "buyer-1", amount: "160.00", requestId: "r3" }),
    ).rejects.toMatchObject({ status: 409, code: "AUCTION_NOT_ACTIVE" });
  });

  it("garantiza idempotencia con el mismo requestId y rechaza 409 si repite requestId con distinto importe", async () => {
    const existingDate = new Date("2026-11-15T18:05:00.000Z");

    // Mismo requestId + mismo importe -> devuelve la misma oferta sin insertar otra
    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce({
      id: "bid-existing",
      amount: new Prisma.Decimal("160.00"),
      acceptedAt: existingDate,
    });
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-idem01" });
    db.bid.findFirst.mockResolvedValueOnce({ amount: new Prisma.Decimal("160.00") });
    db.bid.count.mockResolvedValueOnce(1);

    const idemRes = await placeBid({
      auctionId: "sub-1",
      buyerId: "buyer-1",
      amount: "160.00",
      requestId: "req-dup",
    });
    expect(idemRes).toMatchObject({
      id: "bid-existing",
      amount: "160.00",
      alias: "Postor-idem01",
      idempotent: true,
    });
    expect(db.bid.create).not.toHaveBeenCalled();

    // Mismo requestId + distinto importe -> 409 DUPLICATE_REQUEST_CONFLICT
    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce({
      id: "bid-existing",
      amount: new Prisma.Decimal("160.00"),
      acceptedAt: existingDate,
    });

    await expect(
      placeBid({
        auctionId: "sub-1",
        buyerId: "buyer-1",
        amount: "180.00",
        requestId: "req-dup",
      }),
    ).rejects.toMatchObject({ status: 409, code: "DUPLICATE_REQUEST_CONFLICT" });
  });

  it("ante dos ofertas simultáneas al mismo mínimo (150.00), solo la primera se acepta y la segunda falla 409 BID_TOO_LOW", async () => {
    let highestInDb: { id: string; amount: Prisma.Decimal; buyerId: string } | null = null;
    db.user.findUnique.mockResolvedValue(activeBuyer);
    db.$queryRaw.mockResolvedValue([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValue({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValue(null);
    db.bid.findFirst.mockImplementation(async () => highestInDb);
    db.auctionAlias.findUnique.mockResolvedValue({ alias: "Postor-conc01" });
    db.bid.create.mockImplementation(async ({ data }: { data: { buyerId: string; amount: string } }) => {
      const created = {
        id: `bid-${data.buyerId}`,
        amount: new Prisma.Decimal(data.amount),
        acceptedAt: new Date(),
      };
      highestInDb = { id: created.id, amount: created.amount, buyerId: data.buyerId };
      return created;
    });
    db.bid.count.mockResolvedValue(1);

    const first = await placeBid({
      auctionId: "sub-1",
      buyerId: "buyer-1",
      amount: "150.00",
      requestId: "req-c1",
    });
    expect(first.amount).toBe("150.00");

    await expect(
      placeBid({
        auctionId: "sub-1",
        buyerId: "buyer-2",
        amount: "150.00",
        requestId: "req-c2",
      }),
    ).rejects.toMatchObject({ status: 409, code: "BID_TOO_LOW" });
  });

  it("getAuctionBids y getUserBids ocultan identidades ajenas y formatean importes con 2 decimales", async () => {
    const opensAt = new Date("2026-11-15T10:00:00.000Z");
    const closesAt = new Date("2026-11-16T10:00:00.000Z");
    const bidDate = new Date("2026-11-15T12:00:00.000Z");

    db.auction.findUnique.mockResolvedValueOnce({
      id: "sub-1",
      status: "ACTIVA",
      startingPrice: new Prisma.Decimal("150.00"),
      minIncrement: new Prisma.Decimal("10.00"),
      opensAt,
      closesAt,
      article: { title: "Reloj Suizo", category: "Relojes" },
    });
    db.bid.findMany.mockResolvedValueOnce([
      { buyerId: "u1", amount: new Prisma.Decimal("160.00"), acceptedAt: bidDate },
    ]);
    db.auctionAlias.findMany.mockResolvedValueOnce([{ userId: "u1", alias: "Postor-112233" }]);

    const snapshot = await getAuctionBids("sub-1");
    expect(snapshot).toMatchObject({
      auctionId: "sub-1",
      highestBid: "160.00",
      minNextBid: "170.00",
      bidCount: 1,
      items: [{ alias: "Postor-112233", amount: "160.00", acceptedAt: bidDate.toISOString() }],
    });
    expect(Object.keys(snapshot.items[0])).toEqual(["alias", "amount", "acceptedAt"]);

    db.bid.findMany.mockResolvedValueOnce([
      {
        id: "b1",
        auctionId: "sub-1",
        amount: new Prisma.Decimal("160.00"),
        acceptedAt: bidDate,
        auction: {
          status: "ACTIVA",
          closesAt,
          winnerBidId: null,
          article: { title: "Reloj Suizo" },
          bids: [{ id: "b1" }],
          aliases: [{ alias: "Postor-112233" }],
        },
      },
    ]);

    const myBids = await getUserBids("u1");
    expect(myBids).toEqual([
      {
        id: "b1",
        auctionId: "sub-1",
        auctionTitle: "Reloj Suizo",
        auctionStatus: "ACTIVA",
        amount: "160.00",
        acceptedAt: bidDate.toISOString(),
        closesAt: closesAt.toISOString(),
        alias: "Postor-112233",
        isLeadingOrWinner: true,
      },
    ]);
  });
});

describe("Kevin 15/11 — Etapa 3: Route Handler GET/POST /api/auctions/[id]/bids", () => {
  const validToken = "a".repeat(64);
  const buyerSession = {
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "buyer-1",
      nombreCompleto: "Carlos Comprador",
      email: "comprador1@pujafacil.test",
      status: "ACTIVA" as const,
      roles: [{ role: "COMPRADOR" as const }],
    },
  };
  const ctx = { params: Promise.resolve({ id: "sub-1" }) };

  it("POST /api/auctions/[id]/bids valida origen, rol COMPRADOR, JSON y devuelve 201 con {id,amount,auctionId,acceptedAt,alias}", async () => {
    db.session.findUnique.mockResolvedValue(buyerSession);
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    db.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-1",
        articleId: "art-1",
        startingPrice: new Prisma.Decimal("150.00"),
        minIncrement: new Prisma.Decimal("10.00"),
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
        status: "ACTIVA",
      },
    ]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    db.bid.findFirst.mockResolvedValueOnce(null);
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Pujador-Alfa" });
    const acceptedAt = new Date("2026-11-15T18:10:00.000Z");
    db.bid.create.mockResolvedValueOnce({
      id: "bid-201",
      amount: new Prisma.Decimal("150.00"),
      acceptedAt,
    });
    db.bid.count.mockResolvedValueOnce(1);

    const req = new Request("http://localhost:3000/api/auctions/sub-1/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "150.00", requestId: "uuid-1" }),
    });

    const res = await postAuctionBidRoute(req, ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        id: "bid-201",
        amount: "150.00",
        auctionId: "sub-1",
        acceptedAt: acceptedAt.toISOString(),
        alias: "Pujador-Alfa",
      },
    });
  });

  it("POST /api/auctions/[id]/bids rechaza sin sesión (401), rol sin COMPRADOR (403) y errores comerciales (409 BID_TOO_LOW)", async () => {
    // 1. Sin sesión -> 401
    const unauthReq = new Request("http://localhost:3000/api/auctions/sub-1/bids", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "150.00", requestId: "uuid-1" }),
    });
    expect((await postAuctionBidRoute(unauthReq, ctx)).status).toBe(401);

    // 2. Rol VENDEDOR puro (sin COMPRADOR) -> 403
    db.session.findUnique.mockResolvedValue({
      ...buyerSession,
      user: { ...buyerSession.user, roles: [{ role: "VENDEDOR" as const }] },
    });
    const sellerReq = new Request("http://localhost:3000/api/auctions/sub-1/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "150.00", requestId: "uuid-1" }),
    });
    expect((await postAuctionBidRoute(sellerReq, ctx)).status).toBe(403);

    // 3. BID_TOO_LOW -> 409 con código comercial y details
    db.session.findUnique.mockResolvedValue(buyerSession);
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    db.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-1",
        articleId: "art-1",
        startingPrice: new Prisma.Decimal("150.00"),
        minIncrement: new Prisma.Decimal("10.00"),
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
        status: "ACTIVA",
      },
    ]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    db.bid.findFirst.mockResolvedValueOnce({ id: "b1", amount: new Prisma.Decimal("200.00"), buyerId: "buyer-2" });

    const lowReq = new Request("http://localhost:3000/api/auctions/sub-1/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "205.00", requestId: "uuid-low" }),
    });
    const lowRes = await postAuctionBidRoute(lowReq, ctx);
    expect(lowRes.status).toBe(409);
    expect(await lowRes.json()).toMatchObject({
      ok: false,
      error: {
        code: "BID_TOO_LOW",
        details: { minRequired: "210.00", highestBid: "200.00" },
      },
    });
  });

  it("GET /api/auctions/[id]/bids es público y devuelve historial con alias sin userId real", async () => {
    const opensAt = new Date("2026-11-15T10:00:00.000Z");
    const closesAt = new Date("2026-11-16T10:00:00.000Z");
    const acceptedAt = new Date("2026-11-15T12:00:00.000Z");

    db.auction.findUnique.mockResolvedValueOnce({
      id: "sub-1",
      status: "ACTIVA",
      startingPrice: new Prisma.Decimal("150.00"),
      minIncrement: new Prisma.Decimal("10.00"),
      opensAt,
      closesAt,
      article: { title: "Mapa Antiguo", category: "Historia" },
    });
    db.bid.findMany.mockResolvedValueOnce([
      { buyerId: "buyer-1", amount: new Prisma.Decimal("160.00"), acceptedAt },
    ]);
    db.auctionAlias.findMany.mockResolvedValueOnce([{ userId: "buyer-1", alias: "Pujador-Alfa" }]);

    const res = await getAuctionBidsRoute(new Request("http://localhost:3000/api/auctions/sub-1/bids"), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.items).toEqual([
      { alias: "Pujador-Alfa", amount: "160.00", acceptedAt: acceptedAt.toISOString() },
    ]);
    expect(JSON.stringify(json)).not.toContain("buyer-1");
  });
});

describe("Kevin 15/11 — Etapa 4: GET /api/me/bids", () => {
  const validToken = "a".repeat(64);
  const buyerSession = {
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "buyer-1",
      nombreCompleto: "Carlos Comprador",
      email: "comprador1@pujafacil.test",
      status: "ACTIVA" as const,
      roles: [{ role: "COMPRADOR" as const }],
    },
  };

  it("GET /api/me/bids exige sesión activa COMPRADOR y devuelve ofertas propias sin identidades ajenas", async () => {
    expect((await getMyBidsRoute(new Request("http://localhost:3000/api/me/bids"))).status).toBe(401);

    db.session.findUnique.mockResolvedValue({
      ...buyerSession,
      user: { ...buyerSession.user, status: "PENDIENTE" as const },
    });
    const pendRes = await getMyBidsRoute(
      new Request("http://localhost:3000/api/me/bids", { headers: { cookie: `pf_session=${validToken}` } }),
    );
    expect(pendRes.status).toBe(403);

    db.session.findUnique.mockResolvedValue(buyerSession);
    const acceptedAt = new Date("2026-11-15T14:00:00.000Z");
    const closesAt = new Date("2026-11-16T18:00:00.000Z");
    db.bid.findMany.mockResolvedValueOnce([
      {
        id: "bid-1",
        auctionId: "demo-subasta-programada",
        amount: new Prisma.Decimal("170.00"),
        acceptedAt,
        auction: {
          status: "ACTIVA",
          closesAt,
          winnerBidId: null,
          article: { title: "Reloj Antiguo Suizo (Demo)" },
          bids: [{ id: "bid-other" }],
          aliases: [{ alias: "Pujador-Alfa" }],
        },
      },
    ]);

    const okRes = await getMyBidsRoute(
      new Request("http://localhost:3000/api/me/bids", { headers: { cookie: `pf_session=${validToken}` } }),
    );
    expect(okRes.status).toBe(200);
    const payload = await okRes.json();
    expect(payload).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "bid-1",
            auctionId: "demo-subasta-programada",
            auctionTitle: "Reloj Antiguo Suizo (Demo)",
            auctionStatus: "ACTIVA",
            amount: "170.00",
            acceptedAt: acceptedAt.toISOString(),
            closesAt: closesAt.toISOString(),
            alias: "Pujador-Alfa",
            isLeadingOrWinner: false,
          },
        ],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("bid-other");
  });
});

describe("Kevin 16/11 — Etapa 1: servicio de notificaciones", () => {
  const createdAt = new Date("2026-11-16T13:00:00.000Z");

  it("notifyUser guarda en PostgreSQL ANTES de emitir notification:new a la sala privada user:<id> sin exponer el userId", async () => {
    const order: string[] = [];
    const emitFn = vi.fn().mockImplementation(() => order.push("socket:emit"));
    const toFn = vi.fn().mockReturnValue({ emit: emitFn });
    setSocketServer({ to: toFn } as never);
    db.notification.create.mockImplementationOnce(async () => {
      order.push("db:create");
      return { id: "n1", type: "OUTBID", title: "Superada", body: "Otra oferta", url: "/subastas/sub-1", readAt: null, createdAt };
    });

    const dto = await notifyUser({ userId: "u1", type: "OUTBID", title: "Superada", body: "Otra oferta", url: "/subastas/sub-1" });

    expect(order).toEqual(["db:create", "socket:emit"]);
    expect(toFn).toHaveBeenCalledWith("user:u1");
    const payload = emitFn.mock.calls[0][1];
    expect(emitFn.mock.calls[0][0]).toBe("notification:new");
    expect(payload).toEqual({ id: "n1", type: "OUTBID", title: "Superada", body: "Otra oferta", url: "/subastas/sub-1", createdAt: createdAt.toISOString() });
    expect(JSON.stringify(payload)).not.toContain("u1");
    expect(dto.readAt).toBeNull();
    setSocketServer(undefined as never);
  });

  it("notifyUser reemplaza URLs externas por /notificaciones", async () => {
    db.notification.create.mockImplementationOnce(async ({ data }: { data: { url: string } }) => ({
      id: "n2", type: "X", title: "t", body: "b", url: data.url, readAt: null, createdAt,
    }));
    const dto = await notifyUser({ userId: "u1", type: "X", title: "t", body: "b", url: "https://malicioso.test" });
    expect(dto.url).toBe("/notificaciones");
  });

  it("listNotifications filtra por titular y devuelve el contador de no leídas", async () => {
    db.notification.findMany.mockResolvedValueOnce([
      { id: "n1", type: "OUTBID", title: "t", body: "b", url: "/x", readAt: null, createdAt },
    ]);
    db.notification.count.mockResolvedValueOnce(1);
    const res = await listNotifications("u1");
    expect(db.notification.findMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(db.notification.count.mock.calls[0][0].where).toEqual({ userId: "u1", readAt: null });
    expect(res).toEqual({ items: [expect.objectContaining({ id: "n1", readAt: null })], unreadCount: 1 });
  });

  it("markNotificationRead solo marca la propia: la de otro usuario responde 404 y no se actualiza", async () => {
    db.notification.findFirst.mockResolvedValueOnce(null);
    await expect(markNotificationRead("userA", "n-de-B")).rejects.toMatchObject({ status: 404, code: "NOTIFICACION_NO_ENCONTRADA" });
    expect(db.notification.findFirst.mock.calls[0][0].where).toEqual({ id: "n-de-B", userId: "userA" });
    expect(db.notification.updateMany).not.toHaveBeenCalled();

    const readAt = new Date("2026-11-16T13:05:00.000Z");
    db.notification.findFirst
      .mockResolvedValueOnce({ id: "n1", type: "t", title: "t", body: "b", url: "/x", readAt: null, createdAt })
      .mockResolvedValueOnce({ id: "n1", type: "t", title: "t", body: "b", url: "/x", readAt, createdAt });
    db.notification.updateMany.mockResolvedValueOnce({ count: 1 });
    const ok = await markNotificationRead("userA", "n1");
    expect(db.notification.updateMany.mock.calls[0][0].where).toEqual({ id: "n1", userId: "userA", readAt: null });
    expect(ok.readAt).toBe(readAt.toISOString());

    // Idempotente: ya leída no vuelve a actualizar
    db.notification.findFirst.mockResolvedValueOnce({ id: "n1", type: "t", title: "t", body: "b", url: "/x", readAt, createdAt });
    await markNotificationRead("userA", "n1");
    expect(db.notification.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("Kevin 16/11 — Etapa 2: Aviso al líder superado en placeBid", () => {
  const activeBuyer = { status: "ACTIVA" as const, roles: [{ role: "COMPRADOR" as const }] };
  const makeActiveAuctionRow = () => ({
    id: "sub-1",
    articleId: "art-1",
    startingPrice: new Prisma.Decimal("150.00"),
    minIncrement: new Prisma.Decimal("10.00"),
    opensAt: new Date(Date.now() - 3_600_000),
    closesAt: new Date(Date.now() + 3_600_000),
    status: "ACTIVA" as const,
  });

  it("notifica al líder anterior (OUTBID) cuando otro comprador lo supera, sin revelar la identidad del nuevo postor", async () => {
    const emitFn = vi.fn();
    const toFn = vi.fn().mockReturnValue({ emit: emitFn });
    setSocketServer({ to: toFn } as never);

    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1", title: "Reloj Antiguo Suizo (Demo)" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    db.bid.findFirst.mockResolvedValueOnce({
      id: "bid-leader-old",
      amount: new Prisma.Decimal("150.00"),
      buyerId: "buyer-anterior",
    });
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-nuevo9" });
    const acceptedAt = new Date("2026-11-16T14:00:00.000Z");
    db.bid.create.mockResolvedValueOnce({
      id: "bid-new",
      amount: new Prisma.Decimal("160.00"),
      acceptedAt,
    });
    db.bid.count.mockResolvedValueOnce(2);
    db.notification.create.mockResolvedValueOnce({
      id: "notif-outbid-1",
      type: "OUTBID",
      title: "Tu oferta fue superada",
      body: "Otro participante registró una oferta mayor de $160.00 USD en «Reloj Antiguo Suizo (Demo)».",
      url: "/subastas/sub-1",
      readAt: null,
      createdAt: acceptedAt,
    });

    await placeBid({
      auctionId: "sub-1",
      buyerId: "buyer-nuevo",
      amount: "160.00",
      requestId: "req-outbid-1",
    });

    expect(db.notification.create).toHaveBeenCalledOnce();
    const createdNotifArg = db.notification.create.mock.calls[0][0].data;
    expect(createdNotifArg.userId).toBe("buyer-anterior");
    expect(createdNotifArg.type).toBe("OUTBID");
    expect(createdNotifArg.url).toBe("/subastas/sub-1");
    expect(createdNotifArg.body).toContain("«Reloj Antiguo Suizo (Demo)»");
    expect(createdNotifArg.body).not.toContain("#sub-1");
    expect(createdNotifArg.body).not.toContain("buyer-nuevo");
    expect(toFn).toHaveBeenCalledWith("user:buyer-anterior");
    setSocketServer(undefined as never);
  });

  it("no notifica si el mismo líder mejora su propia oferta ni en reintento idempotente", async () => {
    // 1. Mismo comprador supera su propia oferta
    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce(null);
    db.bid.findFirst.mockResolvedValueOnce({
      id: "bid-self",
      amount: new Prisma.Decimal("150.00"),
      buyerId: "buyer-1",
    });
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-self01" });
    db.bid.create.mockResolvedValueOnce({
      id: "bid-self-2",
      amount: new Prisma.Decimal("160.00"),
      acceptedAt: new Date(),
    });
    db.bid.count.mockResolvedValueOnce(2);

    await placeBid({
      auctionId: "sub-1",
      buyerId: "buyer-1",
      amount: "160.00",
      requestId: "req-self",
    });
    expect(db.notification.create).not.toHaveBeenCalled();

    // 2. Reintento idempotente
    db.user.findUnique.mockResolvedValueOnce(activeBuyer);
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1" });
    db.bid.findUnique.mockResolvedValueOnce({
      id: "bid-self-2",
      amount: new Prisma.Decimal("160.00"),
      acceptedAt: new Date(),
    });
    db.auctionAlias.findUnique.mockResolvedValueOnce({ alias: "Postor-self01" });
    db.bid.findFirst.mockResolvedValueOnce({ amount: new Prisma.Decimal("160.00") });
    db.bid.count.mockResolvedValueOnce(2);

    await placeBid({
      auctionId: "sub-1",
      buyerId: "buyer-1",
      amount: "160.00",
      requestId: "req-self",
    });
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe("Kevin 16/11 — Etapa 3: Rutas HTTP GET /api/notifications y PATCH /api/notifications/[id]", () => {
  const validToken = "a".repeat(64);
  const userASession = {
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "user-A",
      nombreCompleto: "Usuario A",
      email: "usera@pujafacil.test",
      status: "ACTIVA" as const,
      roles: [{ role: "COMPRADOR" as const }],
    },
  };

  it("GET /api/notifications exige sesión activa (401/403) y devuelve solo notificaciones propias de user-A", async () => {
    expect((await getNotificationsRoute(new Request("http://localhost:3000/api/notifications"))).status).toBe(401);

    db.session.findUnique.mockResolvedValueOnce({
      ...userASession,
      user: { ...userASession.user, status: "PENDIENTE" },
    });
    const pendRes = await getNotificationsRoute(
      new Request("http://localhost:3000/api/notifications", {
        headers: { cookie: `pf_session=${validToken}` },
      }),
    );
    expect(pendRes.status).toBe(403);

    const createdAt = new Date("2026-11-16T15:00:00.000Z");
    db.session.findUnique.mockResolvedValueOnce(userASession);
    db.notification.findMany.mockResolvedValueOnce([
      {
        id: "notif-A1",
        type: "OUTBID",
        title: "Tu oferta fue superada",
        body: "Nuevo monto $170.00",
        url: "/subastas/sub-1",
        readAt: null,
        createdAt,
      },
    ]);
    db.notification.count.mockResolvedValueOnce(1);

    const okRes = await getNotificationsRoute(
      new Request("http://localhost:3000/api/notifications", {
        headers: { cookie: `pf_session=${validToken}` },
      }),
    );
    expect(okRes.status).toBe(200);
    expect(db.notification.findMany.mock.calls[0][0].where).toEqual({ userId: "user-A" });
    expect(await okRes.json()).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "notif-A1",
            type: "OUTBID",
            title: "Tu oferta fue superada",
            body: "Nuevo monto $170.00",
            url: "/subastas/sub-1",
            readAt: null,
            createdAt: createdAt.toISOString(),
          },
        ],
        unreadCount: 1,
      },
    });
  });

  it("PATCH /api/notifications/[id] impide que user-A marque notificación de user-B (404) y marca correctamente la propia", async () => {
    // 1. Origen cruzado rechazado con 403
    const crossOriginReq = new Request("http://localhost:3000/api/notifications/notif-B1", {
      method: "PATCH",
      headers: { origin: "https://attacker.test", cookie: `pf_session=${validToken}` },
    });
    expect(
      (await patchNotificationReadRoute(crossOriginReq, { params: Promise.resolve({ id: "notif-B1" }) })).status,
    ).toBe(403);

    // 2. user-A intenta marcar notificación de user-B -> 404 NOTIFICACION_NO_ENCONTRADA
    db.session.findUnique.mockResolvedValueOnce(userASession);
    db.notification.findFirst.mockResolvedValueOnce(null);
    const patchOtherRes = await patchNotificationReadRoute(
      new Request("http://localhost:3000/api/notifications/notif-B1", {
        method: "PATCH",
        headers: { origin: "http://localhost:3000", cookie: `pf_session=${validToken}` },
      }),
      { params: Promise.resolve({ id: "notif-B1" }) },
    );
    expect(patchOtherRes.status).toBe(404);
    expect(db.notification.findFirst.mock.calls[0][0].where).toEqual({ id: "notif-B1", userId: "user-A" });
    expect(db.notification.updateMany).not.toHaveBeenCalled();

    // 3. user-A marca su propia notificación notif-A1 -> 200 con readAt poblado
    const createdAt = new Date("2026-11-16T15:00:00.000Z");
    const readAt = new Date("2026-11-16T15:02:00.000Z");
    db.session.findUnique.mockResolvedValueOnce(userASession);
    db.notification.findFirst
      .mockResolvedValueOnce({
        id: "notif-A1",
        type: "OUTBID",
        title: "Tu oferta fue superada",
        body: "Nuevo monto $170.00",
        url: "/subastas/sub-1",
        readAt: null,
        createdAt,
      })
      .mockResolvedValueOnce({
        id: "notif-A1",
        type: "OUTBID",
        title: "Tu oferta fue superada",
        body: "Nuevo monto $170.00",
        url: "/subastas/sub-1",
        readAt,
        createdAt,
      });
    db.notification.updateMany.mockResolvedValueOnce({ count: 1 });

    const patchOwnRes = await patchNotificationReadRoute(
      new Request("http://localhost:3000/api/notifications/notif-A1", {
        method: "PATCH",
        headers: { origin: "http://localhost:3000", cookie: `pf_session=${validToken}` },
      }),
      { params: Promise.resolve({ id: "notif-A1" }) },
    );
    expect(patchOwnRes.status).toBe(200);
    const body = await patchOwnRes.json();
    expect(body.ok).toBe(true);
    expect(body.data.notification.readAt).toBe(readAt.toISOString());
  });
});

describe("Kevin 16/11 — Etapa 5: Cierre y adjudicación de subastas (auction-closer.ts)", () => {
  const serverNow = new Date("2026-11-16T18:00:00.000Z");
  const pastOpen = new Date("2026-11-15T18:00:00.000Z");
  const pastClose = new Date("2026-11-16T17:59:00.000Z");

  it("closeDueAuctions cierra subasta vencida sin ofertas como CERRADA_SIN_OFERTAS y emite auction:updated", async () => {
    const emitFn = vi.fn();
    const toFn = vi.fn().mockReturnValue({ emit: emitFn });
    setSocketServer({ to: toFn } as never);

    db.auction.findMany.mockResolvedValueOnce([{ id: "sub-empty" }]);
    db.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-empty",
        articleId: "art-1",
        opensAt: pastOpen,
        closesAt: pastClose,
        status: "ACTIVA",
        winnerBidId: null,
        closedAt: null,
      },
    ]);
    db.bid.findFirst.mockResolvedValueOnce(null);
    db.bid.count.mockResolvedValueOnce(0);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1", title: "Lámpara Art Déco" });
    db.auction.update.mockResolvedValueOnce({});
    db.notification.create.mockResolvedValueOnce({
      id: "notif-seller",
      type: "AUCTION_CLOSED",
      title: "Subasta finalizada",
      body: "La subasta finalizó sin ofertas",
      url: "/subastas/sub-empty",
      readAt: null,
      createdAt: serverNow,
    });

    const results = await closeDueAuctions(serverNow);
    expect(results).toEqual([
      {
        auctionId: "sub-empty",
        status: "CERRADA_SIN_OFERTAS",
        winnerBidId: null,
        winnerBuyerId: null,
        highestBid: null,
        bidCount: 0,
        closedAt: serverNow.toISOString(),
      },
    ]);
    expect(db.auction.update).toHaveBeenCalledWith({
      where: { id: "sub-empty" },
      data: {
        status: "CERRADA_SIN_OFERTAS",
        winnerBidId: null,
        closedAt: serverNow,
      },
    });
    expect(toFn).toHaveBeenCalledWith("auction:sub-empty");
    expect(emitFn).toHaveBeenCalledWith("auction:updated", {
      auctionId: "sub-empty",
      highestBid: null,
      bidCount: 0,
      status: "CERRADA_SIN_OFERTAS",
      closesAt: pastClose.toISOString(),
    });
    setSocketServer(undefined as never);
  });

  it("closeDueAuctions adjudica con oferta ganadora (monto desc, acceptedAt asc, id asc), guarda winnerBidId y notifica ganador", async () => {
    const emitFn = vi.fn();
    const toFn = vi.fn().mockReturnValue({ emit: emitFn });
    setSocketServer({ to: toFn } as never);

    db.auction.findMany.mockResolvedValueOnce([{ id: "sub-win" }]);
    db.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-win",
        articleId: "art-1",
        opensAt: pastOpen,
        closesAt: pastClose,
        status: "ACTIVA",
        winnerBidId: null,
        closedAt: null,
      },
    ]);
    db.bid.findFirst.mockResolvedValueOnce({
      id: "bid-winner-99",
      buyerId: "buyer-ganador",
      amount: new Prisma.Decimal("250.00"),
    });
    db.bid.count.mockResolvedValueOnce(4);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1", title: "Reloj Suizo" });
    db.auction.update.mockResolvedValueOnce({});
    db.notification.create
      .mockResolvedValueOnce({
        id: "notif-win",
        type: "AUCTION_WON",
        title: "¡Ganaste la subasta!",
        body: "Tu oferta de $250.00 USD resultó adjudicada en «Reloj Suizo».",
        url: "/subastas/sub-win",
        readAt: null,
        createdAt: serverNow,
      })
      .mockResolvedValueOnce({
        id: "notif-seller-win",
        type: "AUCTION_CLOSED",
        title: "Subasta finalizada",
        body: "La subasta finalizó como ADJUDICADA",
        url: "/subastas/sub-win",
        readAt: null,
        createdAt: serverNow,
      });

    const results = await closeDueAuctions(serverNow);

    // Verifica el criterio de desempate en la consulta a Bid
    expect(db.bid.findFirst.mock.calls[0][0].orderBy).toEqual([
      { amount: "desc" },
      { acceptedAt: "asc" },
      { id: "asc" },
    ]);
    expect(db.auction.update).toHaveBeenCalledWith({
      where: { id: "sub-win" },
      data: {
        status: "ADJUDICADA",
        winnerBidId: "bid-winner-99",
        closedAt: serverNow,
      },
    });
    expect(results).toEqual([
      {
        auctionId: "sub-win",
        status: "ADJUDICADA",
        winnerBidId: "bid-winner-99",
        winnerBuyerId: "buyer-ganador",
        highestBid: "250.00",
        bidCount: 4,
        closedAt: serverNow.toISOString(),
      },
    ]);
    expect(toFn).toHaveBeenCalledWith("user:buyer-ganador");
    setSocketServer(undefined as never);
  });

  it("closeDueAuctions es idempotente: si la subasta ya fue cerrada por otra ejecución, no vuelve a adjudicar ni a notificar", async () => {
    db.auction.findMany.mockResolvedValueOnce([{ id: "sub-already" }]);
    // Al adquirir el bloqueo SELECT FOR UPDATE, el status ya cambió a ADJUDICADA
    db.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-already",
        articleId: "art-1",
        opensAt: pastOpen,
        closesAt: pastClose,
        status: "ADJUDICADA",
        winnerBidId: "bid-1",
        closedAt: pastClose,
      },
    ]);

    const results = await closeDueAuctions(serverNow);
    expect(results).toEqual([]);
    expect(db.auction.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("cierra una programada que venció mientras el servidor estuvo apagado", async () => {
    db.auction.findMany.mockResolvedValueOnce([{ id: "programada-vencida" }]);
    db.$queryRaw.mockResolvedValueOnce([{ id: "programada-vencida", articleId: "art-1", opensAt: pastOpen, closesAt: pastClose, status: "PROGRAMADA", winnerBidId: null, closedAt: null }]);
    db.bid.findFirst.mockResolvedValueOnce(null); db.bid.count.mockResolvedValueOnce(0);
    db.article.findUnique.mockResolvedValueOnce(null); db.auction.update.mockResolvedValueOnce({});
    const result = await closeDueAuctions(serverNow);
    expect(result[0].status).toBe("CERRADA_SIN_OFERTAS");
    expect(db.auction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ["ACTIVA", "PROGRAMADA"] }, closesAt: { lte: serverNow } } }));
  });

  it("activateDueAuctions actualiza PROGRAMADA -> ACTIVA transaccionalmente cuando llegó la hora de apertura", async () => {
    const futureClose = new Date("2026-11-17T18:00:00.000Z");
    db.auction.findMany.mockResolvedValueOnce([{ id: "sub-prog" }]);
    db.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-prog",
        articleId: "art-1",
        opensAt: pastOpen,
        closesAt: futureClose,
        status: "PROGRAMADA",
        winnerBidId: null,
        closedAt: null,
      },
    ]);
    db.auction.update.mockResolvedValueOnce({});
    db.bid.findFirst.mockResolvedValueOnce(null);
    db.bid.count.mockResolvedValueOnce(0);

    const activated = await activateDueAuctions(serverNow);
    expect(activated).toEqual([
      {
        auctionId: "sub-prog",
        status: "ACTIVA",
        opensAt: pastOpen.toISOString(),
        closesAt: futureClose.toISOString(),
      },
    ]);
    expect(db.auction.update).toHaveBeenCalledWith({
      where: { id: "sub-prog" },
      data: { status: "ACTIVA" },
    });
  });
});

describe("Kevin 16/11 — Etapa 6: Planificador único cada 10 s en el servidor Socket.IO", () => {
  it("startAuctionScheduler registra un único intervalo de 10 s, ejecuta activateDueAuctions/closeDueAuctions y se limpia al cerrar el servidor", async () => {
    vi.useFakeTimers();
    try {
      let closeListener: (() => void) | undefined;
      const fakeIo = {
        httpServer: {
          once: vi.fn((event: string, cb: () => void) => {
            if (event === "close") closeListener = cb;
          }),
        },
      };

      db.auction.findMany.mockResolvedValue([]);
      expect(AUCTION_SCHEDULER_INTERVAL_MS).toBe(10_000);

      startAuctionScheduler(fakeIo as never);
      expect(fakeIo.httpServer.once).toHaveBeenCalledWith("close", expect.any(Function));

      await vi.advanceTimersByTimeAsync(10_000);
      // En un tick se consultan programadas y activas vencidas
      expect(db.auction.findMany).toHaveBeenCalledTimes(2);

      // Al dispararse el evento close del httpServer se detiene el intervalo
      closeListener?.();
      db.auction.findMany.mockClear();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(db.auction.findMany).not.toHaveBeenCalled();

      // runAuctionLifecycleTick evita solapamiento si ya está en curso
      db.auction.findMany.mockResolvedValue([]);
      await runAuctionLifecycleTick();
      expect(db.auction.findMany).toHaveBeenCalledTimes(2);
    } finally {
      stopAuctionScheduler();
      vi.useRealTimers();
    }
  });
});

describe("Kevin 17/11 — Verificación final: 5 casos negativos obligatorios de API y concurrencia", () => {
  const validToken = "a".repeat(64);
  const ctx = { params: Promise.resolve({ id: "sub-17" }) };
  const makeActiveAuctionRow = () => ({
    id: "sub-17",
    articleId: "art-17",
    startingPrice: new Prisma.Decimal("150.00"),
    minIncrement: new Prisma.Decimal("10.00"),
    opensAt: new Date(Date.now() - 3_600_000),
    closesAt: new Date(Date.now() + 3_600_000),
    status: "ACTIVA" as const,
  });

  it("Caso negativo 1: Invitado sin sesión recibe 401 NO_AUTENTICADO en POST /api/auctions/[id]/bids", async () => {
    const req = new Request("http://localhost:3000/api/auctions/sub-17/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "150.00", requestId: "req-guest-17" }),
    });

    const res = await postAuctionBidRoute(req, ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: { code: "NO_AUTENTICADO" },
    });
  });

  it("Caso negativo 2: Usuario PENDIENTE recibe 403 CUENTA_NO_ACTIVA en POST /api/auctions/[id]/bids", async () => {
    db.session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "user-pendiente",
        nombreCompleto: "Usuario Pendiente",
        email: "pendiente@pujafacil.test",
        status: "PENDIENTE",
        roles: [{ role: "COMPRADOR" }],
      },
    });

    const req = new Request("http://localhost:3000/api/auctions/sub-17/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "150.00", requestId: "req-pend-17" }),
    });

    const res = await postAuctionBidRoute(req, ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: { code: "CUENTA_NO_ACTIVA" },
    });
  });

  it("Caso negativo 3: Vendedor propietario del propio artículo recibe 403 OWN_ITEM en POST /api/auctions/[id]/bids", async () => {
    db.session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "vendedor-propietario",
        nombreCompleto: "Vendedor Propietario",
        email: "vendedor@pujafacil.test",
        status: "ACTIVA",
        roles: [{ role: "COMPRADOR" }, { role: "VENDEDOR" }],
      },
    });
    db.user.findUnique.mockResolvedValueOnce({
      status: "ACTIVA",
      roles: [{ role: "COMPRADOR" }, { role: "VENDEDOR" }],
    });
    db.$queryRaw.mockResolvedValueOnce([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValueOnce({
      ownerId: "vendedor-propietario",
      title: "Reloj del Vendedor",
    });

    const req = new Request("http://localhost:3000/api/auctions/sub-17/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "150.00", requestId: "req-own-17" }),
    });

    const res = await postAuctionBidRoute(req, ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: { code: "OWN_ITEM" },
    });
  });

  it("Caso negativo 4: 2 pujas simultáneas al mismo mínimo en POST /api/auctions/[id]/bids -> solo 1 aceptada (201) y la otra rechazada (409 BID_TOO_LOW)", async () => {
    let highestInDb: { id: string; amount: Prisma.Decimal; buyerId: string } | null = null;
    const tokenBuyer1 = "1".repeat(64);
    const tokenBuyer2 = "2".repeat(64);

    db.session.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => {
      const isFirst = where.tokenHash.startsWith("6b") || !highestInDb;
      return {
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: isFirst ? "buyer-1" : "buyer-2",
          nombreCompleto: isFirst ? "Comprador 1" : "Comprador 2",
          email: isFirst ? "c1@pujafacil.test" : "c2@pujafacil.test",
          status: "ACTIVA" as const,
          roles: [{ role: "COMPRADOR" as const }],
        },
      };
    });
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVA",
      roles: [{ role: "COMPRADOR" }],
    });
    db.$queryRaw.mockResolvedValue([makeActiveAuctionRow()]);
    db.article.findUnique.mockResolvedValue({ ownerId: "vendedor-ajeno", title: "Lote Disputado" });
    db.bid.findUnique.mockResolvedValue(null);
    db.bid.findFirst.mockImplementation(async () => highestInDb);
    db.auctionAlias.findUnique.mockResolvedValue({ alias: "Postor-disp17" });
    db.bid.create.mockImplementation(async ({ data }: { data: { buyerId: string; amount: string } }) => {
      const created = {
        id: `bid-${data.buyerId}`,
        amount: new Prisma.Decimal(data.amount),
        acceptedAt: new Date("2026-11-17T10:00:00.000Z"),
      };
      highestInDb = { id: created.id, amount: created.amount, buyerId: data.buyerId };
      return created;
    });
    db.bid.count.mockResolvedValue(1);

    const req1 = new Request("http://localhost:3000/api/auctions/sub-17/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${tokenBuyer1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "150.00", requestId: "req-simul-1" }),
    });
    const req2 = new Request("http://localhost:3000/api/auctions/sub-17/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${tokenBuyer2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "150.00", requestId: "req-simul-2" }),
    });

    const res1 = await postAuctionBidRoute(req1, ctx);
    const res2 = await postAuctionBidRoute(req2, ctx);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2).toMatchObject({
      ok: false,
      error: {
        code: "BID_TOO_LOW",
        details: { minRequired: "160.00", highestBid: "150.00" },
      },
    });
  });

  it("Caso negativo 5: Oferta después del cierre oficial recibe 409 AUCTION_NOT_ACTIVE en POST /api/auctions/[id]/bids", async () => {
    db.session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "buyer-1",
        nombreCompleto: "Comprador 1",
        email: "comprador1@pujafacil.test",
        status: "ACTIVA",
        roles: [{ role: "COMPRADOR" }],
      },
    });
    db.user.findUnique.mockResolvedValueOnce({
      status: "ACTIVA",
      roles: [{ role: "COMPRADOR" }],
    });
    db.$queryRaw.mockResolvedValueOnce([
      {
        ...makeActiveAuctionRow(),
        closesAt: new Date(Date.now() - 5_000), // Cerró hace 5 segundos según reloj del servidor
      },
    ]);
    db.article.findUnique.mockResolvedValueOnce({ ownerId: "vendedor-1", title: "Lote Cerrado" });
    db.bid.findUnique.mockResolvedValueOnce(null);

    const req = new Request("http://localhost:3000/api/auctions/sub-17/bids", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `pf_session=${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: "180.00", requestId: "req-after-close-17" }),
    });

    const res = await postAuctionBidRoute(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: { code: "AUCTION_NOT_ACTIVE" },
    });
  });
});

