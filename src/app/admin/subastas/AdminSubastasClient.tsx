"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import {
  createAuctionSchema,
  suspendAuctionSchema,
  validateStartingPriceAgainstArticle,
} from "@/modules/auctions/auction-schema";
import type {
  AdminAuctionItem,
  ApprovedArticleOption,
} from "@/modules/auctions/auction-service";

interface AdminSubastasClientProps {
  initialAuctions: AdminAuctionItem[];
  initialApprovedArticles: ApprovedArticleOption[];
  serverNowIso: string;
}

function badgeForAuctionStatus(status: AdminAuctionItem["status"]) {
  switch (status) {
    case "ACTIVA":
      return "success";
    case "SUSPENDIDA":
    case "CANCELADA":
      return "error";
    case "PROGRAMADA":
    case "ADJUDICADA":
      return "accent";
    default:
      return "neutral";
  }
}

function defaultIsoWindow(serverNowIso: string): { opensAt: string; closesAt: string } {
  const base = new Date(serverNowIso);
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  const opens = new Date(safeBase.getTime() - 60 * 1000);
  opens.setMilliseconds(0);
  const closes = new Date(safeBase.getTime() + 24 * 60 * 60 * 1000);
  closes.setMilliseconds(0);
  return {
    opensAt: opens.toISOString().replace(".000Z", "Z"),
    closesAt: closes.toISOString().replace(".000Z", "Z"),
  };
}

export default function AdminSubastasClient({
  initialAuctions,
  initialApprovedArticles,
  serverNowIso,
}: AdminSubastasClientProps) {
  const router = useRouter();
  const initialWindow = defaultIsoWindow(serverNowIso);

  const [auctions, setAuctions] = useState<AdminAuctionItem[]>(initialAuctions);
  const [approvedArticles, setApprovedArticles] =
    useState<ApprovedArticleOption[]>(initialApprovedArticles);

  const [articleId, setArticleId] = useState<string>(initialApprovedArticles[0]?.id ?? "");
  const [startingPrice, setStartingPrice] = useState<string>(
    initialApprovedArticles[0]?.initialPrice ?? "150.00",
  );
  const [minIncrement, setMinIncrement] = useState<string>("10.00");
  const [opensAt, setOpensAt] = useState<string>(initialWindow.opensAt);
  const [closesAt, setClosesAt] = useState<string>(initialWindow.closesAt);

  const [submittingCreate, setSubmittingCreate] = useState<boolean>(false);
  const [busyAuctionId, setBusyAuctionId] = useState<string | null>(null);
  const [suspendReasons, setSuspendReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  async function handleScheduleAuction(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);

    const parsed = createAuctionSchema.safeParse({
      articleId,
      startingPrice,
      minIncrement,
      opensAt,
      closesAt,
    });

    if (!parsed.success) {
      setFeedback({
        type: "error",
        text: parsed.error.issues[0]?.message ?? "Revisa los parámetros de la subasta.",
      });
      return;
    }

    const selectedArt = approvedArticles.find((a) => a.id === parsed.data.articleId);
    if (!selectedArt) {
      setFeedback({
        type: "error",
        text: "Selecciona un artículo aprobado válido y disponible.",
      });
      return;
    }

    const priceCheck = validateStartingPriceAgainstArticle(
      parsed.data.startingPrice,
      selectedArt.initialPrice,
    );
    if (!priceCheck.ok) {
      setFeedback({ type: "error", text: priceCheck.message });
      return;
    }

    setSubmittingCreate(true);
    try {
      const response = await fetch("/api/auctions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const payload = (await response.json()) as
        | { ok: true; data: AdminAuctionItem }
        | { ok: false; error?: { message?: string } };

      if (!response.ok || !payload.ok) {
        setFeedback({
          type: "error",
          text:
            (!payload.ok && payload.error?.message) ||
            "No se pudo programar la subasta. Verifica los datos.",
        });
        return;
      }

      const created = payload.data;
      setAuctions((prev) => [created, ...prev]);
      const remainingArticles = approvedArticles.filter((a) => a.id !== selectedArt.id);
      setApprovedArticles(remainingArticles);
      setArticleId(remainingArticles[0]?.id ?? "");
      if (remainingArticles[0]) {
        setStartingPrice(remainingArticles[0].initialPrice);
      }

      setFeedback({
        type: "success",
        text: `Subasta ${created.id} programada correctamente para "${selectedArt.title}". El artículo pasó a estado ASOCIADO_SUBASTA.`,
      });
      router.refresh();
    } catch {
      setFeedback({
        type: "error",
        text: "Error de conexión al programar la subasta.",
      });
    } finally {
      setSubmittingCreate(false);
    }
  }

  async function handleActivate(auctionId: string) {
    setFeedback(null);
    setBusyAuctionId(auctionId);
    try {
      const response = await fetch(
        `/api/admin/auctions/${encodeURIComponent(auctionId)}/activate`,
        {
          method: "POST",
          credentials: "same-origin",
        },
      );

      const payload = (await response.json()) as
        | { ok: true; data: AdminAuctionItem }
        | { ok: false; error?: { message?: string } };

      if (!response.ok || !payload.ok) {
        setFeedback({
          type: "error",
          text:
            (!payload.ok && payload.error?.message) ||
            "No se pudo activar la subasta. Verifica el horario del servidor.",
        });
        return;
      }

      setAuctions((prev) =>
        prev.map((item) => (item.id === auctionId ? payload.data : item)),
      );
      setFeedback({
        type: "success",
        text: `Subasta ${auctionId} activada oficialmente en el servidor.`,
      });
      router.refresh();
    } catch {
      setFeedback({
        type: "error",
        text: "Error de conexión al intentar activar la subasta.",
      });
    } finally {
      setBusyAuctionId(null);
    }
  }

  async function handleSuspend(auctionId: string) {
    setFeedback(null);
    const reason = suspendReasons[auctionId] ?? "";
    const parsed = suspendAuctionSchema.safeParse({ reason });
    if (!parsed.success) {
      setFeedback({
        type: "error",
        text:
          parsed.error.issues[0]?.message ??
          "Debes ingresar un motivo válido para suspender la subasta.",
      });
      return;
    }

    setBusyAuctionId(auctionId);
    try {
      const response = await fetch(
        `/api/admin/auctions/${encodeURIComponent(auctionId)}/suspend`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: parsed.data.reason }),
        },
      );

      const payload = (await response.json()) as
        | { ok: true; data: AdminAuctionItem }
        | { ok: false; error?: { message?: string } };

      if (!response.ok || !payload.ok) {
        setFeedback({
          type: "error",
          text:
            (!payload.ok && payload.error?.message) ||
            "No se pudo suspender la subasta.",
        });
        return;
      }

      setAuctions((prev) =>
        prev.map((item) => (item.id === auctionId ? payload.data : item)),
      );
      setSuspendReasons((prev) => ({ ...prev, [auctionId]: "" }));
      setFeedback({
        type: "success",
        text: `Subasta ${auctionId} suspendida y auditada correctamente.`,
      });
      router.refresh();
    } catch {
      setFeedback({
        type: "error",
        text: "Error de conexión al intentar suspender la subasta.",
      });
    } finally {
      setBusyAuctionId(null);
    }
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <Card>
          <p
            className={feedback.type === "error" ? "pf-error" : "pf-success"}
            role={feedback.type === "error" ? "alert" : "status"}
          >
            {feedback.text}
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold">Programar nueva subasta</h2>
          <span className="text-xs font-mono opacity-75">
            Referencia servidor: {serverNowIso}
          </span>
        </div>

        {approvedArticles.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p role="status">
              No hay artículos en estado <strong>APROBADO</strong> pendientes de programar en este momento.
            </p>
            <Link href="/admin/verificaciones" className="pf-btn-secondary inline-block">
              Revisar cola de verificaciones
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleScheduleAuction}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            noValidate
          >
            <div className="pf-field md:col-span-2">
              <label htmlFor="articleId" className="pf-label">
                Artículo con verificación APROBADA *
              </label>
              <select
                id="articleId"
                name="articleId"
                value={articleId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setArticleId(nextId);
                  const found = approvedArticles.find((a) => a.id === nextId);
                  if (found) setStartingPrice(found.initialPrice);
                }}
                className="pf-input"
              >
                {approvedArticles.map((art) => (
                  <option key={art.id} value={art.id}>
                    {art.title} — Precio inicial aprobado: ${art.initialPrice} USD ({art.category})
                  </option>
                ))}
              </select>
            </div>

            <TextField
              label="Precio de salida (USD, 2 decimales)"
              name="startingPrice"
              value={startingPrice}
              onChange={(e) => setStartingPrice(e.target.value)}
              placeholder="150.00"
              required
            />

            <TextField
              label="Incremento mínimo por puja (USD, 2 decimales)"
              name="minIncrement"
              value={minIncrement}
              onChange={(e) => setMinIncrement(e.target.value)}
              placeholder="10.00"
              required
            />

            <TextField
              label="Fecha y hora de apertura (ISO 8601 UTC)"
              name="opensAt"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              placeholder="2026-11-16T10:00:00Z"
              required
            />

            <TextField
              label="Fecha y hora de cierre (ISO 8601 UTC)"
              name="closesAt"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              placeholder="2026-11-17T18:00:00Z"
              required
            />

            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={submittingCreate}>
                {submittingCreate ? "Programando…" : "Programar"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold mb-4">Supervisión de subastas</h2>
        {auctions.length === 0 ? (
          <p className="text-sm" role="status">
            Aún no existen subastas registradas en el sistema.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Lote / Artículo</th>
                  <th>Salida / Incremento</th>
                  <th>Apertura / Cierre (Servidor)</th>
                  <th>Ofertas</th>
                  <th>Estado</th>
                  <th>Operaciones</th>
                </tr>
              </thead>
              <tbody>
                {auctions.map((auction) => {
                  const isBusy = busyAuctionId === auction.id;
                  return (
                    <tr key={auction.id}>
                      <td className="font-mono text-xs">{auction.id}</td>
                      <td>
                        <div className="font-semibold">{auction.articleTitle}</div>
                        <div className="text-xs opacity-75">{auction.category}</div>
                        <Link
                          href={`/subastas/${auction.id}`}
                          className="text-xs underline"
                          style={{ color: "var(--pf-primary)" }}
                        >
                          Ver ficha pública
                        </Link>
                      </td>
                      <td className="font-mono text-xs">
                        Salida: ${auction.startingPrice}
                        <br />
                        Incr.: +${auction.minIncrement}
                      </td>
                      <td className="font-mono text-xs">
                        Abre: {auction.opensAt}
                        <br />
                        Cierra: {auction.closesAt}
                      </td>
                      <td className="text-xs">
                        {auction.bidCount} pujas
                        {auction.highestBid && (
                          <div className="font-mono font-semibold">
                            Máx: ${auction.highestBid}
                          </div>
                        )}
                        {auction.winnerAlias && (
                          <div className="font-mono text-xs mt-1">
                            Ganador: {auction.winnerAlias}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge variant={badgeForAuctionStatus(auction.status)}>
                          {auction.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-col gap-2 min-w-[210px]">
                          {(auction.status === "PROGRAMADA" ||
                            auction.status === "BORRADOR") && (
                            <Button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleActivate(auction.id)}
                            >
                              {isBusy ? "Procesando…" : "Activar"}
                            </Button>
                          )}
                          {(auction.status === "PROGRAMADA" ||
                            auction.status === "ACTIVA") && (
                            <div className="flex flex-col gap-1">
                              <input
                                type="text"
                                className="pf-input text-xs"
                                placeholder="Motivo de suspensión (mín. 5 car.)"
                                aria-label={`Motivo para suspender ${auction.id}`}
                                value={suspendReasons[auction.id] ?? ""}
                                onChange={(e) =>
                                  setSuspendReasons((prev) => ({
                                    ...prev,
                                    [auction.id]: e.target.value,
                                  }))
                                }
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={isBusy}
                                onClick={() => handleSuspend(auction.id)}
                              >
                                Suspender
                              </Button>
                            </div>
                          )}
                          {auction.status !== "PROGRAMADA" &&
                            auction.status !== "BORRADOR" &&
                            auction.status !== "ACTIVA" && (
                              <span className="text-xs opacity-70">
                                Sin acciones pendientes
                              </span>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
