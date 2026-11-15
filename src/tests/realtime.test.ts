import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  session: { findUnique: vi.fn() },
  auction: { findUnique: vi.fn() },
  auctionAlias: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  chatMessage: { create: vi.fn(), findMany: vi.fn() },
}));

vi.mock("../lib/prisma", () => ({ prisma: db }));

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
  authenticateSocketHandshake,
  countDistinctRoomUsers,
  emitRoomPresence,
  handleChatJoin,
  handleChatSend,
  revalidateSocketAccount,
} from "../server/socket/index";
import { GET as getChatMessages } from "../app/api/chat/messages/route";

beforeEach(() => {
  vi.resetAllMocks();
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
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }, { role: "VENDEDOR" }] });
    const okRes = await revalidateSocketAccount(socket as never);
    expect(okRes).toEqual({ ok: true, userId: "u1", roles: ["COMPRADOR", "VENDEDOR"], status: "ACTIVA" });
    expect(disconnect).not.toHaveBeenCalled();

    // Caso 2: Cuenta PENDIENTE -> devuelve 403 sin desconectar forzosamente
    db.user.findUnique.mockResolvedValueOnce({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    const pendingRes = await revalidateSocketAccount(socket as never);
    expect(pendingRes).toMatchObject({ ok: false, error: { status: 403, code: "CUENTA_NO_ACTIVA" }, disconnected: false });
    expect(disconnect).not.toHaveBeenCalled();

    // Caso 3: Cuenta SUSPENDIDA -> devuelve 403 y desconecta el socket
    db.user.findUnique.mockResolvedValueOnce({ status: "SUSPENDIDA", roles: [{ role: "COMPRADOR" }] });
    const revokedRes = await revalidateSocketAccount(socket as never);
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
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
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

    await handleChatJoin(io as never, socket as never, { room: "auction:demo-subasta-programada" }, ack);

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
    db.user.findUnique.mockResolvedValueOnce({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    const ackPending = vi.fn();
    await handleChatJoin({} as never, socket as never, { room: "general" }, ackPending);
    expect(ackPending).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 403, code: "CUENTA_NO_ACTIVA" }),
    });
    expect(join).not.toHaveBeenCalled();

    // Subasta inexistente con cuenta ACTIVA
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    db.auction.findUnique.mockResolvedValueOnce(null);
    const ackNotFound = vi.fn();
    await handleChatJoin({} as never, socket as never, { room: "auction:no-existe" }, ackNotFound);
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

    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
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
      socket as never,
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
    db.user.findUnique.mockResolvedValueOnce({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    const socketPending = {
      id: "s-pend",
      data: { userId: "u-pend", roles: ["COMPRADOR"], status: "PENDIENTE" },
      rooms: new Set(["s-pend", "general"]),
      disconnect: vi.fn(),
    };
    const ackPending = vi.fn();
    await handleChatSend(io as never, socketPending as never, { room: "general", text: "Hola", clientMessageId: "c1" }, ackPending);
    expect(ackPending).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 403, code: "CUENTA_NO_ACTIVA" }),
    });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
    expect(emitFn).not.toHaveBeenCalled();

    // 2. Cuenta ACTIVA pero no unida a la sala
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    const socketNotJoined = {
      id: "s-active",
      data: { userId: "u1", roles: ["COMPRADOR"], status: "ACTIVA" },
      rooms: new Set(["s-active"]), // No está en "general"
      disconnect: vi.fn(),
    };
    const ackNotJoined = vi.fn();
    await handleChatSend(io as never, socketNotJoined as never, { room: "general", text: "Hola", clientMessageId: "c2" }, ackNotJoined);
    expect(ackNotJoined).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ status: 403, code: "NO_UNIDO_A_SALA" }),
    });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
    expect(emitFn).not.toHaveBeenCalled();
  });

  it("handleChatSend rechaza payload inválido de Zod (400) sin escribir en base de datos", async () => {
    db.user.findUnique.mockResolvedValueOnce({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
    const socket = {
      id: "s1",
      data: { userId: "u1", roles: ["COMPRADOR"], status: "ACTIVA" },
      rooms: new Set(["s1", "general"]),
      disconnect: vi.fn(),
    };
    const ack = vi.fn();
    await handleChatSend({} as never, socket as never, { room: "general", text: "   ", clientMessageId: "" }, ack);
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
