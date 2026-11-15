"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Pagination from "@/components/ui/Pagination";

type PublicAuctionStatus = "ACTIVA" | "PROGRAMADA" | "ADJUDICADA" | "CERRADA_SIN_OFERTAS";

interface PublicAuctionItem {
  id: string;
  title: string;
  category: string;
  startingPrice: string;
  minIncrement: string;
  highestBid: string | null;
  bidCount: number;
  status: PublicAuctionStatus;
  opensAt: string;
  closesAt: string;
  winnerAlias?: string;
}

const PUBLIC_AUCTIONS_MOCK: PublicAuctionItem[] = [
  {
    id: "sub-demo-002",
    title: "Mapa Cartográfico Antiguo de Quito (1748)",
    category: "Cartografía e Historia",
    startingPrice: "900.00",
    minIncrement: "25.00",
    highestBid: "1125.00",
    bidCount: 6,
    status: "ACTIVA",
    opensAt: "2026-11-14T18:00:00Z",
    closesAt: "2026-11-17T18:00:00Z",
  },
  {
    id: "sub-demo-001",
    title: "Escultura de Bronce Fundido Siglo XIX",
    category: "Escultura",
    startingPrice: "1500.00",
    minIncrement: "50.00",
    highestBid: null,
    bidCount: 0,
    status: "PROGRAMADA",
    opensAt: "2026-11-15T14:00:00Z",
    closesAt: "2026-11-16T20:00:00Z",
  },
  {
    id: "sub-demo-000",
    title: "Juego de Té de Plata Martillada s. XX",
    category: "Platería",
    startingPrice: "450.00",
    minIncrement: "20.00",
    highestBid: "620.00",
    bidCount: 5,
    status: "ADJUDICADA",
    opensAt: "2026-11-10T12:00:00Z",
    closesAt: "2026-11-12T18:00:00Z",
    winnerAlias: "Postor-A84F",
  },
];

function badgeVariant(status: PublicAuctionStatus) {
  switch (status) {
    case "ACTIVA":
      return "success";
    case "PROGRAMADA":
    case "ADJUDICADA":
      return "accent";
    default:
      return "neutral";
  }
}

export default function SubastasPublicasPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("TODAS");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return PUBLIC_AUCTIONS_MOCK.filter((item) => {
      const matchesStatus = statusFilter === "TODAS" || item.status === statusFilter;
      const matchesText =
        query.trim() === "" ||
        item.title.toLowerCase().includes(query.trim().toLowerCase()) ||
        item.category.toLowerCase().includes(query.trim().toLowerCase());
      return matchesStatus && matchesText;
    });
  }, [query, statusFilter]);

  return (
    <main className="pf-page space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Catálogo Público de Subastas
          </h1>
          <p className="text-sm mt-1">
            Explora lotes verificados por nuestra casa de subastas. Ofertas en USD con identidad protegida mediante seudónimo.
          </p>
        </div>
        <Link href="/" className="pf-btn-secondary">
          Catálogo de artículos
        </Link>
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="auction-search" className="pf-label">
              Buscar por título o categoría
            </label>
            <input
              id="auction-search"
              type="search"
              className="pf-input"
              placeholder="Ej. Cartografía, Escultura, Relojería…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label htmlFor="auction-status-filter" className="pf-label">
              Filtrar por estado
            </label>
            <select
              id="auction-status-filter"
              className="pf-input"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="TODAS">Todas las subastas públicas</option>
              <option value="ACTIVA">ACTIVA (en vivo)</option>
              <option value="PROGRAMADA">PROGRAMADA (próximas)</option>
              <option value="ADJUDICADA">ADJUDICADA (resultados)</option>
            </select>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-center py-6">
            No se encontraron subastas que coincidan con los criterios de búsqueda.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((auction) => (
            <Card key={auction.id} className="flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono opacity-75">{auction.category}</span>
                  <Badge variant={badgeVariant(auction.status)}>{auction.status}</Badge>
                </div>

                <h2 className="text-lg font-bold leading-snug">{auction.title}</h2>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs" style={{ borderColor: "var(--pf-border)" }}>
                  <div>
                    <span className="opacity-75 block">Precio salida</span>
                    <span className="font-mono font-semibold text-sm">${auction.startingPrice}</span>
                  </div>
                  <div>
                    <span className="opacity-75 block">Oferta máxima</span>
                    <span className="font-mono font-bold text-sm" style={{ color: "var(--pf-primary)" }}>
                      {auction.highestBid ? `$${auction.highestBid}` : "Sin pujas"}
                    </span>
                  </div>
                </div>

                <div className="text-xs space-y-1 opacity-80">
                  <div>Incremento mínimo: +${auction.minIncrement} USD</div>
                  <div>Ofertas registradas: {auction.bidCount}</div>
                  <div>Cierre (servidor): {auction.closesAt}</div>
                  {auction.winnerAlias && (
                    <div className="font-semibold">
                      Seudónimo adjudicado: <span className="font-mono">{auction.winnerAlias}</span>
                    </div>
                  )}
                </div>
              </div>

              <Link href={`/subastas/${auction.id}`} className="pf-btn text-center">
                {auction.status === "ACTIVA" ? "Ingresar y ofertar en vivo" : "Ver ficha de subasta"}
              </Link>
            </Card>
          ))}
        </div>
      )}

      <Pagination page={page} pages={1} onPageChange={setPage} />
    </main>
  );
}
