"use client";
import { formatDate, displayLabel } from "@/lib/presentation";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TextField from "@/components/ui/TextField";
import NotificationBellLink from "@/components/notifications/NotificationBellLink";
import type { AuctionUpdatedPayload } from "@/lib/realtime";

type AuctionStatus =
  | "BORRADOR"
  | "PROGRAMADA"
  | "ACTIVA"
  | "SUSPENDIDA"
  | "CERRADA_SIN_OFERTAS"
  | "ADJUDICADA"
  | "CANCELADA";

interface PublicBidHistoryItem {
  alias: string;
  amount: string;
  acceptedAt: string;
}

interface AuctionBidsState {
  title: string;
  auctionId: string;
  status: AuctionStatus;
  startingPrice: string;
  minIncrement: string;
  highestBid: string | null;
  minNextBid: string;
  bidCount: number;
  opensAt: string;
  closesAt: string;
  items: PublicBidHistoryItem[];
}

const USD_TWO_DECIMALS = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

function toCentsBigInt(val: string): bigint {
  const [whole = "0", frac = "00"] = val.trim().split(".");
  return BigInt(whole) * BigInt(100) + BigInt((frac + "00").slice(0, 2));
}

function addUsdStrings(a: string, b: string): string {
  const hundred = BigInt(100);
  const total = toCentsBigInt(a) + toCentsBigInt(b);
  const whole = total / hundred;
  const cents = (total % hundred).toString().padStart(2, "0");
  return `${whole.toString()}.${cents}`;
}

function compareUsdStrings(a: string, b: string): number {
  const zero = BigInt(0);
  const diff = toCentsBigInt(a) - toCentsBigInt(b);
  return diff === zero ? 0 : diff > zero ? 1 : -1;
}

function formatRemainingTime(closesAtIso: string, nowMs: number): string {
  const closesMs = new Date(closesAtIso).getTime();
  if (Number.isNaN(closesMs)) return "Horario por confirmar";
  const diffMs = closesMs - nowMs;
  if (diffMs <= 0) return "Plazo finalizado (pendiente de cierre oficial)";
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export default function AuctionBidPanel({ auctionId }: { auctionId: string }) {
  const [snapshot, setSnapshot] = useState<AuctionBidsState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Un único requestId generado por cada intento confirmado de oferta.
  const currentAttemptRequestIdRef = useRef<string | null>(null);

  const fetchAuctionSnapshot = useCallback(
    async (updateSuggestedInput = false) => {
      try {
        // Intentar primero GET /api/auctions/[id] (contrato de Antony) si está disponible,
        // y complementar/respaldar con GET /api/auctions/[id]/bids (contrato de Kevin).
        let detailData: Partial<AuctionBidsState> | null = null;
        try {
          const detailRes = await fetch(`/api/auctions/${encodeURIComponent(auctionId)}`, {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (detailRes.ok) {
            const detailBody = (await detailRes.json()) as {
              ok?: boolean;
              data?: Partial<AuctionBidsState>;
            };
            if (detailBody?.ok && detailBody.data) {
              detailData = detailBody.data;
            }
          }
        } catch {
          // Si /api/auctions/[id] aún no está montado, continuamos con /api/auctions/[id]/bids.
        }

        const bidsRes = await fetch(`/api/auctions/${encodeURIComponent(auctionId)}/bids`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const bidsBody = (await bidsRes.json()) as
          | { ok: true; data: AuctionBidsState }
          | { ok: false; error?: { message?: string } };

        if (!bidsRes.ok || !bidsBody.ok) {
          setLoadError(
            (!bidsBody.ok && bidsBody.error?.message) ||
              "No se pudo cargar el estado de ofertas de esta subasta.",
          );
          return;
        }

        const merged: AuctionBidsState = {
          ...bidsBody.data,
          ...(detailData?.status ? { status: detailData.status } : {}),
          ...(detailData?.closesAt ? { closesAt: detailData.closesAt } : {}),
        };

        setSnapshot(merged);
        setLoadError(null);
        if (updateSuggestedInput) {
          setAmountInput(merged.minNextBid);
        }
      } catch {
        setLoadError("Error de conexión al consultar las ofertas de la subasta.");
      } finally {
        setLoading(false);
      }
    },
    [auctionId],
  );

  // Carga inicial y suscripción Socket.IO a la sala "auction:" + auctionId
  useEffect(() => {
    queueMicrotask(() => {
      void fetchAuctionSnapshot(true);
    });

    const room = "auction:" + auctionId;
    const socket = io({ path: "/socket.io", withCredentials: true });

    socket.on("connect", () => {
      socket.emit("chat:join", { room }, (ack?: { ok?: boolean }) => {
        setRealtimeConnected(Boolean(ack?.ok));
      });
    });

    socket.on("disconnect", () => {
      setRealtimeConnected(false);
    });

    socket.on("auction:updated", (payload: AuctionUpdatedPayload) => {
      if (payload.auctionId !== auctionId) return;
      setSnapshot((prev) => {
        if (!prev) return prev;
        const nextMin = payload.highestBid
          ? addUsdStrings(payload.highestBid, prev.minIncrement)
          : prev.startingPrice;
        return {
          ...prev,
          highestBid: payload.highestBid,
          minNextBid: nextMin,
          bidCount: payload.bidCount,
          status: payload.status,
          closesAt: payload.closesAt,
        };
      });
      void fetchAuctionSnapshot(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [auctionId, fetchAuctionSnapshot]);

  // Temporizador informativo de cuenta regresiva cada 1 s
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleOpenConfirm = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    const trimmed = amountInput.trim();
    if (!USD_TWO_DECIMALS.test(trimmed)) {
      setFormError("Ingresa un importe válido en USD con dos decimales (ej. 160.00).");
      return;
    }

    if (snapshot && compareUsdStrings(trimmed, snapshot.minNextBid) < 0) {
      setFormError(`Tu oferta debe ser de al menos $${snapshot.minNextBid} USD.`);
      return;
    }

    // Genera un único requestId para este intento de oferta
    currentAttemptRequestIdRef.current = generateRequestId();
    setConfirmOpen(true);
  };

  const handleConfirmBid = async () => {
    const trimmed = amountInput.trim();
    const requestId = currentAttemptRequestIdRef.current ?? generateRequestId();
    currentAttemptRequestIdRef.current = requestId;

    setSubmitting(true);
    setFormError(null);
    setSuccessMsg(null);

    try {
      const response = await fetch(`/api/auctions/${encodeURIComponent(auctionId)}/bids`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: trimmed, requestId }),
      });

      const body = (await response.json()) as
        | {
            ok: true;
            data: { id: string; amount: string; auctionId: string; acceptedAt: string; alias: string };
          }
        | {
            ok: false;
            error?: {
              code?: string;
              message?: string;
              details?: { minRequired?: string; highestBid?: string | null };
            };
          };

      setConfirmOpen(false);

      if (!response.ok || !body.ok) {
        const errMessage =
          (!body.ok && body.error?.message) || "No fue posible registrar tu oferta.";
        setFormError(errMessage);

        // Si falla 409 (p. ej. otro postor ofertó antes), actualiza inmediatamente el precio mostrado
        if (response.status === 409) {
          if (!body.ok && body.error?.details?.minRequired) {
            const minReq = body.error.details.minRequired;
            const high = body.error.details.highestBid ?? null;
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    highestBid: high ?? prev.highestBid,
                    minNextBid: minReq,
                  }
                : prev,
            );
            setAmountInput(minReq);
          }
          await fetchAuctionSnapshot(false);
        }
        return;
      }

      setSuccessMsg(
        `Oferta registrada por $${body.data.amount} USD bajo tu seudónimo ${body.data.alias}.`,
      );
      await fetchAuctionSnapshot(true);
    } catch {
      setConfirmOpen(false);
      setFormError("Error de red al enviar tu oferta. Inténtalo nuevamente.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <p role="status" className="text-sm">
        Cargando ofertas en tiempo real…
      </p>
    );
  }

  if (loadError || !snapshot) {
    return (
      <div role="alert" className="space-y-3">
        <p className="pf-error text-sm">
          {loadError ?? "No se encontró información de ofertas para esta subasta."}
        </p>
        <Button variant="secondary" onClick={() => void fetchAuctionSnapshot(true)}>
          Reintentar
        </Button>
      </div>
    );
  }

  const isAuctionActive = snapshot.status === "ACTIVA";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isAuctionActive ? "success" : "accent"}>{snapshot.status}</Badge>
          <Badge variant={realtimeConnected ? "success" : "neutral"}>
            {realtimeConnected ? "Tiempo real activo" : "Sincronizando…"}
          </Badge>
        </div>
        <NotificationBellLink className="pf-btn-secondary text-xs" />
      </div>

      <dl className="space-y-2 text-sm border rounded-lg p-3" style={{ borderColor: "var(--pf-border)" }}>
        <div className="flex items-center justify-between gap-2">
          <dt className="opacity-80">Oferta máxima vigente:</dt>
          <dd className="font-mono font-bold text-base" style={{ color: "var(--pf-primary)" }}>
            {snapshot.highestBid ? `$${snapshot.highestBid} USD` : "Sin ofertas aún"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="opacity-80">Mínimo para ofertar:</dt>
          <dd className="font-mono font-semibold">${snapshot.minNextBid} USD</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="opacity-80">Incremento mínimo:</dt>
          <dd className="font-mono">+${snapshot.minIncrement} USD</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="opacity-80">Ofertas aceptadas:</dt>
          <dd className="font-semibold">{snapshot.bidCount}</dd>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: "var(--pf-border)" }}>
          <dt className="opacity-80">Tiempo restante:</dt>
          <dd className="font-mono text-xs font-semibold">
            {formatRemainingTime(snapshot.closesAt, nowMs)}
          </dd>
        </div>
      </dl>

      {formError && (
        <p role="alert" className="pf-error text-sm">
          {formError}
        </p>
      )}

      {successMsg && (
        <p role="status" className="pf-success text-sm">
          {successMsg}
        </p>
      )}

      {isAuctionActive ? (
        <form onSubmit={handleOpenConfirm} className="space-y-3" noValidate>
          <TextField
            label="Tu oferta en USD (dos decimales)"
            name="bidAmount"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder={snapshot.minNextBid}
            disabled={submitting}
            required
          />
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Registrando oferta…" : "Ofertar"}
          </Button>
        </form>
      ) : (
        <p className="text-xs opacity-80">
          Esta subasta se encuentra en estado <strong>{displayLabel(snapshot.status)}</strong> y no admite nuevas ofertas en este momento.
        </p>
      )}

      <div className="pt-3 border-t space-y-2" style={{ borderColor: "var(--pf-border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide opacity-75">
          Historial reciente de ofertas (seudónimos protegidos)
        </h3>
        {snapshot.items.length === 0 ? (
          <p className="text-xs opacity-75">Aún no se han registrado ofertas en esta subasta.</p>
        ) : (
          <ul className="space-y-1 text-xs max-h-40 overflow-y-auto">
            {snapshot.items.slice(0, 10).map((item, idx) => (
              <li
                key={`${item.alias}-${item.acceptedAt}-${idx}`}
                className="flex items-center justify-between gap-2 py-1 border-b last:border-b-0"
                style={{ borderColor: "var(--pf-border)" }}
              >
                <span><span className="font-mono font-semibold">{item.alias}</span><time className="block text-[var(--pf-muted)]" dateTime={item.acceptedAt}>{formatDate(item.acceptedAt)}</time></span>
                <span className="font-mono font-bold">${item.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar oferta en firme"
        message={`¿Confirmas registrar tu oferta por $${amountInput.trim()} USD por «${snapshot.title}» (subasta #${auctionId})? Si resulta ganadora, implica un compromiso comercial.`}
        confirmText="Confirmar oferta"
        cancelText="Cancelar"
        loading={submitting}
        onConfirm={() => void handleConfirmBid()}
        onCancel={() => {
          if (!submitting) setConfirmOpen(false);
        }}
      />
    </div>
  );
}
