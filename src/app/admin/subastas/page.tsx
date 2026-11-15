"use client";

import React, { useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import {
  createAuctionSchema,
  suspendAuctionSchema,
  validateStartingPriceAgainstArticle,
} from "@/modules/auctions/auction-schema";

interface ApprovedArticleOption {
  id: string;
  title: string;
  category: string;
  initialPrice: string;
}

interface AdminAuctionRow {
  id: string;
  articleId: string;
  articleTitle: string;
  startingPrice: string;
  minIncrement: string;
  opensAt: string;
  closesAt: string;
  status:
    | "BORRADOR"
    | "PROGRAMADA"
    | "ACTIVA"
    | "SUSPENDIDA"
    | "CERRADA_SIN_OFERTAS"
    | "ADJUDICADA"
    | "CANCELADA";
  bidCount: number;
  highestBid: string | null;
}

const APPROVED_ARTICLES: ApprovedArticleOption[] = [
  {
    id: "art-aprob-001",
    title: "Reloj Cronógrafo Suizo Automático c. 1968",
    category: "Relojería",
    initialPrice: "1250.00",
  },
  {
    id: "art-aprob-003",
    title: "Moneda Conmemorativa de Plata 1884",
    category: "Numismática",
    initialPrice: "320.00",
  },
];

const INITIAL_AUCTIONS: AdminAuctionRow[] = [
  {
    id: "sub-demo-001",
    articleId: "art-aprob-010",
    articleTitle: "Escultura de Bronce Fundido Siglo XIX",
    startingPrice: "1500.00",
    minIncrement: "50.00",
    opensAt: "2026-11-15T14:00:00Z",
    closesAt: "2026-11-16T20:00:00Z",
    status: "PROGRAMADA",
    bidCount: 0,
    highestBid: null,
  },
  {
    id: "sub-demo-002",
    articleId: "art-aprob-011",
    articleTitle: "Mapa Cartográfico Antiguo de Quito (1748)",
    startingPrice: "900.00",
    minIncrement: "25.00",
    opensAt: "2026-11-14T18:00:00Z",
    closesAt: "2026-11-17T18:00:00Z",
    status: "ACTIVA",
    bidCount: 6,
    highestBid: "1125.00",
  },
];

function badgeForAuctionStatus(status: AdminAuctionRow["status"]) {
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

export default function AdminSubastasPage() {
  const [auctions, setAuctions] = useState<AdminAuctionRow[]>(INITIAL_AUCTIONS);
  const [articleId, setArticleId] = useState(APPROVED_ARTICLES[0]?.id ?? "");
  const [startingPrice, setStartingPrice] = useState("1250.00");
  const [minIncrement, setMinIncrement] = useState("50.00");
  const [opensAt, setOpensAt] = useState("2026-11-16T10:00:00Z");
  const [closesAt, setClosesAt] = useState("2026-11-17T18:00:00Z");
  const [suspendReasons, setSuspendReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  function handleScheduleAuction(e: React.FormEvent<HTMLFormElement>) {
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

    const selectedArt = APPROVED_ARTICLES.find((a) => a.id === parsed.data.articleId);
    if (!selectedArt) {
      setFeedback({
        type: "error",
        text: "Selecciona un artículo aprobado válido.",
      });
      return;
    }

    const priceCheck = validateStartingPriceAgainstArticle(
      parsed.data.startingPrice,
      selectedArt.initialPrice
    );
    if (!priceCheck.ok) {
      setFeedback({ type: "error", text: priceCheck.message });
      return;
    }

    const newAuction: AdminAuctionRow = {
      id: `sub-demo-00${auctions.length + 1}`,
      articleId: selectedArt.id,
      articleTitle: selectedArt.title,
      startingPrice: parsed.data.startingPrice,
      minIncrement: parsed.data.minIncrement,
      opensAt: parsed.data.opensAt,
      closesAt: parsed.data.closesAt,
      status: "PROGRAMADA",
      bidCount: 0,
      highestBid: null,
    };

    setAuctions((prev) => [newAuction, ...prev]);
    setFeedback({
      type: "success",
      text: `Subasta ${newAuction.id} programada correctamente para "${selectedArt.title}".`,
    });
  }

  function handleActivate(auctionId: string) {
    setFeedback(null);
    setAuctions((prev) =>
      prev.map((a) => (a.id === auctionId ? { ...a, status: "ACTIVA" } : a))
    );
    setFeedback({
      type: "success",
      text: `Subasta ${auctionId} activada (referencia de tiempo validada en servidor).`,
    });
  }

  function handleSuspend(auctionId: string) {
    setFeedback(null);
    const reason = suspendReasons[auctionId] ?? "";
    const parsed = suspendAuctionSchema.safeParse({ reason });
    if (!parsed.success) {
      setFeedback({
        type: "error",
        text: parsed.error.issues[0]?.message ?? "Debes ingresar un motivo válido para suspender.",
      });
      return;
    }

    setAuctions((prev) =>
      prev.map((a) => (a.id === auctionId ? { ...a, status: "SUSPENDIDA" } : a))
    );
    setFeedback({
      type: "success",
      text: `Subasta ${auctionId} suspendida. Motivo registrado: "${parsed.data.reason}".`,
    });
  }

  return (
    <main className="pf-page space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Programación y Supervisión de Subastas
          </h1>
          <p className="text-sm mt-1">
            Configuración comercial de artículos aprobados y control del estado de las subastas.
          </p>
        </div>
        <Link href="/admin" className="pf-btn-secondary">
          ← Volver a Administración
        </Link>
      </div>

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
        <h2 className="text-lg font-semibold mb-4">Programar nueva subasta</h2>
        <form onSubmit={handleScheduleAuction} className="grid grid-cols-1 md:grid-cols-2 gap-4" noValidate>
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
                const found = APPROVED_ARTICLES.find((a) => a.id === nextId);
                if (found) setStartingPrice(found.initialPrice);
              }}
              className="pf-input"
            >
              {APPROVED_ARTICLES.map((art) => (
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
            placeholder="1250.00"
            required
          />

          <TextField
            label="Incremento mínimo por puja (USD, 2 decimales)"
            name="minIncrement"
            value={minIncrement}
            onChange={(e) => setMinIncrement(e.target.value)}
            placeholder="50.00"
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
            <Button type="submit">Programar</Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold mb-4">Supervisión de subastas</h2>
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
              {auctions.map((auction) => (
                <tr key={auction.id}>
                  <td className="font-mono text-xs">{auction.id}</td>
                  <td>
                    <div className="font-semibold">{auction.articleTitle}</div>
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
                      <div className="font-mono font-semibold">Máx: ${auction.highestBid}</div>
                    )}
                  </td>
                  <td>
                    <Badge variant={badgeForAuctionStatus(auction.status)}>{auction.status}</Badge>
                  </td>
                  <td>
                    <div className="flex flex-col gap-2 min-w-[200px]">
                      {(auction.status === "PROGRAMADA" || auction.status === "BORRADOR") && (
                        <Button type="button" onClick={() => handleActivate(auction.id)}>
                          Activar
                        </Button>
                      )}
                      {(auction.status === "PROGRAMADA" || auction.status === "ACTIVA") && (
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
                            onClick={() => handleSuspend(auction.id)}
                          >
                            Suspender
                          </Button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
