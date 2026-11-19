"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";

/** Mantiene también la ficha SSR y la adjudicación sincronizadas con el panel de pujas. */
export function AuctionLiveRefresh({ auctionId, enabled }: { auctionId: string; enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: "/socket.io", withCredentials: true });
    socket.on("connect", () => socket.emit("chat:join", { room: `auction:${auctionId}` }));
    socket.on("auction:updated", (event: { auctionId: string }) => { if (event.auctionId === auctionId) router.refresh(); });
    return () => { socket.disconnect(); };
  }, [auctionId, enabled, router]);
  return null;
}

export function AuctionCountdown({ opensAt, closesAt, status }: { opensAt: string; closesAt: string; status: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, []);
  if (status !== "PROGRAMADA" && status !== "ACTIVA") return <span>Subasta finalizada o sin actividad</span>;
  if (now === null) return <span>Calculando tiempo restante…</span>;
  const remaining = Math.max(0, new Date(status === "PROGRAMADA" ? opensAt : closesAt).getTime() - now);
  if (!remaining) return <span>Actualizando estado de la subasta…</span>;
  const seconds = Math.floor(remaining / 1000);
  return <span>{status === "PROGRAMADA" ? "Abre" : "Cierra"} en {Math.floor(seconds / 3600)} h {Math.floor(seconds % 3600 / 60)} min {seconds % 60} s</span>;
}
