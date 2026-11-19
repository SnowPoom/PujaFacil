import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import { listAssignedReviews } from "@/modules/reviews/review-service";
import type { ReviewDecision } from "@prisma/client";

function statusBadgeVariant(status: ReviewDecision | null) {
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
      <Suspense fallback={<p role="status">Cargando bandeja de verificación…</p>}>
        <VerificacionBandejaContent />
      </Suspense>
    </main>
  );
}

async function VerificacionBandejaContent() {
  const user = await requireCurrentUser();

  if (user.status !== "ACTIVA" || !hasRole(user, "VERIFICADOR")) {
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Acceso restringido
          </h1>
          <p role="alert" className="pf-error">
            Solo los verificadores con cuenta activa pueden consultar la bandeja de revisión documental.
          </p>
          <Link href="/panel" className="pf-btn-secondary inline-block">
            Volver al panel
          </Link>
        </div>
      </Card>
    );
  }

  const assignedReviews = await listAssignedReviews(user.id);
  const pendingCount = assignedReviews.filter((r) => r.reviewStatus === null).length;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Bandeja de verificación
          </h1>
          <p className="text-sm mt-1">
            Expedientes asignados para validación documental y técnica antes de su publicación comercial.
          </p>
        </div>
        <Link href="/panel" className="pf-btn-secondary">
          Volver al panel
        </Link>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold">Expedientes asignados</h2>
          <div className="flex items-center gap-2">
            <Badge variant="accent">{pendingCount} pendientes</Badge>
            <Badge variant="neutral">{assignedReviews.length} total</Badge>
          </div>
        </div>

        {assignedReviews.length === 0 ? (
          <p className="text-sm opacity-80 py-4" role="status">
            No tienes expedientes de verificación asignados por el momento.
          </p>
        ) : (
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
                {assignedReviews.map((item) => {
                  const displayStatus = item.reviewStatus ?? "PENDIENTE_REVISION";
                  const isPending = item.reviewStatus === null;

                  return (
                    <tr key={item.id}>
                      <td className="font-mono text-xs">{item.id}</td>
                      <td>
                        <div className="font-semibold">{item.title}</div>
                        <div className="text-xs opacity-75">{item.condition}</div>
                      </td>
                      <td>{item.category}</td>
                      <td className="font-mono">${item.initialPrice}</td>
                      <td className="text-xs">
                        {item.photosCount} foto(s) ·{" "}
                        {item.hasCertificate ? "Con certificado" : "Sin certificado"}
                      </td>
                      <td>
                        <Badge variant={statusBadgeVariant(item.reviewStatus)}>
                          {displayStatus}
                        </Badge>
                      </td>
                      <td>
                        <Link href={`/verificacion/${item.id}`} className="pf-btn">
                          {isPending ? "Evaluar" : "Ver detalle"}
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
