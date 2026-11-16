import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import AuctionBidPanel from "@/components/auctions/AuctionBidPanel";
import { getCurrentUser } from "@/lib/auth/server";
import {
  AuctionServiceError,
  getPublicAuction,
  type PublicAuctionDetail,
} from "@/modules/auctions/auction-service";

interface AuctionDetailPageProps {
  params: Promise<{ id: string }>;
}

function statusBadgeVariant(status: PublicAuctionDetail["status"]) {
  switch (status) {
    case "ACTIVA":
      return "success";
    case "PROGRAMADA":
    case "ADJUDICADA":
      return "accent";
    case "SUSPENDIDA":
    case "CANCELADA":
      return "error";
    default:
      return "neutral";
  }
}

function formatInformativeCountdown(
  auction: PublicAuctionDetail,
  serverNow: Date,
): string {
  const nowMs = serverNow.getTime();
  const opensMs = new Date(auction.opensAt).getTime();
  const closesMs = new Date(auction.closesAt).getTime();

  if (auction.status === "PROGRAMADA") {
    const diff = opensMs - nowMs;
    if (diff <= 0) {
      return "Horario de apertura alcanzado (pendiente de activación oficial)";
    }
    const totalMinutes = Math.floor(diff / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `Inicia en aprox. ${hours}h ${String(mins).padStart(2, "0")}m (informativo)`;
  }

  if (auction.status === "ACTIVA") {
    const diff = closesMs - nowMs;
    if (diff <= 0) {
      return "Horario de cierre alcanzado (en proceso de resolución oficial)";
    }
    const totalMinutes = Math.floor(diff / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `Restan aprox. ${hours}h ${String(mins).padStart(2, "0")}m para el cierre (informativo)`;
  }

  if (auction.status === "ADJUDICADA") {
    return "Subasta finalizada y adjudicada";
  }

  if (auction.status === "CERRADA_SIN_OFERTAS") {
    return "Subasta cerrada sin ofertas registradas";
  }

  if (auction.status === "SUSPENDIDA") {
    return "Subasta temporalmente suspendida por administración";
  }

  return `Estado comercial: ${auction.status}`;
}

export default function AuctionDetailPage({ params }: AuctionDetailPageProps) {
  return (
    <main className="pf-page space-y-6">
      <Suspense fallback={<p role="status">Cargando ficha de subasta…</p>}>
        <AuctionDetailContent params={params} />
      </Suspense>
    </main>
  );
}

async function AuctionDetailContent({ params }: AuctionDetailPageProps) {
  const { id } = await params;
  const user = await getCurrentUser().catch(() => null);
  const isActiveAccount = user?.status === "ACTIVA";

  let auctionView: PublicAuctionDetail;
  try {
    auctionView = await getPublicAuction(id);
  } catch (error) {
    const message =
      error instanceof AuctionServiceError
        ? error.message
        : "No se pudo consultar la subasta solicitada.";
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Subasta no disponible
          </h1>
          <p role="alert" className="pf-error">
            {message}
          </p>
          <Link href="/subastas" className="pf-btn-secondary inline-block">
            ← Volver al catálogo de subastas
          </Link>
        </div>
      </Card>
    );
  }

  const serverNow = new Date();
  const serverNowIso = serverNow.toISOString();
  const informativeCountdown = formatInformativeCountdown(auctionView, serverNow);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-xs font-mono opacity-75">Subasta #{auctionView.id}</span>
          <h1 className="text-2xl font-bold mt-1" style={{ color: "var(--pf-primary)" }}>
            {auctionView.article.title}
          </h1>
          <p className="text-sm mt-1">
            Categoría: <strong>{auctionView.article.category}</strong> · Horario oficial controlado por el servidor.
          </p>
        </div>
        <Link href="/subastas" className="pf-btn-secondary">
          ← Catálogo de subastas
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-semibold">Ficha técnica y condiciones comerciales</h2>
              <Badge variant={statusBadgeVariant(auctionView.status)}>
                {auctionView.status}
              </Badge>
            </div>

            {auctionView.article.photoFileIds.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {auctionView.article.photoFileIds.map((fileId, index) => (
                  <div
                    key={fileId}
                    className="overflow-hidden rounded-lg border bg-white h-56 flex items-center justify-center"
                    style={{ borderColor: "var(--pf-border)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${encodeURIComponent(fileId)}`}
                      alt={`Fotografía ${index + 1} de ${auctionView.article.title}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}

            <p className="text-sm leading-relaxed mb-4">{auctionView.article.description}</p>

            <dl
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t pt-4"
              style={{ borderColor: "var(--pf-border)" }}
            >
              <div>
                <dt className="font-semibold opacity-75">Precio inicial de salida (USD)</dt>
                <dd className="mt-1 font-mono font-bold text-base">
                  ${auctionView.startingPrice}
                </dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Incremento mínimo por oferta (USD)</dt>
                <dd className="mt-1 font-mono font-bold text-base">
                  +${auctionView.minIncrement}
                </dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Oferta máxima vigente (USD)</dt>
                <dd
                  className="mt-1 font-mono font-bold text-lg"
                  style={{ color: "var(--pf-primary)" }}
                >
                  {auctionView.highestBid ? `$${auctionView.highestBid}` : "Sin ofertas aún"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Número de ofertas aceptadas</dt>
                <dd className="mt-1 font-semibold">{auctionView.bidCount} pujas</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Apertura oficial (Servidor)</dt>
                <dd className="mt-1 font-mono text-xs">{auctionView.opensAt}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Cierre oficial (Servidor)</dt>
                <dd className="mt-1 font-mono text-xs">{auctionView.closesAt}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Fecha/hora actual del servidor</dt>
                <dd className="mt-1 font-mono text-xs">{serverNowIso}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Cuenta regresiva informativa</dt>
                <dd className="mt-1 text-xs font-medium">{informativeCountdown}</dd>
              </div>
            </dl>

            <div
              className="mt-4 pt-4 border-t text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              style={{ borderColor: "var(--pf-border)" }}
            >
              <div>
                <span className="font-semibold">Resultado de adjudicación: </span>
                {auctionView.status === "ADJUDICADA" && auctionView.winnerAlias ? (
                  <span className="font-mono font-semibold" style={{ color: "var(--pf-success)" }}>
                    Ganador {auctionView.winnerAlias}
                  </span>
                ) : auctionView.status === "CERRADA_SIN_OFERTAS" ? (
                  <span>Cerrada sin ofertas registradas</span>
                ) : (
                  <span>Subasta en curso — pendiente de cierre oficial</span>
                )}
              </div>
              <Badge variant="neutral">Seudónimo protegido</Badge>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Sala de chat de la subasta</h2>
                <p className="text-xs mt-1 opacity-80">
                  Canal moderado para consultas sobre el lote entre participantes activos.
                </p>
              </div>
              {isActiveAccount ? (
                <Link href={`/chat?room=auction:${id}`} className="pf-btn">
                  Abrir chat de la subasta
                </Link>
              ) : (
                <Link href="/iniciar-sesion" className="pf-btn-secondary">
                  Inicia sesión con cuenta activa para chatear
                </Link>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="text-lg font-semibold mb-3">Panel de Ofertas en Vivo</h2>
            <AuctionBidPanel auctionId={id} />
          </Card>
        </div>
      </div>
    </>
  );
}
