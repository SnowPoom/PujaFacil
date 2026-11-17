/** Cierre Apps, martes 17/11. Con PostgreSQL migrado y npm run dev:
 * node --env-file=.env --import tsx src/tests/auth-c3.integration.ts
 * --evidence pausa con una cuenta ficticia pendiente para verificar /panel en navegador.
 * Complementa C0/C1/C2: usa transporte WebSocket real, sin simular el handshake.
 * Los cambios directos de estado son fixtures; la activación administrativa se prueba en C1.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@/lib/prisma";
import { encryptCedula } from "@/lib/auth/crypto";
import { hashToken } from "@/lib/auth/session";
import type { ChatJoinAck, ChatSendAck } from "@/server/socket/index";
import type { ChatMessageDto } from "@/modules/chat/chat-rules";

const origin = "http://localhost:3000";
const password = "Frase ficticia para el cierre del martes!";
const emails: string[] = [];
const sockets: Socket[] = [];
let phase = "disponibilidad";
const call = (url: string, cookie?: string, body?: unknown) => fetch(`${origin}${url}`, {
  method: body === undefined ? "GET" : "POST", redirect: "manual", signal: AbortSignal.timeout(30_000),
  headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function fixture(status: "PENDIENTE" | "ACTIVA") {
  const email = `auth-c3-${randomUUID()}@example.test`;
  emails.push(email);
  return prisma.user.create({ data: {
    email, nombreCompleto: "Cuenta ficticia C3", status,
    cedulaCifrada: encryptCedula("1234567890"), passwordHash: await bcrypt.hash(password, 12),
    roles: { create: [{ role: "COMPRADOR" }, { role: "VENDEDOR" }] },
  } });
}
async function login(email: string) {
  const response = await call("/api/auth/login", undefined, { email, password });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie")!;
  for (const flag of ["pf_session=", "HttpOnly", "SameSite=Lax", "Path=/"]) assert.ok(header.includes(flag));
  return header.split(";")[0];
}
function connection(cookie?: string) {
  const socket = io(origin, { autoConnect: false, reconnection: false, transports: ["websocket"],
    timeout: 10_000, extraHeaders: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  sockets.push(socket);
  return socket;
}
async function connect(socket: Socket, accepted = true) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("Tiempo de handshake agotado.")), 15_000);
    const success = () => done(accepted ? undefined : new Error("Handshake aceptó una sesión inválida."));
    const failure = (error: Error) => done(!accepted && error.message === "UNAUTHORIZED" ? undefined : error);
    function done(error?: Error) {
      clearTimeout(timer); socket.off("connect", success); socket.off("connect_error", failure);
      if (error) reject(error); else resolve();
    }
    socket.once("connect", success); socket.once("connect_error", failure); socket.connect();
  });
  if (accepted) assert.equal(socket.io.engine.transport.name, "websocket");
  else socket.disconnect();
}
const join = (socket: Socket) => socket.timeout(10_000).emitWithAck("chat:join", { room: "general" }) as Promise<ChatJoinAck>;
const send = (socket: Socket, text: string) => socket.timeout(10_000).emitWithAck("chat:send", {
  room: "general", text, clientMessageId: randomUUID(),
}) as Promise<ChatSendAck>;

async function main() {
  if (process.argv.includes("--evidence") && !process.stdin.isTTY) {
    throw new Error("El modo de evidencia requiere una terminal interactiva.");
  }
  try {
    for (const url of ["/", "/registro", "/iniciar-sesion", "/subastas", "/api/public/articles", "/api/auctions"]) {
      const response = await call(url);
      assert.equal(response.status, 200, url);
      await response.arrayBuffer();
    }
    console.log("PASS C3: catálogo, subastas públicas y páginas de acceso disponibles.");
    const pending = await fixture("PENDIENTE"), peer = await fixture("ACTIVA");
    const cookie = await login(pending.email), peerCookie = await login(peer.email);
    phase = "handshake WebSocket real";
    await connect(connection(), false);
    await connect(connection("pf_session=invalida"), false);
    const socket = connection(cookie), other = connection(peerCookie);
    await connect(socket); await connect(other);
    console.log("PASS C3: sin cookie/cookie inválida rechazadas; pf_session de login usa WebSocket real.");

    phase = "operaciones pendientes";
    const pendingJoin = await join(socket);
    assert.deepEqual(pendingJoin.ok, false);
    if (!pendingJoin.ok) assert.equal(pendingJoin.error.code, "CUENTA_NO_ACTIVA");
    const pendingSend = await send(socket, "Mensaje ficticio que debe rechazarse.");
    assert.equal(pendingSend.ok, false);
    if (!pendingSend.ok) assert.equal(pendingSend.error.code, "CUENTA_NO_ACTIVA");
    for (const [url, body] of [
      ["/api/articles", {}],
      ["/api/auctions/cmwi7cxk10000pf01a1b2c3d4/bids", { amount: "151.00", requestId: randomUUID() }],
      ["/api/chat/messages?room=general", undefined],
    ] as const) {
      const response = await call(url, cookie, body);
      assert.equal(response.status, 403, url);
      assert.equal((await response.json()).error.code, "CUENTA_NO_ACTIVA");
    }
    assert.equal(await prisma.chatMessage.count({ where: { authorId: pending.id } }), 0);
    assert.equal(await prisma.article.count({ where: { ownerId: pending.id } }), 0);
    assert.equal(await prisma.bid.count({ where: { buyerId: pending.id } }), 0);
    const panel = await call("/panel", cookie);
    assert.equal(panel.status, 200);
    assert.ok((await panel.text()).includes("Pendiente de aprobación"));
    console.log("PASS C3: pendiente ve panel; publicar, pujar, historial, chat:join y chat:send denegados sin persistir operaciones.");
    if (process.argv.includes("--evidence")) {
      console.log(`EVIDENCE cuenta ficticia pendiente: ${pending.email}`);
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question("EVIDENCE: Enter para continuar y limpiar fixtures.\n"); }
      finally { terminal.close(); }
    }

    phase = "revalidación de estado y difusión entre clientes";
    await prisma.user.update({ where: { id: pending.id }, data: { status: "ACTIVA" } });
    assert.equal((await join(socket)).ok, true);
    assert.equal((await join(other)).ok, true);
    // Un UUID con muchos dígitos puede activar legítimamente el filtro de teléfono.
    // El marcador sigue siendo único sin parecer un dato personal.
    const text = `Mensaje ficticio C3 ${randomUUID().replace(/\d/g, "x")}`;
    const received = new Promise<ChatMessageDto>((resolve, reject) => {
      const timer = setTimeout(() => { other.off("chat:new", onMessage); reject(new Error("Falta difusión entre clientes.")); }, 10_000);
      function onMessage(message: ChatMessageDto) {
        if (message.text !== text) return;
        clearTimeout(timer); other.off("chat:new", onMessage); resolve(message);
      }
      other.on("chat:new", onMessage);
    });
    const [sent, message] = await Promise.all([send(socket, text), received]);
    assert.equal(sent.ok, true);
    assert.deepEqual(Object.keys(message).sort(), ["authorAlias", "createdAt", "id", "room", "text"]);
    assert.equal(message.authorAlias, "Participante");
    const persisted = await prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } });
    assert.equal(persisted.authorId, pending.id); assert.equal(persisted.text, text);
    for (const secret of [pending.email, pending.id, pending.nombreCompleto, pending.cedulaCifrada, pending.passwordHash]) {
      assert.ok(!JSON.stringify(message).includes(secret));
    }
    await prisma.user.update({ where: { id: pending.id }, data: { status: "PENDIENTE" } });
    const downgraded = await send(socket, "Este mensaje tampoco debe persistirse.");
    assert.equal(downgraded.ok, false);
    if (!downgraded.ok) assert.equal(downgraded.error.code, "CUENTA_NO_ACTIVA");
    assert.equal(await prisma.chatMessage.count({ where: { authorId: pending.id } }), 1);
    console.log("PASS C3: mismo socket revalida ACTIVA/PENDIENTE; dos clientes reciben mensaje persistido con alias y sin identidad.");

    phase = "suspensión y revocación del handshake";
    await prisma.user.update({ where: { id: pending.id }, data: { status: "SUSPENDIDA" } });
    // El servidor desconecta al revalidar; el ACK puede perderse, observar disconnect.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.off("disconnect", disconnected); reject(new Error("Falta desconexión tras suspensión.")); }, 10_000);
      function disconnected() { clearTimeout(timer); resolve(); }
      socket.once("disconnect", disconnected);
      socket.emit("chat:join", { room: "general" });
    });
    assert.equal((await call("/api/auth/me", cookie)).status, 401);
    await connect(connection(cookie), false);
    other.disconnect();
    assert.equal((await call("/api/auth/logout", peerCookie, {})).status, 200);
    assert.equal((await call("/api/auth/me", peerCookie)).status, 401);
    await connect(connection(peerCookie), false);
    const expiringCookie = await login(peer.email);
    await prisma.session.update({ where: { tokenHash: hashToken(expiringCookie.split("=")[1]) }, data: { expiresAt: new Date(0) } });
    await connect(connection(expiringCookie), false);
    console.log("PASS C3: suspensión desconecta; nuevos handshakes rechazan suspensión, logout y sesión caducada.");
  } finally {
    for (const socket of sockets) { socket.removeAllListeners(); socket.disconnect(); }
    try {
      const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map(({ id }) => id);
      await prisma.$transaction(async (tx) => {
        // Mismo orden que el guard de sockets y reset, también durante teardown.
        if (ids.length) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
        await tx.chatMessage.deleteMany({ where: { authorId: { in: ids } } });
        await tx.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
        await tx.session.deleteMany({ where: { userId: { in: ids } } });
        await tx.userRole.deleteMany({ where: { userId: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      });
      assert.equal(await prisma.user.count({ where: { email: { in: emails } } }), 0);
      assert.equal(await prisma.chatMessage.count({ where: { authorId: { in: ids } } }), 0);
      console.log("PASS C3: limpieza de cuentas, mensajes, sesiones, roles y auditoría propios.");
    } finally { await prisma.$disconnect(); }
  }
}
main().catch((error: unknown) => {
  const location = error instanceof Error ? error.stack?.split("\n").find((line) => line.trim().startsWith("at ") && line.includes("auth-c3.integration.ts:")) : undefined;
  console.error(`FAIL C3 en ${phase}.${location ?? ""} No se imprimen credenciales.`); process.exitCode = 1;
});
