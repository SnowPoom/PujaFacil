import { prisma } from "@/lib/prisma";
import { emitNotificationToUser, type NotificationRealtimePayload } from "@/lib/realtime";

// Inbox interna (sin correo externo). Kevin 16/11.
export const MAX_NOTIFICATIONS = 50;

export type NotificationDto = NotificationRealtimePayload & { readAt: string | null };

export type NotifyUserInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  url: string;
};

export class NotificationError extends Error {
  constructor(
    public readonly status: 400 | 404,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  url: true,
  readAt: true,
  createdAt: true,
} as const;

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  readAt: Date | null;
  createdAt: Date;
};

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    url: safeInternalUrl(row.url),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Solo rutas internas relativas: evita enlaces externos en la bandeja. */
function safeInternalUrl(url: string): string {
  const normalized = /^\/mis-articulos\/[^/]+$/.test(url) ? `${url}/editar` : url;
  return normalized.startsWith("/") && !normalized.startsWith("//") ? normalized : "/notificaciones";
}

/**
 * Guarda la notificación en PostgreSQL y DESPUÉS emite `notification:new`
 * a la sala privada `user:<id>` (el ID nunca viaja en el payload).
 */
export async function notifyUser(input: NotifyUserInput): Promise<NotificationDto> {
  const created = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type.slice(0, 50),
      title: input.title.slice(0, 120),
      body: input.body.slice(0, 500),
      url: safeInternalUrl(input.url),
    },
    select: notificationSelect,
  });
  const dto = toDto(created);
  emitNotificationToUser(input.userId, {
    id: dto.id,
    type: dto.type,
    title: dto.title,
    body: dto.body,
    url: dto.url,
    createdAt: dto.createdAt,
  });
  return dto;
}

/** Notificaciones propias, más recientes primero. */
export async function listNotifications(
  userId: string,
  limit = MAX_NOTIFICATIONS,
): Promise<{ items: NotificationDto[]; unreadCount: number }> {
  const take = Math.min(Math.max(Math.trunc(limit) || MAX_NOTIFICATIONS, 1), MAX_NOTIFICATIONS);
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: notificationSelect,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows.map(toDto), unreadCount };
}

/**
 * Marca como leída solo si pertenece al titular. Si es ajena o no existe responde 404
 * (no revela que exista). Idempotente: si ya estaba leída conserva la fecha original.
 */
export async function markNotificationRead(userId: string, notificationId: string): Promise<NotificationDto> {
  const id = notificationId?.trim();
  if (!id || id.length > 64) {
    throw new NotificationError(400, "NOTIFICACION_INVALIDA", "El identificador de la notificación no es válido.");
  }
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
    select: notificationSelect,
  });
  if (!existing) {
    throw new NotificationError(404, "NOTIFICACION_NO_ENCONTRADA", "La notificación no existe.");
  }
  if (existing.readAt) return toDto(existing);

  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  const updated = await prisma.notification.findFirst({ where: { id, userId }, select: notificationSelect });
  return toDto(updated ?? existing);
}
