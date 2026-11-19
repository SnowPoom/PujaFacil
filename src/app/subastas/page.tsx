import { connection } from "next/server";
import { Suspense } from "react";
import { unstable_rethrow } from "next/navigation";
import { listPublicAuctions } from "@/modules/auctions/auction-service";
import SubastasClient from "./SubastasClient";
export default function SubastasPage() {
 return <Suspense fallback={<main className="pf-page"><p role="status">Cargando subastas…</p></main>}><Catalog /></Suspense>;
}
async function Catalog() {
  await connection();
 let initialResult;
 try { initialResult = await listPublicAuctions({ pageSize: 9 }); }
 catch (error) { unstable_rethrow(error); return <main className="pf-page"><section className="pf-card"><h1 className="pf-title">Catálogo de subastas</h1><p role="alert" className="pf-error">No se pudieron consultar las subastas. Inténtalo de nuevo.</p></section></main>; }
 return <SubastasClient initialResult={initialResult} />;
}
