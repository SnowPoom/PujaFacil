import { bidRestriction } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/presentation";
import { AuctionCountdown } from "@/components/auctions/AuctionLiveRefresh";
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
  let user: Awaited<ReturnType<typeof getCurrentUser>>;

  let auctionView: PublicAuctionDetail;
  try {
    [user, auctionView] = await Promise.all([getCurrentUser().catch(() => null), getPublicAuction(id)]);
  } catch (error) {
    const message =
      error instanceof AuctionServiceError
        ? error.message
        : "No se pudo consultar la subasta solicitada.";
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
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

  const isActiveAccount = user?.status === "ACTIVA";
  const ownArticle = user?.roles.includes("COMPRADOR")
    ? await prisma.article.findFirst({ where: { id: auctionView.article.id, ownerId: user.id }, select: { ownerId: true } }) : null;
  const restriction = bidRestriction(user, ownArticle?.ownerId);
  const serverNow = new Date();
  const serverNowIso = serverNow.toISOString();

  return (
    <>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-xs font-mono opacity-75">Subasta #{auctionView.id}</span>
          <h1 className="pf-title mt-1" style={{ color: "var(--pf-primary)" }}>
            {auctionView.article.title}
          </h1>
          <p className="text-sm mt-1">
            Categoría: <strong>{auctionView.article.category}</strong> · Horarios de Ecuador continental (UTC−5).
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
                      className="w-full h-full object-contain"
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
                <dt className="font-semibold opacity-75">Apertura</dt>
                <dd className="mt-1 font-mono text-xs">{formatDate(auctionView.opensAt)}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Cierre</dt>
                <dd className="mt-1 font-mono text-xs">{formatDate(auctionView.closesAt)}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Fecha y hora de referencia</dt>
                <dd className="mt-1 font-mono text-xs">{formatDate(serverNowIso)}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Cuenta regresiva informativa</dt>
                <dd className="mt-1 text-xs font-medium"><AuctionCountdown opensAt={auctionView.opensAt} closesAt={auctionView.closesAt} status={auctionView.status} /></dd>
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
                  <span>{auctionView.status === "PROGRAMADA" ? "La subasta abrirá en el horario indicado" : auctionView.status === "SUSPENDIDA" ? "Subasta suspendida por administración" : auctionView.status === "CANCELADA" ? "Subasta cancelada" : "Subasta en curso"}</span>
                )}
              </div>

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
                  Inicia sesión para chatear
                </Link>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="text-lg font-semibold mb-3">Ofertas en vivo</h2>
            <AuctionBidPanel auctionId={id} restriction={restriction} realtimeEnabled={isActiveAccount} />
          </Card>
        </div>
      </div>
    </>
  );
}
