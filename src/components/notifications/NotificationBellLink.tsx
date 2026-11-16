"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import Badge from "@/components/ui/Badge";

/**
 * Botón de acceso a `/notificaciones` que muestra el contador de notificaciones sin leer
 * en vivo (vía `GET /api/notifications` + `notification:new`).
 * Si todas las notificaciones están leídas (`unreadCount === 0`), no muestra aviso/badge.
 */
export default function NotificationBellLink({
  socket,
  className = "pf-btn-secondary",
}: {
  socket?: Socket | null;
  className?: string;
}) {
  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    const loadUnread = async () => {
      try {
        const res = await fetch("/api/notifications?limit=1", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          ok?: boolean;
          data?: { unreadCount?: number };
        };
        if (!cancelled && body?.ok && typeof body.data?.unreadCount === "number") {
          setUnreadCount(body.data.unreadCount);
        }
      } catch {
        // Ignorar si es visitante sin sesión activa
      }
    };

    void loadUnread();

    if (socket) {
      const onNew = () => {
        if (!cancelled) setUnreadCount((prev) => prev + 1);
      };
      socket.on("notification:new", onNew);
      return () => {
        cancelled = true;
        socket.off("notification:new", onNew);
      };
    }

    const ownSocket = io({ path: "/socket.io", withCredentials: true });
    ownSocket.on("notification:new", () => {
      if (!cancelled) setUnreadCount((prev) => prev + 1);
    });

    return () => {
      cancelled = true;
      ownSocket.disconnect();
    };
  }, [socket]);

  return (
    <Link href="/notificaciones" className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <span>Notificaciones</span>
      {unreadCount > 0 && (
        <Badge variant="accent">
          {unreadCount === 1 ? "1 nueva" : `${unreadCount} nuevas`}
        </Badge>
      )}
    </Link>
  );
}
