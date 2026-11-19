import { formatDate } from "@/lib/presentation";
import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import {
  listSellerAuctions,
  type SellerAuctionItem,
} from "@/modules/auctions/auction-service";

function statusVariant(status: SellerAuctionItem["status"]) {
  switch (status) {
    case "ACTIVA":
      return "success";
    case "ADJUDICADA":
    case "PROGRAMADA":
      return "accent";
    case "SUSPENDIDA":
    case "CANCELADA":
      return "error";
    default:
      return "neutral";
  }
}

export default function MisSubastasPage() {
  return (
    <main className="pf-page space-y-6">
      <Suspense fallback={<p role="status">Cargando tus subastas…</p>}>
        <MisSubastasContent />
      </Suspense>
    </main>
  );
}

async function MisSubastasContent() {
  const actor = await requireCurrentUser();

  if (actor.status !== "ACTIVA" || !hasRole(actor, "VENDEDOR")) {
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Acceso restringido
          </h1>
          <p role="alert" className="pf-error">
            Necesitas una cuenta activa con rol VENDEDOR para consultar el seguimiento comercial de tus subastas.
          </p>
          <Link href="/panel" className="pf-btn-secondary inline-block">
            Volver al panel
          </Link>
        </div>
      </Card>
    );
  }

  const items = await listSellerAuctions(actor.id);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Mis subastas
          </h1>
          <p className="text-sm mt-1">
            Seguimiento comercial de las subastas asociadas a tus artículos aprobados. Los postores se muestran mediante seudónimo reservado.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/mis-articulos" className="pf-btn-secondary">
            Mis artículos
          </Link>
          <Link href="/subastas" className="pf-btn">
            Catálogo de subastas
          </Link>
        </div>
      </div>

      <Card>
        {items.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p role="status">
              Aún no tienes artículos asociados a subastas programadas o activas.
            </p>
            <Link href="/mis-articulos" className="pf-btn-secondary inline-block">
              Ir a mis artículos
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Subasta</th>
                  <th>Artículo</th>
                  <th>Precio Salida</th>
                  <th>Oferta Máxima</th>
                  <th>Ofertas</th>
                  <th>Estado</th>
                  <th>Cierre (Ecuador)</th>
                  <th>Adjudicación</th>
                  <th>Ficha</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.auctionId}>
                    <td className="font-mono text-xs">{item.auctionId}</td>
                    <td>
                      <div className="font-semibold">{item.articleTitle}</div>
                      <div className="text-xs opacity-75">{item.category}</div>
                    </td>
                    <td className="font-mono">${item.startingPrice}</td>
                    <td className="font-mono font-bold">
                      {item.highestBid ? `$${item.highestBid}` : "Sin ofertas"}
                    </td>
                    <td>{item.bidCount}</td>
                    <td>
                      <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                    </td>
                    <td className="font-mono text-xs">{formatDate(item.closesAt)}</td>
                    <td className="text-xs">
                      {item.status === "ADJUDICADA" && item.winnerAlias ? (
                        <span className="font-mono">Ganador: {item.winnerAlias}</span>
                      ) : item.status === "CERRADA_SIN_OFERTAS" ? (
                        <span className="opacity-70">Sin ofertas</span>
                      ) : (
                        <span className="opacity-70">{item.status === "PROGRAMADA" ? "Próxima apertura" : item.status === "SUSPENDIDA" ? "Suspendida" : item.status === "CANCELADA" ? "Cancelada" : "En curso"}</span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/subastas/${item.auctionId}`}
                        className="pf-btn-secondary text-xs"
                      >
                        Ver subasta
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
