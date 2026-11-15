import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import AuctionBidPanel from "@/components/auctions/AuctionBidPanel";
import { getCurrentUser } from "@/lib/auth/server";

interface AuctionDetailPageProps {
  params: Promise<{ id: string }>;
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

  const auctionView = {
    id,
    article: {
      id: "art-aprob-011",
      title: "Mapa Cartográfico Antiguo de Quito (1748)",
      category: "Cartografía e Historia",
      description:
        "Grabado original calcográfico sobre papel verjurado de mediados del siglo XVIII, enmarcado con cristal de protección UV y respaldado por expediente documental verificado.",
      photoFileIds: ["file-demo-1", "file-demo-2"],
    },
    status: "ACTIVA" as const,
    startingPrice: "900.00",
    minIncrement: "25.00",
    opensAt: "2026-11-14T18:00:00Z",
    closesAt: "2026-11-17T18:00:00Z",
    highestBid: "1125.00",
    bidCount: 6,
    winnerAlias: undefined as string | undefined,
  };

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
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-semibold">Ficha técnica y condiciones comerciales</h2>
              <Badge variant="success">{auctionView.status}</Badge>
            </div>

            <p className="text-sm leading-relaxed mb-4">{auctionView.article.description}</p>

            <dl
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t pt-4"
              style={{ borderColor: "var(--pf-border)" }}
            >
              <div>
                <dt className="font-semibold opacity-75">Precio inicial de salida (USD)</dt>
                <dd className="mt-1 font-mono font-bold text-base">${auctionView.startingPrice}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Incremento mínimo por oferta (USD)</dt>
                <dd className="mt-1 font-mono font-bold text-base">+${auctionView.minIncrement}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Oferta máxima vigente (USD)</dt>
                <dd className="mt-1 font-mono font-bold text-lg" style={{ color: "var(--pf-primary)" }}>
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
            </dl>

            <div
              className="mt-4 pt-4 border-t text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              style={{ borderColor: "var(--pf-border)" }}
            >
              <div>
                <span className="font-semibold">Resultado de adjudicación: </span>
                {auctionView.winnerAlias ? (
                  <span className="font-mono">Ganador {auctionView.winnerAlias}</span>
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
