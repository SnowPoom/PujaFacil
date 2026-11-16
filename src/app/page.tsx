"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import Badge from "@/components/ui/Badge";
import Pagination from "@/components/ui/Pagination";

type PublicArticle = {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  provenance: string;
  initialPrice: string;
  status: "APROBADO" | "ASOCIADO_SUBASTA";
  createdAt: string;
  photoUrl: string | null;
  auction: { id: string; status: string; startingPrice: string; closesAt: string } | null;
};

type CatalogData = { items: PublicArticle[]; page: number; pageSize: number; total: number; pages: number };

export default function CatalogPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PublicArticle | null>(null);
  const requestKey = useMemo(() => {
    const params = new URLSearchParams({ q: query, category: category || "ALL", page: String(page), pageSize: "8" });
    return `/api/public/articles?${params.toString()}`;
  }, [query, category, page]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(requestKey, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "No se pudo cargar el catálogo.");
        return payload.data as CatalogData;
      })
      .then((data) => {
        setCatalog(data);
        setLoadedKey(requestKey);
        setError("");
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      });
    return () => controller.abort();
  }, [requestKey]);

  const loading = loadedKey !== requestKey;
  const categories = [...new Set(catalog?.items.map((item) => item.category) ?? [])].sort((a, b) => a.localeCompare(b));

  return (
    <main className="pf-page">
      <header className="mb-8 flex flex-col gap-5 border-b border-[var(--pf-border)] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pf-primary)]">PujaFácil · Subastas privadas</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Catálogo de artículos</h1>
          <p className="mt-3 max-w-2xl text-[var(--pf-text)]/75">Explora piezas aprobadas y consulta las subastas disponibles.</p>
        </div>
        <nav className="flex flex-wrap gap-3" aria-label="Accesos rápidos">
          <Link href="/subastas" className="pf-btn-secondary">Subastas</Link>
          <Link href="/mis-articulos" className="pf-btn">Mis artículos</Link>
        </nav>
      </header>

      <section className="pf-card mb-6" aria-label="Filtros del catálogo">
        <div className="grid gap-4 sm:grid-cols-[1fr_minmax(180px,0.45fr)_auto] sm:items-end">
          <label className="pf-label">Buscar por título o descripción
            <input className="pf-input mt-1" type="search" value={query} placeholder="Ej. reloj antiguo" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          </label>
          <label className="pf-label">Categoría
            <select className="pf-input mt-1" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
              <option value="">Todas las categorías</option>
              {categories.map((itemCategory) => <option key={itemCategory} value={itemCategory}>{itemCategory}</option>)}
            </select>
          </label>
          <button className="pf-btn-secondary" type="button" onClick={() => { setQuery(""); setCategory(""); setPage(1); }}>Limpiar filtros</button>
        </div>
      </section>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[var(--pf-text)]/70">{loading ? "Cargando artículos…" : `${catalog?.total ?? 0} artículos encontrados`}</p>
      </div>
      {error && <p className="pf-card mb-5 text-[var(--pf-error)]" role="alert">{error}</p>}

      {!loading && !error && catalog?.items.length === 0 && (
        <div className="pf-card py-12 text-center"><h2 className="text-xl font-semibold">No encontramos artículos</h2><p className="mt-2 text-[var(--pf-text)]/70">Prueba con otros términos o limpia los filtros.</p></div>
      )}

      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Artículos publicados" aria-busy={loading}>
        {(loading ? [] : catalog?.items ?? []).map((item) => (
          <article className="pf-card flex flex-col gap-4 !p-0 overflow-hidden" key={item.id}>
            {item.photoUrl ? <Image src={item.photoUrl} alt={item.title} width={800} height={500} unoptimized className="h-48 w-full object-cover" /> : <div className="flex h-48 items-center justify-center bg-[var(--pf-bg)] text-sm text-[var(--pf-text)]/55">Fotografía no disponible</div>}
            <div className="flex flex-1 flex-col gap-3 p-5 pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--pf-text)]/70">{item.category}</span>
                <Badge variant={item.auction ? "accent" : "success"}>{item.auction ? "En subasta" : "Disponible / Aprobado"}</Badge>
              </div>
              <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
              <p className="text-sm text-[var(--pf-text)]/70">Conservación: {item.condition}</p>
              <p className="text-lg font-semibold">${item.initialPrice} <span className="text-sm font-normal text-[var(--pf-text)]/65">USD · precio inicial</span></p>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                {item.auction && <Link href={`/subastas/${item.auction.id}`} className="pf-btn">Ver subasta</Link>}
                <button type="button" className="pf-btn-secondary" onClick={() => setSelected(item)}>Ver detalle</button>
              </div>
            </div>
          </article>
        ))}
      </section>

      {catalog && <div className="mt-8"><Pagination page={page} pages={catalog.pages} onPageChange={setPage} /></div>}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <div className="mb-5 flex items-start justify-between gap-4"><div><Badge variant={selected.auction ? "accent" : "success"}>{selected.auction ? "En subasta" : "Disponible / Aprobado"}</Badge><h2 id="detail-title" className="mt-3 text-2xl font-bold">{selected.title}</h2></div><button type="button" className="pf-btn-secondary !px-3 !py-2" onClick={() => setSelected(null)} aria-label="Cerrar detalle">Cerrar</button></div>
            {selected.photoUrl && <Image src={selected.photoUrl} alt={selected.title} width={1200} height={800} unoptimized className="mb-5 max-h-80 w-full rounded-lg object-contain bg-[var(--pf-bg)]" />}
            <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="pf-label">Categoría</dt><dd>{selected.category}</dd></div><div><dt className="pf-label">Estado de conservación</dt><dd>{selected.condition}</dd></div><div><dt className="pf-label">Procedencia</dt><dd>{selected.provenance}</dd></div><div><dt className="pf-label">Precio inicial</dt><dd>${selected.initialPrice} USD</dd></div><div className="sm:col-span-2"><dt className="pf-label">Descripción</dt><dd className="whitespace-pre-wrap">{selected.description}</dd></div></dl>
          </section>
        </div>
      )}
    </main>
  );
}
