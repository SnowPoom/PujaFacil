"use client";
import { formatDate } from "@/lib/presentation";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Pagination from "@/components/ui/Pagination";
import type {
  PublicAuctionListItem,
  PublicAuctionListResult,
} from "@/modules/auctions/auction-service";

function badgeVariant(status: PublicAuctionListItem["status"]) {
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

export default function SubastasClient({ initialResult }: { initialResult: PublicAuctionListResult }) {
  const [query, setQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("TODAS");
  const [page, setPage] = useState<number>(1);
  const [result, setResult] = useState<PublicAuctionListResult | null>(initialResult);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const initialListing = useRef(true);
  useEffect(() => {
    if (initialListing.current && page === 1 && query === "" && statusFilter === "TODAS") return;
    initialListing.current = false;
    let active = true;
    const controller = new AbortController();

    async function fetchCatalog() {
      try {
        const params = new URLSearchParams();
        if (statusFilter && statusFilter !== "TODAS") {
          params.set("status", statusFilter);
        }
        if (query.trim()) {
          params.set("q", query.trim());
        }
        params.set("page", String(page));
        params.set("pageSize", "9");

        const response = await fetch(`/api/auctions?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json()) as
          | { ok: true; data: PublicAuctionListResult }
          | { ok: false; error?: { message?: string } };

        if (!active) return;

        if (!response.ok || !payload.ok) {
          setErrorMsg(
            (!payload.ok && payload.error?.message) ||
              "No se pudo cargar el catálogo público de subastas.",
          );
          setLoading(false);
          return;
        }

        setResult(payload.data);
        setErrorMsg(null);
        setLoading(false);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setErrorMsg("Error de conexión al consultar las subastas públicas.");
        setLoading(false);
      }
    }

    void fetchCatalog();

    return () => {
      active = false;
      controller.abort();
    };
  }, [query, statusFilter, page]);

  const items = result?.items ?? [];
  const totalPages = result?.pages ?? 1;

  return (
    <main className="pf-page space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Catálogo de subastas
          </h1>
          <p className="text-sm mt-1">
            Explora artículos verificados, consulta sus condiciones y participa en las subastas disponibles.
          </p>
        </div>
        <Link href="/" className="pf-btn-secondary">
          Ver catálogo de artículos
        </Link>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="pf-field md:col-span-2">
            <label htmlFor="search-auctions" className="pf-label">
              Buscar por título o categoría
            </label>
            <input
              id="search-auctions"
              type="search"
              className="pf-input"
              placeholder="Ej. Relojería, Escultura, Cartografía..."
              value={query}
              onChange={(e) => {
                setLoading(true);
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="pf-field">
            <label htmlFor="status-auctions" className="pf-label">
              Estado de subasta
            </label>
            <select
              id="status-auctions"
              className="pf-input"
              value={statusFilter}
              onChange={(e) => {
                setLoading(true);
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="TODAS">Todas las públicas</option>
              <option value="ACTIVA">En vivo</option>
              <option value="PROGRAMADA">Próximas</option>
              <option value="ADJUDICADA">Adjudicadas</option>
              <option value="CERRADA_SIN_OFERTAS">Cerradas sin ofertas</option>
            </select>
          </div>
        </div>
      </Card>

      {errorMsg && (
        <Card>
          <p className="pf-error" role="alert">
            {errorMsg}
          </p>
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-sm" role="status">
            Consultando subastas disponibles…
          </p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm" role="status">
            No se encontraron subastas que coincidan con los filtros seleccionados.
          </p>
        </Card>
      ) : (
        <section
          aria-label="Listado de subastas públicas"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col justify-between gap-4">
              <div className="space-y-3">
                {item.photoFileIds[0] && (
                  <div
                    className="w-full h-44 overflow-hidden rounded-lg border flex items-center justify-center bg-white"
                    style={{ borderColor: "var(--pf-border)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${encodeURIComponent(item.photoFileIds[0])}`}
                      alt={`Fotografía de ${item.title}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <Badge variant={badgeVariant(item.status)}>{item.status}</Badge>
                  <span className="text-xs font-mono opacity-70">{item.id}</span>
                </div>

                <div>
                  <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
                  <p className="text-xs opacity-75 mt-1">{item.category}</p>
                </div>

                <dl
                  className="text-sm space-y-1 border-t pt-3"
                  style={{ borderColor: "var(--pf-border)" }}
                >
                  <div className="flex justify-between">
                    <dt className="opacity-80">Precio de salida:</dt>
                    <dd className="font-mono font-semibold">${item.startingPrice} USD</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="opacity-80">Incremento mínimo:</dt>
                    <dd className="font-mono">+${item.minIncrement} USD</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="opacity-80">Oferta máxima:</dt>
                    <dd
                      className="font-mono font-bold"
                      style={{ color: "var(--pf-primary)" }}
                    >
                      {item.highestBid ? `$${item.highestBid} USD` : "Sin ofertas"}
                    </dd>
                  </div>
                  <div className="flex justify-between text-xs pt-1">
                    <dt className="opacity-75">Ofertas registradas:</dt>
                    <dd>{item.bidCount}</dd>
                  </div>
                  <div className="flex justify-between text-xs">
                    <dt className="opacity-75">Apertura:</dt>
                    <dd className="font-mono">{formatDate(item.opensAt)}</dd>
                  </div>
                  <div className="flex justify-between text-xs">
                    <dt className="opacity-75">Cierre:</dt>
                    <dd className="font-mono">{formatDate(item.closesAt)}</dd>
                  </div>
                  {item.winnerAlias && (
                    <div
                      className="flex justify-between text-xs pt-1 font-semibold"
                      style={{ color: "var(--pf-success)" }}
                    >
                      <dt>Seudónimo ganador:</dt>
                      <dd className="font-mono">{item.winnerAlias}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <Link href={`/subastas/${item.id}`} className="pf-btn text-center">
                Ver ficha y ofertas
              </Link>
            </Card>
          ))}
        </section>
      )}

      <Pagination
        page={page}
        pages={totalPages}
        onPageChange={(nextPage) => {
          setLoading(true);
          setPage(nextPage);
        }}
      />
    </main>
  );
}
