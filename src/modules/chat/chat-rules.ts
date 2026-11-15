import { z } from "zod";

// Reglas puras del chat (sin Prisma) para reutilizarlas en Socket.IO, HTTP y el cliente.
export const GENERAL_ROOM = "general";
export const MAX_CHAT_TEXT = 500;
export const MAX_HISTORY = 30;
export const HIDDEN_DATA = "[dato oculto]";

// Identificadores de subasta: cuid de Prisma (minúsculas y dígitos); se admite guion para
// ids de la semilla local (p. ej. "demo-subasta-programada"). El formato NO autoriza:
// la existencia/visibilidad se comprueba siempre en el servidor contra PostgreSQL.
const AUCTION_ROOM_PATTERN = /^auction:([a-z0-9][a-z0-9-]{0,63})$/;

export type ParsedRoom =
  | { kind: "general"; room: typeof GENERAL_ROOM }
  | { kind: "auction"; room: string; auctionId: string };

export function parseRoom(value: unknown): ParsedRoom | null {
  if (typeof value !== "string") return null;
  if (value === GENERAL_ROOM) return { kind: "general", room: GENERAL_ROOM };
  const match = AUCTION_ROOM_PATTERN.exec(value);
  return match ? { kind: "auction", room: value, auctionId: match[1] } : null;
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Secuencias de 7 a 15 dígitos con separadores opcionales (teléfonos, cédulas).
const PHONE_PATTERN = /\+?\d(?:[\s.-]?\d){6,14}/g;

function stripControlChars(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("");
}

/** Quita markup y patrones obvios de email/teléfono. React escapa el texto al pintarlo. */
export function sanitizeChatText(raw: string): string {
  return stripControlChars(raw.normalize("NFKC"))
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(EMAIL_PATTERN, HIDDEN_DATA)
    .replace(PHONE_PATTERN, HIDDEN_DATA)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const roomField = z.string({ error: "Indica la sala." }).min(1, "Indica la sala.").max(80, "Sala no válida.");

export const chatJoinSchema = z.object({ room: roomField });

export const chatSendSchema = z.object({
  room: roomField,
  text: z
    .string({ error: "Escribe un mensaje." })
    .trim()
    .min(1, "Escribe un mensaje.")
    .max(MAX_CHAT_TEXT, `El mensaje admite como máximo ${MAX_CHAT_TEXT} caracteres.`),
  clientMessageId: z.string({ error: "Falta el identificador del mensaje." }).min(1).max(100),
});

export const historyQuerySchema = z.object({
  room: roomField,
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY).default(MAX_HISTORY),
});

export type ChatMessageDto = { id: string; room: string; text: string; authorAlias: string; createdAt: string };
