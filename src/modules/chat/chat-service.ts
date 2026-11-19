import { randomBytes } from "node:crypto";
import { Prisma, type AccountStatus, type AuctionStatus, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasValidRoles } from "@/lib/auth/roles";
import { displayAlias } from "@/lib/aliases";
import { MAX_CHAT_TEXT, parseRoom, sanitizeChatText, type ChatMessageDto, type ParsedRoom } from "@/modules/chat/chat-rules";

// Reglas compartidas entre Socket.IO y HTTP para no duplicarlas (Kevin 14/11).
export const GENERAL_ALIAS = "Participante";
const FALLBACK_AUCTION_ALIAS = "Usuario";
const READABLE_AUCTION_STATUS: readonly AuctionStatus[] = ["PROGRAMADA", "ACTIVA", "CERRADA_SIN_OFERTAS", "ADJUDICADA"];
const WRITABLE_AUCTION_STATUS: readonly AuctionStatus[] = ["PROGRAMADA", "ACTIVA"];

export class ChatError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code: string,
    message: string,
    /** true si el acceso fue revocado (cuenta suspendida/cerrada): el socket debe desconectarse. */
    public readonly revoked = false,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export type ChatAccount = { status: AccountStatus; roles: Role[] };

/** Relee en PostgreSQL estado y roles: no se confía en el snapshot del handshake. */
export async function assertCanChat(userId: string): Promise<ChatAccount> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, roles: { select: { role: true } } } });
  const roles = user?.roles.map(({ role }) => role) ?? [];
  if (!user || user.status === "SUSPENDIDA" || user.status === "CERRADA" || !hasValidRoles(roles)) {
    throw new ChatError(403, "ACCESO_REVOCADO", "Tu cuenta ya no tiene acceso al chat.", true);
  }
  if (user.status !== "ACTIVA") {
    throw new ChatError(403, "CUENTA_NO_ACTIVA", "Tu cuenta debe estar activa para usar el chat.");
  }
  return { status: user.status, roles };
}

/** La sala debe tener formato válido y, si es de subasta, existir y ser visible. */
export async function validateRoomAccess(room: unknown, mode: "read" | "write" = "read", db: Prisma.TransactionClient = prisma): Promise<ParsedRoom & { sellerId?: string }> {
  const parsed = parseRoom(room);
  if (!parsed) throw new ChatError(400, "SALA_INVALIDA", "La sala indicada no es válida.");
  if (parsed.kind === "general") return parsed;
  const auction = await db.auction.findUnique({ where: { id: parsed.auctionId }, select: { status: true, article: { select: { ownerId: true } } } });
  if (!auction || !READABLE_AUCTION_STATUS.includes(auction.status)) {
    throw new ChatError(404, "SALA_NO_DISPONIBLE", "No tienes acceso a esta sala o no existe.");
  }
  if (mode === "write" && !WRITABLE_AUCTION_STATUS.includes(auction.status)) {
    throw new ChatError(409, "SALA_SOLO_LECTURA", "La subasta ya terminó; esta sala es solo de lectura.");
  }
  return auction.article?.ownerId ? { ...parsed, sellerId: auction.article.ownerId } : parsed;
}

export function generateAuctionAlias(): string {
  return `Usuario-${randomBytes(3).toString("hex")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Seudónimo por usuario y subasta, generado por el servidor y único dentro de la subasta. */
export async function getOrCreateAuctionAlias(auctionId: string, userId: string, db: Prisma.TransactionClient = prisma): Promise<string> {
  const where = { auctionId_userId: { auctionId, userId } };
  const existing = await db.auctionAlias.findUnique({ where, select: { alias: true } });
  if (existing) return displayAlias(existing.alias);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // En una transacción una colisión única abortaría también el guard de sesión.
    // El savepoint conserva el reintento existente sin abrir otra conexión.
    if (db !== prisma) await db.$executeRaw`SAVEPOINT chat_alias_attempt`;
    try {
      const created = await db.auctionAlias.create({ data: { auctionId, userId, alias: generateAuctionAlias() }, select: { alias: true } });
      if (db !== prisma) await db.$executeRaw`RELEASE SAVEPOINT chat_alias_attempt`;
      return displayAlias(created.alias);
    } catch (error) {
      if (db !== prisma) {
        await db.$executeRaw`ROLLBACK TO SAVEPOINT chat_alias_attempt`;
        await db.$executeRaw`RELEASE SAVEPOINT chat_alias_attempt`;
      }
      if (!isUniqueViolation(error)) throw error;
      // Otra petición del mismo usuario pudo crearlo a la vez; si no, el alias chocó y se reintenta.
      const raced = await db.auctionAlias.findUnique({ where, select: { alias: true } });
      if (raced) return displayAlias(raced.alias);
    }
  }
  throw new Error("No se pudo generar un seudónimo único para la subasta.");
}

/** Persiste el mensaje en PostgreSQL y devuelve el payload público (sin authorId). */
export async function saveMessage(input: { room: unknown; authorId: string; text: string }, db: Prisma.TransactionClient = prisma): Promise<ChatMessageDto> {
  const parsed = await validateRoomAccess(input.room, "write", db);
  const text = sanitizeChatText(input.text);
  if (!text) throw new ChatError(400, "MENSAJE_VACIO", "El mensaje no contiene texto permitido.");
  if (text.length > MAX_CHAT_TEXT) throw new ChatError(400, "MENSAJE_LARGO", `El mensaje admite como máximo ${MAX_CHAT_TEXT} caracteres.`);
  const auctionId = parsed.kind === "auction" ? parsed.auctionId : null;
  const alias = auctionId ? await getOrCreateAuctionAlias(auctionId, input.authorId, db) : GENERAL_ALIAS;
  const authorAlias = alias + (auctionId && parsed.sellerId === input.authorId ? " (Vendedor)" : "");
  const message = await db.chatMessage.create({
    data: { room: parsed.room, authorId: input.authorId, auctionId, text },
    select: { id: true, room: true, text: true, createdAt: true },
  });
  return { id: message.id, room: message.room, text: message.text, authorAlias, createdAt: message.createdAt.toISOString() };
}

/** Últimos `limit` mensajes de la sala en orden cronológico ascendente. */
export async function getHistory(room: unknown, limit: number): Promise<ChatMessageDto[]> {
  const parsed = await validateRoomAccess(room, "read");
  const rows = await prisma.chatMessage.findMany({
    where: { room: parsed.room },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, room: true, text: true, createdAt: true, authorId: true },
  });
  const aliasByUser = new Map<string, string>();
  if (parsed.kind === "auction" && rows.length > 0) {
    const aliases = await prisma.auctionAlias.findMany({
      where: { auctionId: parsed.auctionId, userId: { in: [...new Set(rows.map((row) => row.authorId))] } },
      select: { userId: true, alias: true },
    });
    for (const { userId, alias } of aliases) aliasByUser.set(userId, displayAlias(alias));
  }
  return rows.reverse().map((row) => ({
    id: row.id,
    room: row.room,
    text: row.text,
    authorAlias: parsed.kind === "general" ? GENERAL_ALIAS : (aliasByUser.get(row.authorId) ?? FALLBACK_AUCTION_ALIAS) + (parsed.sellerId === row.authorId ? " (Vendedor)" : ""),
    createdAt: row.createdAt.toISOString(),
  }));
}
