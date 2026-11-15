import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

interface VerificationQueueItem {
  id: string;
  articleId: string;
  title: string;
  category: string;
  condition: string;
  initialPrice: string;
  assignedAt: string;
  status: "PENDIENTE_REVISION" | "APROBADO" | "RECHAZADO" | "REQUIERE_CORRECCIONES";
  hasCertificate: boolean;
  photosCount: number;
}

const MOCK_ASSIGNED_REVIEWS: VerificationQueueItem[] = [
  {
    id: "rev-demo-001",
    articleId: "art-demo-001",
    title: "Reloj Cronógrafo Suizo Automático c. 1968",
    category: "Relojería",
    condition: "Excelente estado de conservación",
    initialPrice: "1250.00",
    assignedAt: "2026-11-14T10:30:00Z",
    status: "PENDIENTE_REVISION",
    hasCertificate: true,
    photosCount: 3,
  },
  {
    id: "rev-demo-002",
    articleId: "art-demo-002",
    title: "Óleo sobre lienzo 'Paisaje Andino' Siglo XX",
    category: "Arte y Pintura",
    condition: "Restauración menor documentada",
    initialPrice: "850.00",
    assignedAt: "2026-11-14T11:15:00Z",
    status: "PENDIENTE_REVISION",
    hasCertificate: true,
    photosCount: 4,
  },
  {
    id: "rev-demo-003",
    articleId: "art-demo-003",
    title: "Moneda Conmemorativa de Plata 1884",
    category: "Numismática",
    condition: "Sin circular (UNC)",
    initialPrice: "320.00",
    assignedAt: "2026-11-13T16:00:00Z",
    status: "APROBADO",
    hasCertificate: true,
    photosCount: 2,
  },
];

function statusBadgeVariant(status: VerificationQueueItem["status"]) {
  switch (status) {
    case "APROBADO":
      return "success";
    case "RECHAZADO":
      return "error";
    case "REQUIERE_CORRECCIONES":
      return "accent";
    default:
      return "neutral";
  }
}

export default function VerificacionBandejaPage() {
  return (
    <main className="pf-page space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Bandeja del Verificador
          </h1>
          <p className="text-sm mt-1">
            Expedientes asignados para validación documental y técnica antes de su publicación comercial.
          </p>
        </div>
        <Link href="/panel" className="pf-btn-secondary">
          Volver a mi panel
        </Link>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Expedientes asignados</h2>
          <Badge variant="accent">
            {MOCK_ASSIGNED_REVIEWS.filter((r) => r.status === "PENDIENTE_REVISION").length} pendientes
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Expediente</th>
                <th>Artículo</th>
                <th>Categoría</th>
                <th>Precio base (USD)</th>
                <th>Adjuntos</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_ASSIGNED_REVIEWS.map((item) => (
                <tr key={item.id}>
                  <td className="font-mono text-xs">{item.id}</td>
                  <td>
                    <div className="font-semibold">{item.title}</div>
                    <div className="text-xs opacity-75">{item.condition}</div>
                  </td>
                  <td>{item.category}</td>
                  <td className="font-mono">${item.initialPrice}</td>
                  <td className="text-xs">
                    {item.photosCount} fotos · {item.hasCertificate ? "Con certificado" : "Sin certificado"}
                  </td>
                  <td>
                    <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                  </td>
                  <td>
                    <Link href={`/verificacion/${item.id}`} className="pf-btn">
                      {item.status === "PENDIENTE_REVISION" ? "Evaluar" : "Ver detalle"}
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
