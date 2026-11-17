/** Verificación adicional del cierre 17/11, independiente de Vitest y de C3.
 * Con PostgreSQL migrado y npm run dev:
 * node --env-file=.env --import tsx src/tests/auth-socket-session.integration.ts
 * --delivery-burst ejecuta únicamente la ráfaga, conservando su limpieza.
 * Mantiene abierto el socket al revocar la sesión; no modifica módulos ajenos.
 * Un reset preparado en DB es un fixture: el consumo se realiza por HTTP real.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@/lib/prisma";
import { encryptCedula } from "@/lib/auth/crypto";
import { getUserFromCookieHeader, hashToken } from "@/lib/auth/session";
import type { ChatJoinAck, ChatSendAck } from "@/server/socket/index";
import { setTimeout as delay } from "node:timers/promises";
import { bindSocketSession, withSocketSession } from "@/lib/auth/socket-session";
import { saveMessage } from "@/modules/chat/chat-service";

const origin = "http://localhost:3000";
const password = "Frase ficticia para verificar sesiones activas!";
const emails: string[] = [];
const sockets: Socket[] = [];
const failures: string[] = [];
const auctionIds: string[] = [];
const articleIds: string[] = [];
let phase = "preparación";
const call = (url: string, cookie?: string, body?: unknown) => fetch(`${origin}${url}`, {
  method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(30_000),
  headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function connect(cookie: string) {
  const socket = io(origin, { autoConnect: false, reconnection: false, transports: ["websocket"],
    timeout: 10_000, extraHeaders: { Origin: origin, Cookie: cookie } });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve); socket.once("connect_error", reject); socket.connect();
  });
  assert.equal(socket.io.engine.transport.name, "websocket");
  const joined: ChatJoinAck = await socket.timeout(10_000).emitWithAck("chat:join", { room: "general" });
  assert.equal(joined.ok, true);
  return socket;
}
async function sendAfterRevocation(socket: Socket, text: string) {
  if (!socket.connected) return "disconnected" as const;
  return new Promise<ChatSendAck | "disconnected">((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Sin ACK ni desconexión tras revocación.")), 10_000);
    const disconnected = () => finish(undefined, "disconnected");
    function finish(error?: Error, result?: ChatSendAck | "disconnected") {
      clearTimeout(timer); socket.off("disconnect", disconnected);
      if (error) reject(error); else resolve(result!);
    }
    socket.once("disconnect", disconnected);
    socket.emit("chat:send", { room: "general", text, clientMessageId: randomUUID() },
      (result: ChatSendAck) => finish(undefined, result));
  });
}
async function fixture(role: "COMPRADOR" | "VENDEDOR" = "COMPRADOR") {
  const email = `auth-session17-${randomUUID()}@example.test`; emails.push(email);
  return prisma.user.create({ data: { email, nombreCompleto: "Cuenta ficticia sesiones 17", status: "ACTIVA",
    passwordHash: await bcrypt.hash(password, 12), cedulaCifrada: encryptCedula("1234567890"), roles: { create: { role } } } });
}
async function credential(email: string) {
  const response = await call("/api/auth/login", undefined, { email, password });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
function event(socket: Socket, name: string, matches: (payload: Record<string, unknown>) => boolean = () => true) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, receive); reject(new Error(`Falta evento ${name} para sesión válida.`)); }, 10_000);
    function receive(payload: Record<string, unknown>) {
      if (!matches(payload)) return;
      clearTimeout(timer); socket.off(name, receive); resolve(payload);
    }
    socket.on(name, receive);
  });
}
async function reconnectRejected(cookie: string) {
  const socket = io(origin, { autoConnect: false, reconnection: false, transports: ["websocket"], timeout: 5000,
    extraHeaders: { Origin: origin, Cookie: cookie } });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => reject(new Error("Reconexión inválida aceptada.")));
    socket.once("connect_error", (error) => { try { assert.equal(error.message, "UNAUTHORIZED"); resolve(); } catch (failure) { reject(failure); } });
    socket.connect();
  });
  socket.disconnect();
}
async function disconnected(socket: Socket) {
  if (!socket.connected) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("disconnect", done); reject(new Error("No se desconectó la sesión revocada.")); }, 5000);
    function done() { clearTimeout(timer); resolve(); }
    socket.once("disconnect", done);
  });
}
async function privateDeliveryMatrix() {
  const sender = await fixture(), owner = await fixture("VENDEDOR");
  const senderCookie = await credential(sender.email);
  const senderGeneral = await connect(senderCookie), senderAuction = await connect(senderCookie);
  await reconnectRejected("pf_session=invalida");
  for (const scenario of ["logout", "caducidad", "caducidad-natural", "reset", "SUSPENDIDA", "CERRADA", "roles-invalidos", "PENDIENTE"] as const) {
    phase = `recepción privada ${scenario}`;
    const user = await fixture();
    const cookie = await credential(user.email), secondCookie = await credential(user.email);
    const article = await prisma.article.create({ data: { ownerId: owner.id, title: "Artículo ficticio de sesiones", description: "Fixture de integración de privacidad", category: "PRUEBA", condition: "FICTICIA", provenance: "Prueba local", initialPrice: "100.00", status: "ASOCIADO_SUBASTA" } });
    articleIds.push(article.id);
    const auction = await prisma.auction.create({ data: { articleId: article.id, createdById: owner.id, startingPrice: "100.00", minIncrement: "10.00", opensAt: new Date(Date.now() - 60_000), closesAt: new Date(Date.now() + 3_600_000), status: "ACTIVA" } });
    auctionIds.push(auction.id);
    await prisma.bid.create({ data: { auctionId: auction.id, buyerId: user.id, amount: "100.00", requestId: randomUUID() } });
    const expiresAt = new Date(Date.now() + 3000);
    if (scenario === "caducidad-natural") await prisma.session.update({ where: { tokenHash: hashToken(cookie.split("=")[1]) }, data: { expiresAt } });
    const first = [await connect(cookie), await connect(cookie)];
    const second = [await connect(secondCookie), await connect(secondCookie)];
    for (const socket of [first[1], second[1], senderAuction]) {
      const joined: ChatJoinAck = await socket.timeout(10_000).emitWithAck("chat:join", { room: `auction:${auction.id}` });
      assert.equal(joined.ok, true);
    }
    const received = new Map<Socket, string[]>();
    for (const socket of [...first, ...second]) {
      const events: string[] = []; received.set(socket, events);
      socket.onAny((name) => { if (["chat:new", "chat:presence", "auction:updated", "notification:new"].includes(name)) events.push(name); });
    }
    if (scenario === "logout") {
      assert.equal((await call("/api/auth/logout", cookie, {})).status, 200);
      await Promise.all(first.map(disconnected));
    }
    else if (scenario === "caducidad") await prisma.session.update({ where: { tokenHash: hashToken(cookie.split("=")[1]) }, data: { expiresAt: new Date(0) } });
    else if (scenario === "caducidad-natural") await delay(Math.max(0, expiresAt.getTime() - Date.now()) + 50);
    else if (scenario === "reset") {
      const token = randomBytes(32).toString("hex");
      await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600_000) } });
      assert.equal((await call("/api/auth/reset-password", undefined, { token, newPassword: "Otra frase ficticia para revocar sesiones!" })).status, 200);
      assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
      await Promise.all([...first, ...second].map(disconnected));
    } else if (scenario === "roles-invalidos") await prisma.userRole.deleteMany({ where: { userId: user.id } });
    else await prisma.user.update({ where: { id: user.id }, data: { status: scenario } });

    const secondValid = ["logout", "caducidad", "caducidad-natural"].includes(scenario);
    const blocked = secondValid ? first : [...first, ...second];
    // Un cliente activo produce chat, actualización de subasta y notificación OUTBID
    // por los handlers HTTP/Socket.IO existentes; no hay un endpoint de prueba.
    const chatDelivery = secondValid ? event(second[0], "chat:new", (p) => p.text === "Mensaje ficticio de privacidad") : undefined;
    const auctionChatDelivery = secondValid ? event(second[1], "chat:new", (p) => p.text === "Mensaje ficticio de sala de subasta") : undefined;
    const auctionDelivery = event(senderAuction, "auction:updated", (p) => p.auctionId === auction.id);
    const notificationDelivery = secondValid ? event(second[0], "notification:new", (p) => p.type === "OUTBID") : undefined;
    const validChat: ChatSendAck = await senderGeneral.timeout(10_000).emitWithAck("chat:send", { room: "general", text: "Mensaje ficticio de privacidad", clientMessageId: randomUUID() });
    assert.equal(validChat.ok, true);
    const auctionChat: ChatSendAck = await senderAuction.timeout(10_000).emitWithAck("chat:send", { room: `auction:${auction.id}`, text: "Mensaje ficticio de sala de subasta", clientMessageId: randomUUID() });
    assert.equal(auctionChat.ok, true);
    assert.equal((await call(`/api/auctions/${auction.id}/bids`, senderCookie, { amount: "110.00", requestId: randomUUID() })).status, 201);
    await Promise.all([auctionDelivery, chatDelivery, auctionChatDelivery, notificationDelivery]);
    await delay(200); // Ventana negativa acotada después de confirmar las entregas válidas.
    for (const socket of blocked) {
      assert.deepEqual(received.get(socket), [], `Entrega protegida a conexión no autorizada (${scenario}).`);
      if (scenario !== "PENDIENTE") assert.equal(socket.connected, false, scenario);
      if (socket.connected) {
        const joined: ChatJoinAck = await socket.timeout(10_000).emitWithAck("chat:join", { room: "general" });
        assert.equal(joined.ok, false);
      }
      const sent = await sendAfterRevocation(socket, "Mensaje ficticio que debe bloquearse.");
      assert.ok(sent === "disconnected" || !sent.ok);
    }
    assert.equal(await prisma.chatMessage.count({ where: { authorId: user.id } }), 0);
    if (scenario !== "PENDIENTE") await reconnectRejected(cookie);
    if (secondValid) {
      assert.equal((await call("/api/auth/me", secondCookie)).status, 200);
      assert.equal(second[0].connected, true);
      const sent = await sendAfterRevocation(second[0], "Segunda sesión válida conserva acceso.");
      assert.ok(sent !== "disconnected" && sent.ok);
      assert.equal(await prisma.chatMessage.count({ where: { authorId: user.id } }), 1);
    } else if (scenario !== "PENDIENTE") await reconnectRejected(secondCookie);
    for (const socket of [...first, ...second]) socket.disconnect();
    console.log(`PASS privacidad ${scenario}: join/send y recepción de chat, presencia, subasta y notification:new protegidos; sesiones independientes correctas.`);
  }
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function waitForSessionLock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%Session%'
    ) AS waiting`;
    if (rows[0].waiting) return;
    await delay(20);
  }
  throw new Error("La operación concurrente no llegó al bloqueo de sesión.");
}
async function sessionRaces() {
  phase = "carreras reales de sesión";
  const user = await fixture();
  let cookie = await credential(user.email);
  const socket = await connect(cookie);
  const deleted = gate(), releaseDelete = gate();
  const removal = prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { tokenHash: hashToken(cookie.split("=")[1]) } });
    deleted.release(); await releaseDelete.promise;
  }, { timeout: 10_000 });
  let sending: ReturnType<typeof sendAfterRevocation> | undefined;
  try {
    await deleted.promise;
    sending = sendAfterRevocation(socket, "Mensaje ficticio concurrente que debe bloquearse.");
    await waitForSessionLock();
    assert.equal(await prisma.chatMessage.count({ where: { authorId: user.id } }), 0);
  } finally { releaseDelete.release(); await removal; }
  const result = await sending!;
  assert.ok(result === "disconnected" || !result.ok);
  assert.equal(await prisma.chatMessage.count({ where: { authorId: user.id } }), 0);
  console.log("PASS carrera WebSocket: revocación primero; chat:send espera el lock y no persiste.");

  // Camino de persistencia real, sin mocks: la operación válida gana el lock.
  // Logout HTTP debe esperar su commit; nunca puede revocar entre check y INSERT.
  cookie = await credential(user.email);
  const tokenHash = hashToken(cookie.split("=")[1]);
  const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
  const bound = {}; bindSocketSession(bound, { tokenHash, userId: user.id, expiresAt: session.expiresAt });
  const saved = gate(), releaseSave = gate();
  const saving = withSocketSession(bound, async (tx) => {
    await saveMessage({ room: "general", authorId: user.id, text: "Operación ficticia anterior a la revocación." }, tx);
    saved.release(); await releaseSave.promise;
  });
  let logout: ReturnType<typeof call> | undefined;
  try {
    await saved.promise;
    logout = call("/api/auth/logout", cookie, {});
    await waitForSessionLock();
    assert.equal(await prisma.chatMessage.count({ where: { authorId: user.id } }), 0, "El INSERT aún no está confirmado.");
  } finally { releaseSave.release(); await saving; }
  assert.equal((await logout!).status, 200);
  assert.equal(await prisma.chatMessage.count({ where: { authorId: user.id } }), 1);
  await assert.rejects(() => withSocketSession(bound, () => { throw new Error("No debe ejecutar la operación."); }), { code: "UNAUTHORIZED" });
  console.log("PASS carrera PostgreSQL: operación válida primero; logout espera commit y luego impide nuevas operaciones.");

  cookie = await credential(user.email);
  const expiryHash = hashToken(cookie.split("=")[1]);
  const expiresAt = new Date(Date.now() + 500);
  await prisma.session.update({ where: { tokenHash: expiryHash }, data: { expiresAt } });
  const expiring = {}; bindSocketSession(expiring, { tokenHash: expiryHash, userId: user.id, expiresAt });
  await assert.rejects(() => withSocketSession(expiring, async (tx) => {
    await saveMessage({ room: "general", authorId: user.id, text: "Este INSERT ficticio debe revertirse por caducidad." }, tx);
    await delay(600);
  }), { code: "UNAUTHORIZED" });
  assert.equal(await prisma.chatMessage.count({ where: { authorId: user.id } }), 1);
  console.log("PASS caducidad durante operación: rollback real del INSERT y ningún mensaje adicional persistido.");
}
async function concurrentDelivery() {
  phase = "ráfaga de entregas autorizadas";
  const clients: Socket[] = [];
  for (let index = 0; index < 8; index++) {
    const user = await fixture();
    clients.push(await connect(await credential(user.email)));
  }
  const marker = `Rafaga ficticia ${randomUUID().replace(/\d/g, "x")} `;
  const received = clients.map(() => new Set<string>());
  for (const [index, socket] of clients.entries()) {
    socket.on("chat:new", (message: { id: string; text: string }) => {
      if (message.text.startsWith(marker)) received[index].add(message.id);
    });
  }
  const started = performance.now();
  const results: ChatSendAck[] = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    clients[index % clients.length].timeout(10_000).emitWithAck("chat:send", {
      room: "general", text: `${marker}${index}`, clientMessageId: randomUUID(),
    })));
  assert.ok(results.every((result) => result.ok), "Una operación autorizada falló en la ráfaga.");
  for (let attempt = 0; attempt < 250 && received.some((messages) => messages.size !== 12); attempt++) await delay(20);
  assert.ok(received.every((messages) => messages.size === 12), "Se perdió una entrega a un cliente autorizado.");
  assert.ok(clients.every((socket) => socket.connected), "Una conexión válida se desconectó durante la ráfaga.");
  assert.equal(await prisma.chatMessage.count({ where: { text: { startsWith: marker } } }), 12);
  const elapsed = Math.round(performance.now() - started);
  for (const socket of clients) socket.disconnect();
  console.log(`PASS ráfaga real: 12 mensajes concurrentes, 8 clientes, 96 entregas comprobadas, sin pérdida ni desconexión (${elapsed} ms).`);
}
async function main() {
  try {
    if (process.argv.includes("--delivery-burst")) { await concurrentDelivery(); return; }
    for (const scenario of ["logout", "caducidad", "reset", "roles-invalidos"] as const) {
      phase = scenario;
      const email = `auth-session17-${randomUUID()}@example.test`; emails.push(email);
      const user = await prisma.user.create({ data: {
        email, nombreCompleto: "Cuenta ficticia sesiones 17", status: "ACTIVA",
        passwordHash: await bcrypt.hash(password, 12), cedulaCifrada: encryptCedula("1234567890"),
        roles: { create: { role: "COMPRADOR" } },
      } });
      const login = await call("/api/auth/login", undefined, { email, password });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const socket = await connect(cookie);
      assert.equal((await call("/api/auth/me", cookie)).status, 200);
      if (scenario === "logout") {
        assert.equal((await call("/api/auth/logout", cookie, {})).status, 200);
      } else if (scenario === "caducidad") {
        await prisma.session.update({ where: { tokenHash: hashToken(cookie.split("=")[1]) }, data: { expiresAt: new Date(0) } });
      } else if (scenario === "reset") {
        const token = randomBytes(32).toString("hex");
        await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600_000) } });
        assert.equal((await call("/api/auth/reset-password", undefined, { token, newPassword: "Otra frase ficticia para revocar sesiones!" })).status, 200);
        assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
      } else {
        await prisma.userRole.deleteMany({ where: { userId: user.id } });
      }
      assert.equal(await getUserFromCookieHeader(cookie), null);
      assert.equal((await call("/api/auth/me", cookie)).status, 401);
      const result = await sendAfterRevocation(socket, `Mensaje ficticio tras ${scenario}`);
      const persisted = await prisma.chatMessage.count({ where: { authorId: user.id } });
      if (result !== "disconnected" && result.ok) {
        assert.equal(persisted, 1);
        failures.push(scenario);
        console.log(`FAIL ${scenario}: HTTP 401 y helper sin sesión; socket abierto acepta chat:send y persiste un mensaje.`);
      } else {
        assert.equal(persisted, 0);
        console.log(`PASS ${scenario}: HTTP 401 y socket abierto rechaza el mensaje sin persistirlo.`);
      }
      socket.disconnect();
    }
    await privateDeliveryMatrix();
    await sessionRaces();
    await concurrentDelivery();
  } finally {
    for (const socket of sockets) { socket.removeAllListeners(); socket.disconnect(); }
    try {
      const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map(({ id }) => id);
      await prisma.$transaction(async (tx) => {
        if (ids.length) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
        await tx.chatMessage.deleteMany({ where: { authorId: { in: ids } } });
        await tx.notification.deleteMany({ where: { userId: { in: ids } } });
        await tx.bid.deleteMany({ where: { auctionId: { in: auctionIds } } });
        await tx.auctionAlias.deleteMany({ where: { auctionId: { in: auctionIds } } });
        await tx.auction.deleteMany({ where: { id: { in: auctionIds } } });
        await tx.article.deleteMany({ where: { id: { in: articleIds } } });
        await tx.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
        await tx.passwordReset.deleteMany({ where: { userId: { in: ids } } });
        await tx.session.deleteMany({ where: { userId: { in: ids } } });
        await tx.userRole.deleteMany({ where: { userId: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      });
      const remaining = await Promise.all([
        prisma.user.count({ where: { id: { in: ids } } }),
        prisma.chatMessage.count({ where: { authorId: { in: ids } } }),
        prisma.session.count({ where: { userId: { in: ids } } }),
        prisma.userRole.count({ where: { userId: { in: ids } } }),
        prisma.passwordReset.count({ where: { userId: { in: ids } } }),
      ]);
      assert.deepEqual(remaining, [0, 0, 0, 0, 0]);
      console.log("PASS limpieza: sin cuentas, mensajes, sesiones, roles ni tokens propios residuales.");
    } finally { await prisma.$disconnect(); }
  }
  assert.equal(failures.length, 0, "La conexión abierta debe revalidar también la sesión.");
}
main().catch(() => { console.error(`FAIL verificación adicional (${phase}); casos con sesión revocada aceptados: ${failures.join(", ") || "ninguno identificado"}.`); process.exitCode = 1; });
