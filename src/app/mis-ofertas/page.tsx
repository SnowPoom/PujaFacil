import { Suspense } from "react";
import Link from "next/link";
import type { AuctionStatus } from "@prisma/client";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { hasRole } from "@/lib/auth/guards";
import { requireCurrentUser } from "@/lib/auth/server";
import { getUserBids, type UserBidItem } from "@/modules/bids/bid-service";

function statusBadgeVariant(status: AuctionStatus): "neutral" | "success" | "error" | "accent" {
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

function positionLabel(item: UserBidItem): { label: string; variant: "neutral" | "success" | "error" | "accent" } {
  if (item.auctionStatus === "ADJUDICADA") {
    return item.isLeadingOrWinner
      ? { label: "Oferta ganadora", variant: "success" }
      : { label: "No adjudicada", variant: "neutral" };
  }
  if (item.auctionStatus === "ACTIVA") {
    return item.isLeadingOrWinner
      ? { label: "Liderando subasta", variant: "success" }
      : { label: "Superada", variant: "accent" };
  }
  return { label: item.auctionStatus, variant: "neutral" };
}

export default function MisOfertasPage() {
  return (
    <main className="pf-page space-y-6 w-full">
      <Suspense fallback={<p role="status">Cargando tus ofertas…</p>}>
        <MisOfertasContent />
      </Suspense>
    </main>
  );
}

async function MisOfertasContent() {
  const user = await requireCurrentUser();

  if (user.status !== "ACTIVA" || !hasRole(user, "COMPRADOR")) {
    return (
      <Card className="space-y-4">
        <h1 className="text-2xl font-bold">Mis ofertas</h1>
        <p role="alert" className="pf-error">
          Debes contar con una cuenta activa y perfil de comprador para consultar y registrar ofertas.
        </p>
        <div>
          <Link href="/panel" className="pf-btn-secondary">
            Volver a mi panel
          </Link>
        </div>
      </Card>
    );
  }

  const items = await getUserBids(user.id);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Mis ofertas
          </h1>
          <p className="text-sm mt-1">
            Historial de tus pujas registradas ordenado por fecha. Las identidades de otros postores se mantienen protegidas.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/subastas" className="pf-btn">
            Ver catálogo de subastas
          </Link>
          <Link href="/panel" className="pf-btn-secondary">
            Volver al panel
          </Link>
        </div>
      </div>

      <Card>
        {items.length === 0 ? (
          <div className="space-y-4 py-4">
            <p className="text-sm">Aún no has registrado ofertas en ninguna subasta.</p>
            <div>
              <Link href="/subastas" className="pf-btn">
                Explorar subastas activas
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Código de subasta</th>
                  <th>Artículo / Lote</th>
                  <th>Tu seudónimo</th>
                  <th>Monto ofertado (USD)</th>
                  <th>Fecha y hora (Servidor)</th>
                  <th>Estado de subasta</th>
                  <th>Posición de tu oferta</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const pos = positionLabel(item);
                  const dateFormatted = new Date(item.acceptedAt).toLocaleString("es-EC", {
                    dateStyle: "short",
                    timeStyle: "medium",
                  });
                  return (
                    <tr key={item.id}>
                      <td className="font-mono text-xs">{item.auctionId}</td>
                      <td className="font-semibold">{item.auctionTitle}</td>
                      <td className="font-mono text-xs">{item.alias}</td>
                      <td className="font-mono font-bold">${item.amount}</td>
                      <td className="text-xs">
                        <time dateTime={item.acceptedAt}>{dateFormatted}</time>
                      </td>
                      <td>
                        <Badge variant={statusBadgeVariant(item.auctionStatus)}>{item.auctionStatus}</Badge>
                      </td>
                      <td>
                        <Badge variant={pos.variant}>{pos.label}</Badge>
                      </td>
                      <td>
                        <Link href={`/subastas/${item.auctionId}`} className="pf-btn-secondary">
                          Ver ficha
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
