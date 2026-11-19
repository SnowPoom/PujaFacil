"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { io } from "socket.io-client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import TextField from "@/components/ui/TextField";
import NotificationBellLink from "@/components/notifications/NotificationBellLink";
import { GENERAL_ROOM, MAX_CHAT_TEXT, parseRoom, type ChatMessageDto } from "@/modules/chat/chat-rules";
import type { ChatJoinAck, ChatSendAck } from "@/server/socket/index";

type ConnectionState = "Conectando…" | "Conectado" | "Error";

export default function ChatRoom() {
  const searchParams = useSearchParams();
  const roomQueryParam = searchParams.get("room");

  const [selectedRoom, setSelectedRoom] = useState<string>(GENERAL_ROOM);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("Conectando…");
  const [roomJoined, setRoomJoined] = useState<boolean>(false);
  const [presenceCount, setPresenceCount] = useState<number>(0);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [text, setText] = useState<string>("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState<boolean>(false);
  const [notificationSocket, setNotificationSocket] = useState<ReturnType<typeof io> | null>(null);
  const socketRef = React.useRef<ReturnType<typeof io> | null>(null);

  useEffect(() => {
    const rawRoom = new URLSearchParams(window.location.search).get("room") ?? roomQueryParam;
    const targetRoom = rawRoom === null ? GENERAL_ROOM : rawRoom;
    const parsed = parseRoom(targetRoom);

    if (!parsed) {
      queueMicrotask(() => {
        setSelectedRoom(targetRoom);
        setMessages([]);
        setPresenceCount(0);
        setRoomJoined(false);
        setSendError(null);
        setConnectionState("Error");
        setRoomError("No tienes acceso a esta sala o no existe");
      });
      return;
    }

    queueMicrotask(() => {
      setSelectedRoom(parsed.room);
      setMessages([]);
      setPresenceCount(0);
      setRoomJoined(false);
      setSendError(null);
      setRoomError(null);
      setConnectionState("Conectando…");
    });

    let cancelled = false;
    // Misma conexión de origen (funciona con ws:// en HTTP local y wss:// en HTTPS sin URL fija).
    const socket = io({ path: "/socket.io", withCredentials: true });
    socketRef.current = socket;

    const loadHistory = async (room: string) => {
      setLoadingHistory(true);
      try {
        const res = await fetch(`/api/chat/messages?room=${encodeURIComponent(room)}&limit=30`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = (await res.json()) as
          | { ok: true; data: { items: ChatMessageDto[] } }
          | { ok: false; error?: { message?: string } };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setConnectionState("Error");
          setRoomJoined(false);
          setRoomError("No tienes acceso a esta sala o no existe");
          return;
        }
        setMessages((prev) => {
          const byId = new Map<string, ChatMessageDto>();
          for (const item of body.data.items) {
            if (item.room === room) byId.set(item.id, item);
          }
          for (const item of prev) {
            if (item.room === room) byId.set(item.id, item);
          }
          return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
      } catch {
        if (!cancelled) {
          setConnectionState("Error");
          setSendError("No se pudo cargar el historial de la sala.");
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    };

    socket.on("connect", () => {
      setNotificationSocket(socket);
      if (cancelled) return;
      socket.emit("chat:join", { room: parsed.room }, (ack: ChatJoinAck) => {
        if (cancelled) return;
        if (!ack || !ack.ok) {
          setConnectionState("Error");
          setRoomJoined(false);
          setRoomError("No tienes acceso a esta sala o no existe");
          return;
        }
        setConnectionState("Conectado");
        setRoomError(null);
        setRoomJoined(true);
        setPresenceCount(ack.count);
        void loadHistory(parsed.room);
      });
    });

    socket.on("connect_error", () => {
      if (cancelled) return;
      setConnectionState("Error");
      setRoomJoined(false);
      setRoomError("No tienes acceso a esta sala o no existe");
    });

    socket.on("disconnect", () => {
      if (cancelled) return;
      setConnectionState("Error");
      setRoomJoined(false);
    });

    socket.on("chat:presence", (payload: { room: string; count: number }) => {
      if (cancelled || payload.room !== parsed.room) return;
      setPresenceCount(payload.count);
    });

    socket.on("chat:new", (message: ChatMessageDto) => {
      if (cancelled || message.room !== parsed.room) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    });

    return () => {
      cancelled = true;
      socketRef.current = null;
      socket.disconnect();
    };
  }, [roomQueryParam]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSendError(null);

    const trimmed = text.trim();
    if (!trimmed) {
      setSendError("Escribe un mensaje antes de enviar.");
      return;
    }
    if (trimmed.length > MAX_CHAT_TEXT) {
      setSendError(`El mensaje admite como máximo ${MAX_CHAT_TEXT} caracteres.`);
      return;
    }

    const socket = socketRef.current;
    if (!socket || !roomJoined) {
      setSendError("No estás conectado a la sala.");
      return;
    }

    const clientMessageId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    setSending(true);
    socket.emit(
      "chat:send",
      { room: selectedRoom, text: trimmed, clientMessageId },
      (ack: ChatSendAck) => {
        setSending(false);
        if (!ack || !ack.ok) {
          setSendError(ack?.error?.message ?? "No se pudo enviar el mensaje.");
          return;
        }
        // Solo se dibuja el mensaje cuando llega chat:new desde el servidor (evita duplicados).
        setText("");
      },
    );
  };

  const badgeVariant =
    connectionState === "Conectado" ? "success" : connectionState === "Conectando…" ? "accent" : "error";

  const roomLabel =
    selectedRoom === GENERAL_ROOM ? "Sala general" : `Sala de subasta · ${selectedRoom.slice("auction:".length)}`;

  const visibleMessages = messages.filter((msg) => msg.room === selectedRoom);

  return (
    <Card className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="pf-title ">Chat y atención en vivo</h1>
          <p className="mt-1 text-sm">{roomLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={badgeVariant}>{connectionState}</Badge>
          {roomJoined && (
            <Badge variant="neutral">
              Usuarios conectados: {presenceCount}
            </Badge>
          )}
          {selectedRoom !== GENERAL_ROOM && (
            <Link href="/chat" className="pf-btn-secondary">
              Sala general
            </Link>
          )}
          <NotificationBellLink socket={notificationSocket} className="pf-btn-secondary" />
          <Link href="/panel" className="pf-btn-secondary">
            Volver al panel
          </Link>
        </div>
      </header>

      {roomError ? (
        <div role="alert" className="space-y-4">
          <p className="pf-error font-semibold">No tienes acceso a esta sala o no existe</p>
          <p className="text-sm">
            Verifica que tu cuenta esté activa y que el código de la sala sea válido.
          </p>
          <div>
            <Link href="/chat" className="pf-btn">
              Ir a la sala general (/chat)
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section
            aria-label="Historial de mensajes"
            aria-live="polite"
            className="space-y-3 rounded-lg border p-4 max-h-96 overflow-y-auto"
          >
            {loadingHistory && visibleMessages.length === 0 ? (
              <p role="status" className="text-sm">
                Cargando historial de mensajes…
              </p>
            ) : visibleMessages.length === 0 ? (
              <p className="text-sm">Aún no hay mensajes en esta sala. ¡Envía el primero!</p>
            ) : (
              <ul className="space-y-3">
                {visibleMessages.map((msg) => {
                  const timeLabel = new Date(msg.createdAt).toLocaleTimeString("es-EC", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <li key={msg.id} className="rounded border p-3">
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                        <span>{msg.authorAlias}</span>
                        <time dateTime={msg.createdAt}>{timeLabel}</time>
                      </div>
                      <p className="mt-1 text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <TextField
              label="Tu mensaje (no compartas correos, teléfonos ni datos personales)"
              name="chatMessage"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe tu consulta o comentario (máx. 500 caracteres)…"
              disabled={!roomJoined || sending}
              error={sendError ?? undefined}
              required
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs">
                {text.length}/{MAX_CHAT_TEXT} caracteres
              </span>
              <Button type="submit" disabled={!roomJoined || sending}>
                {sending ? "Enviando…" : "Enviar mensaje"}
              </Button>
            </div>
          </form>
        </>
      )}
    </Card>
  );
}
