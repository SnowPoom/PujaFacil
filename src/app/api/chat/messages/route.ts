import { requireActive } from "@/lib/auth/guards";
import { authErrorResponse } from "@/lib/auth/http";
import { GENERAL_ROOM, historyQuerySchema } from "@/modules/chat/chat-rules";
import { ChatError, getHistory } from "@/modules/chat/chat-service";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireActive(request);
    const { searchParams } = new URL(request.url);
    const query = historyQuerySchema.parse({
      room: searchParams.get("room") ?? GENERAL_ROOM,
      limit: searchParams.get("limit") ?? undefined,
    });

    const items = await getHistory(query.room, query.limit);
    return Response.json(
      { ok: true, data: { items } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ChatError) {
      return Response.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return authErrorResponse(error);
  }
}
