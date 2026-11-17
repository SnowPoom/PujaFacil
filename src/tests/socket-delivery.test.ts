import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $transaction: vi.fn(), $queryRaw: vi.fn(),
  session: { findUnique: vi.fn() }, user: { findUnique: vi.fn() } }));
vi.mock("../lib/prisma", () => ({ prisma: db }));
import { bindSocketSession, emitAuthorizedRoom, SocketSessionError } from "../lib/auth/socket-session";
import { emitAuctionUpdated, setSocketServer } from "../lib/realtime";
afterEach(() => setSocketServer(undefined as never));

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (work) => work(db));
  db.session.findUnique.mockResolvedValue({ userId: "cuenta-ficticia", expiresAt: new Date(Date.now() + 60_000) });
  db.user.findUnique.mockResolvedValue({ status: "ACTIVA", roles: [{ role: "COMPRADOR" }] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  setSocketServer(undefined as never);
});
function recipient(id: string, bound = true) {
  const socket = { id, connected: true, rooms: new Set(["general"]), emit: vi.fn(), disconnect: vi.fn() };
  if (bound) bindSocketSession(socket, { tokenHash: "a".repeat(64), userId: "cuenta-ficticia", expiresAt: new Date(Date.now() + 60_000) });
  return socket;
}
function server(...sockets: ReturnType<typeof recipient>[]) {
  return { sockets: { sockets: new Map(sockets.map((socket) => [socket.id, socket])) } } as never;
}

describe("Entrega protegida — errores visibles sin exponer datos", () => {
  it("informa despacho correcto sin confundirlo con un ACK del cliente", async () => {
    const socket = recipient("valido");
    expect(await emitAuthorizedRoom(server(socket), "general", "chat:new", { text: "Mensaje ficticio" }))
      .toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(socket.emit).toHaveBeenCalledWith("chat:new", { text: "Mensaje ficticio" });
    expect(console.error).not.toHaveBeenCalled();
  });
  it.each(["sin-vinculo", "caducada", "pendiente"])("%s es una omisión esperada, no un fallo de infraestructura", async (state) => {
    const socket = recipient("bloqueado", state !== "sin-vinculo");
    if (state === "caducada") db.session.findUnique.mockResolvedValue({ userId: "cuenta-ficticia", expiresAt: new Date(0) });
    if (state === "pendiente") db.user.findUnique.mockResolvedValue({ status: "PENDIENTE", roles: [{ role: "COMPRADOR" }] });
    expect(await emitAuthorizedRoom(server(socket), "general", "chat:new", {})).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledTimes(state === "pendiente" ? 0 : 1);
    expect(console.error).not.toHaveBeenCalled();
  });
  it("un error de DB no se pierde en silencio ni aparece con sus valores sensibles", async () => {
    db.$transaction.mockRejectedValue(new Error("credencial-ficticia-y-correo@example.test"));
    const socket = recipient("afectado");
    expect(await emitAuthorizedRoom(server(socket), "general", "chat:new", { text: "contenido-privado-ficticio" }))
      .toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("[realtime] ENTREGA_NO_DISPONIBLE", { event: "chat:new", failed: 1 });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("credencial-ficticia");
    expect(logged).not.toContain("contenido-privado-ficticio");
  });
  it("el error de un destinatario no impide la entrega al resto", async () => {
    db.$transaction.mockRejectedValueOnce(new Error("Fallo ficticio controlado"));
    const failed = recipient("fallo"), healthy = recipient("valido");
    expect(await emitAuthorizedRoom(server(failed, healthy), "general", "chat:new", {}))
      .toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(healthy.emit).toHaveBeenCalledOnce();
    expect(healthy.disconnect).not.toHaveBeenCalled();
  });
  it("no cuenta como omitido un paquete ya despachado antes de caducar al terminar el guard", async () => {
    db.$transaction.mockImplementation(async (work) => {
      await work(db);
      throw new SocketSessionError(401, "UNAUTHORIZED", "Sesión ficticia caducada.");
    });
    const socket = recipient("caduca-al-finalizar");
    expect(await emitAuthorizedRoom(server(socket), "general", "chat:new", {}))
      .toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(socket.emit).toHaveBeenCalledOnce();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(console.error).not.toHaveBeenCalled();
  });
  it("una validación lenta no invierte actualizaciones de subasta para el mismo cliente", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    db.$transaction.mockImplementationOnce(async (work) => { await slow; return work(db); });
    const socket = recipient("validacion-lenta"), independent = recipient("validacion-rapida");
    const io = server(socket, independent);
    // Se verifica el orden de estas invocaciones, no un orden global de commits.
    const first = emitAuthorizedRoom(io, "general", "auction:updated", { highestBid: "100.00" });
    const second = emitAuthorizedRoom(io, "general", "auction:updated", { highestBid: "110.00" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const independentOrder = independent.emit.mock.calls.map(([, payload]) => payload.highestBid);
    release();
    await Promise.all([first, second]);
    expect(independentOrder).toEqual(["100.00", "110.00"]);
    expect(socket.emit.mock.calls.map(([, payload]) => payload.highestBid)).toEqual(["100.00", "110.00"]);
  });
  it("un evento en espera vuelve a validar la sesión y no se entrega tras revocarla", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    db.$transaction.mockImplementationOnce(async (work) => { await slow; return work(db); });
    const socket = recipient("revocada-en-espera");
    socket.disconnect.mockImplementation(() => { socket.connected = false; });
    const io = server(socket);
    const first = emitAuthorizedRoom(io, "general", "chat:new", { text: "Primero" });
    const queued = emitAuthorizedRoom(io, "general", "chat:new", { text: "Segundo" });
    db.session.findUnique.mockResolvedValue(null);
    release();
    expect(await Promise.all([first, queued])).toEqual([
      { sent: 0, skipped: 1, failed: 0 }, { sent: 0, skipped: 1, failed: 0 },
    ]);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
  it("una emisión rechazada no bloquea la siguiente en la misma conexión válida", async () => {
    const socket = recipient("fallo-controlado-de-sala");
    // La primera enumeración funciona; la comprobación dentro de su tarea falla.
    // El rechazo debe llegar a su llamador, sin contaminar la siguiente tarea.
    vi.spyOn(socket.rooms, "has").mockReturnValueOnce(true).mockImplementationOnce(() => { throw new Error("Fallo ficticio de sala"); });
    const io = server(socket);
    const first = emitAuthorizedRoom(io, "general", "chat:new", { text: "Primero" });
    const next = emitAuthorizedRoom(io, "general", "chat:new", { text: "Segundo" });
    await expect(first).rejects.toThrow("Fallo ficticio de sala");
    await expect(next).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(socket.emit).toHaveBeenCalledExactlyOnceWith("chat:new", { text: "Segundo" });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
  it("el emisor conserva true=programado y registra los rechazos asíncronos inesperados", async () => {
    setSocketServer({} as never); // Fallo fuera de la comprobación individual.
    expect(emitAuctionUpdated("subasta-ficticia", { auctionId: "subasta-ficticia", highestBid: "100.00", bidCount: 1, status: "ACTIVA", closesAt: new Date().toISOString() })).toBe(true);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith("[realtime] ENTREGA_NO_DISPONIBLE", { event: "auction:updated", failed: 1 }));
    setSocketServer(undefined as never);
  });
});
