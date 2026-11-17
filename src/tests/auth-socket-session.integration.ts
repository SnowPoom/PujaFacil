/** Verificación adicional del cierre 17/11, independiente de Vitest y de C3.
 * Con PostgreSQL migrado y npm run dev:
 * node --env-file=.env --import tsx src/tests/auth-socket-session.integration.ts
 * Mantiene abierto el socket al revocar la sesión; no modifica módulos ajenos.
 * Un reset preparado en DB es un fixture: el consumo se realiza por HTTP real.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@/lib/prisma";
import { encryptCedula } from "@/lib/auth/crypto";
import { getUserFromCookieHeader, hashToken } from "@/lib/auth/session";
import type { ChatJoinAck, ChatSendAck } from "@/server/socket/index";

const origin = "http://localhost:3000";
const password = "Frase ficticia para verificar sesiones activas!";
const emails: string[] = [];
const sockets: Socket[] = [];
const failures: string[] = [];
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
async function main() {
  try {
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
  } finally {
    for (const socket of sockets) { socket.removeAllListeners(); socket.disconnect(); }
    try {
      const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map(({ id }) => id);
      await prisma.$transaction([
        prisma.chatMessage.deleteMany({ where: { authorId: { in: ids } } }),
        prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }),
        prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } }),
        prisma.session.deleteMany({ where: { userId: { in: ids } } }),
        prisma.userRole.deleteMany({ where: { userId: { in: ids } } }),
        prisma.user.deleteMany({ where: { id: { in: ids } } }),
      ]);
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
