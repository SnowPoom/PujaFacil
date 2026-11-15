import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

interface SellerAuctionItem {
  auctionId: string;
  articleId: string;
  articleTitle: string;
  category: string;
  startingPrice: string;
  highestBid: string | null;
  bidCount: number;
  status: "PROGRAMADA" | "ACTIVA" | "ADJUDICADA" | "CERRADA_SIN_OFERTAS" | "SUSPENDIDA";
  opensAt: string;
  closesAt: string;
  winnerAlias?: string;
}

const SELLER_AUCTIONS_MOCK: SellerAuctionItem[] = [
  {
    auctionId: "sub-demo-002",
    articleId: "art-aprob-011",
    articleTitle: "Mapa Cartográfico Antiguo de Quito (1748)",
    category: "Cartografía e Historia",
    startingPrice: "900.00",
    highestBid: "1125.00",
    bidCount: 6,
    status: "ACTIVA",
    opensAt: "2026-11-14T18:00:00Z",
    closesAt: "2026-11-17T18:00:00Z",
  },
  {
    auctionId: "sub-demo-001",
    articleId: "art-aprob-010",
    articleTitle: "Escultura de Bronce Fundido Siglo XIX",
    category: "Escultura",
    startingPrice: "1500.00",
    highestBid: null,
    bidCount: 0,
    status: "PROGRAMADA",
    opensAt: "2026-11-15T14:00:00Z",
    closesAt: "2026-11-16T20:00:00Z",
  },
  {
    auctionId: "sub-demo-000",
    articleId: "art-aprob-009",
    articleTitle: "Juego de Té de Plata Martillada s. XX",
    category: "Platería",
    startingPrice: "450.00",
    highestBid: "620.00",
    bidCount: 5,
    status: "ADJUDICADA",
    opensAt: "2026-11-10T12:00:00Z",
    closesAt: "2026-11-12T18:00:00Z",
    winnerAlias: "Postor-A84F",
  },
];

function statusVariant(status: SellerAuctionItem["status"]) {
  switch (status) {
    case "ACTIVA":
      return "success";
    case "ADJUDICADA":
    case "PROGRAMADA":
      return "accent";
    case "SUSPENDIDA":
      return "error";
    default:
      return "neutral";
  }
}

export default function MisSubastasPage() {
  return (
    <main className="pf-page space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Mis Subastas
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
        <div className="overflow-x-auto">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Subasta</th>
                <th>Lote / Artículo</th>
                <th>Precio salida</th>
                <th>Oferta máxima</th>
                <th>Pujas</th>
                <th>Estado comercial</th>
                <th>Resultado / Seudónimo</th>
                <th>Ficha</th>
              </tr>
            </thead>
            <tbody>
              {SELLER_AUCTIONS_MOCK.map((item) => (
                <tr key={item.auctionId}>
                  <td className="font-mono text-xs">{item.auctionId}</td>
                  <td>
                    <div className="font-semibold">{item.articleTitle}</div>
                    <div className="text-xs opacity-75">{item.category}</div>
                  </td>
                  <td className="font-mono">${item.startingPrice}</td>
                  <td className="font-mono font-semibold">
                    {item.highestBid ? `$${item.highestBid}` : "Sin ofertas"}
                  </td>
                  <td>{item.bidCount}</td>
                  <td>
                    <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                  </td>
                  <td className="text-xs font-mono">
                    {item.winnerAlias ? `Ganador: ${item.winnerAlias}` : "En curso / Pendiente"}
                  </td>
                  <td>
                    <Link href={`/subastas/${item.auctionId}`} className="pf-btn-secondary">
                      Ver subasta
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
