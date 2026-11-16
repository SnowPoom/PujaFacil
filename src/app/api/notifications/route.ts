import { requireActive } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import {
  listNotifications,
  MAX_NOTIFICATIONS,
  NotificationError,
} from "@/modules/notifications/notification-service";

/**
 * GET /api/notifications
 * Devuelve las notificaciones de la bandeja interna pertenecientes únicamente
 * al usuario autenticado activo (`items` y `unreadCount`).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireActive(request);
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : MAX_NOTIFICATIONS;

    const data = await listNotifications(user.id, limit);
    return Response.json(
      { ok: true, data },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotificationError) {
      return Response.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return authErrorResponse(error);
  }
}
