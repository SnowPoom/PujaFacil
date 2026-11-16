import { assertTrustedOrigin, requireActive } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import {
  markNotificationRead,
  NotificationError,
} from "@/modules/notifications/notification-service";

type NotificationRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/notifications/[id]
 * Marca como leída (`readAt`) una notificación únicamente si pertenece al usuario autenticado activo.
 * Si pertenece a otro usuario o no existe, responde 404 sin revelar información ajena.
 */
export async function PATCH(
  request: Request,
  context: NotificationRouteContext,
): Promise<Response> {
  try {
    assertTrustedOrigin(request);
    const user = await requireActive(request);
    const { id } = await context.params;

    const notification = await markNotificationRead(user.id, id);
    return Response.json(
      { ok: true, data: { notification } },
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
