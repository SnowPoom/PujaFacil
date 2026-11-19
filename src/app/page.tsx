import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getPublicCatalog } from "@/modules/articles/public-catalog";
import CatalogClient from "./CatalogClient";
export default function CatalogPage() {
  return <Suspense fallback={<main className="pf-page"><p role="status">Cargando catálogo…</p></main>}><Catalog /></Suspense>;
}
async function Catalog() {
  await connection();
  let data;
  try { data = await getPublicCatalog(); }
  catch (error) {
    unstable_rethrow(error);
    return <main className="pf-page"><section className="pf-card space-y-4"><h1 className="pf-title">Catálogo de artículos</h1><p role="alert" className="pf-error">No se pudo consultar el catálogo. Comprueba que la base de datos esté disponible.</p><Link href="/" className="pf-btn-secondary">Reintentar</Link></section></main>;
  }
  return <CatalogClient initialCatalog={data} />;
}
