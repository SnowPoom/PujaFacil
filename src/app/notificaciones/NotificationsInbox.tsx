"use client";
import { displayLabel, formatDate, humanizeText } from "@/lib/presentation";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { io } from "socket.io-client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import type { NotificationRealtimePayload } from "@/lib/realtime";
import type { NotificationDto } from "@/modules/notifications/notification-service";

function typeLabel(type: string): { label: string; variant: "neutral" | "success" | "error" | "accent" } {
  switch (type) {
    case "OUTBID":
      return { label: "Oferta superada", variant: "accent" };
    case "AUCTION_WON":
      return { label: "Subasta adjudicada", variant: "success" };
    case "AUCTION_CLOSED":
      return { label: "Subasta finalizada", variant: "neutral" };
    case "AUCTION_SUSPENDED":
      return { label: "Subasta suspendida", variant: "error" };
    case "AUCTION_SCHEDULED":
      return { label: "Subasta programada", variant: "accent" };
    default:
      return { label: displayLabel(type), variant: "neutral" };
  }
}

export default function NotificationsInbox({
  initialItems,
}: {
  initialItems: NotificationDto[];
}) {
  const [items, setItems] = useState<NotificationDto[]>(initialItems);
  const [connected, setConnected] = useState<boolean>(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Misma conexión de origen (soporta ws:// en HTTP local y wss:// en HTTPS sin URL fija).
    // Al conectar, el servidor une automáticamente el socket a la sala privada `user:<id>`.
    const socket = io({ path: "/socket.io", withCredentials: true });

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("notification:new", (payload: NotificationRealtimePayload) => {
      const incoming: NotificationDto = {
        ...payload,
        readAt: null,
      };
      setItems((prev) => (prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev]));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleMarkAsRead = async (id: string) => {
    setErrorMsg(null);
    setMarkingId(id);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
      });
      const body = (await response.json()) as
        | { ok: true; data: { notification: NotificationDto } }
        | { ok: false; error?: { message?: string } };

      if (!response.ok || !body.ok) {
        setErrorMsg((!body.ok && body.error?.message) || "No se pudo marcar la notificación como leída.");
        return;
      }

      setItems((prev) =>
        prev.map((item) => (item.id === id ? body.data.notification : item)),
      );
    } catch {
      setErrorMsg("Error de red al actualizar la notificación.");
    } finally {
      setMarkingId(null);
    }
  };

  const unreadCount = items.filter((n) => n.readAt === null).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Centro de notificaciones
          </h1>
          <p className="text-sm mt-1">
            Bandeja interna de avisos sobre tus ofertas, subastas y verificaciones en tiempo real.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={connected ? "success" : "neutral"}>
            {connected ? "Avisos en vivo activos" : "Sincronizando…"}
          </Badge>
          <Badge variant={unreadCount > 0 ? "accent" : "neutral"}>
            Sin leer: {unreadCount}
          </Badge>
          <Link href="/panel" className="pf-btn-secondary">
            Volver al panel
          </Link>
        </div>
      </div>

      {errorMsg && (
        <p role="alert" className="pf-error text-sm">
          {errorMsg}
        </p>
      )}

      <Card>
        {items.length === 0 ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-sm">No tienes notificaciones en tu bandeja.</p>
            <div>
              <Link href="/subastas" className="pf-btn">
                Explorar catálogo de subastas
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-4" aria-live="polite">
            {items.map((item) => {
              const isUnread = item.readAt === null;
              const badgeInfo = typeLabel(item.type);
              const formattedDate = formatDate(item.createdAt);

              return (
                <li
                  key={item.id}
                  className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                  style={{
                    borderColor: "var(--pf-border)",
                    backgroundColor: isUnread ? "var(--pf-surface)" : "transparent",
                  }}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badgeInfo.variant}>{badgeInfo.label}</Badge>
                      <Badge variant={isUnread ? "accent" : "neutral"}>
                        {isUnread ? "No leída" : "Leída"}
                      </Badge>
                      <time dateTime={item.createdAt} className="text-xs opacity-75">
                        {formattedDate}
                      </time>
                    </div>
                    <h2 className="text-base font-bold pt-1">{humanizeText(item.title)}</h2>
                    <p className="text-sm">{humanizeText(item.body)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {item.url && (
                      <Link href={item.url} className="pf-btn-secondary">
                        Ver detalle
                      </Link>
                    )}
                    {isUnread && (
                      <Button
                        variant="primary"
                        disabled={markingId === item.id}
                        onClick={() => void handleMarkAsRead(item.id)}
                      >
                        {markingId === item.id ? "Marcando…" : "Marcar como leída"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
