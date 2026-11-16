import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import {
  getAssignedReviewById,
  ReviewServiceError,
  type AssignedReviewDetail,
} from "@/modules/reviews/review-service";
import type { ReviewDecision } from "@prisma/client";
import ReviewDecisionForm from "./ReviewDecisionForm";

interface VerificationDetailPageProps {
  params: Promise<{ id: string }>;
}

function decisionBadgeVariant(status: ReviewDecision | null) {
  switch (status) {
    case "APROBADO":
      return "success";
    case "RECHAZADO":
      return "error";
    case "REQUIERE_CORRECCIONES":
      return "accent";
    default:
      return "accent";
  }
}

export default function VerificationDetailPage({
  params,
}: VerificationDetailPageProps) {
  return (
    <main className="pf-page space-y-6">
      <Suspense fallback={<p role="status">Cargando expediente de verificación…</p>}>
        <VerificationDetailContent params={params} />
      </Suspense>
    </main>
  );
}

async function VerificationDetailContent({
  params,
}: VerificationDetailPageProps) {
  const user = await requireCurrentUser();

  if (user.status !== "ACTIVA" || !hasRole(user, "VERIFICADOR")) {
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Acceso restringido
          </h1>
          <p role="alert" className="pf-error">
            Solo un verificador con cuenta activa puede evaluar expedientes de revisión.
          </p>
          <Link href="/panel" className="pf-btn-secondary inline-block">
            Volver a mi panel
          </Link>
        </div>
      </Card>
    );
  }

  const { id } = await params;

  let review: AssignedReviewDetail;
  try {
    review = await getAssignedReviewById(user.id, id);
  } catch (error) {
    const isServiceErr = error instanceof ReviewServiceError;
    const title =
      isServiceErr && error.status === 404
        ? "Expediente no encontrado"
        : "Acceso no autorizado al expediente";
    const message = isServiceErr
      ? error.message
      : "No fue posible cargar el expediente de verificación solicitado.";

    return (
      <Card>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            {title}
          </h1>
          <p role="alert" className="pf-error">
            {message}
          </p>
          <Link href="/verificacion" className="pf-btn-secondary inline-block">
            ← Volver a la bandeja
          </Link>
        </div>
      </Card>
    );
  }

  const displayStatus = review.reviewStatus ?? "PENDIENTE_REVISION";
  const isPending = review.reviewStatus === null && review.articleStatus === "PENDIENTE_REVISION";

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Evaluación de Expediente #{review.id}
          </h1>
          <p className="text-sm mt-1">
            Revisión documental reservada. Por políticas de privacidad, la identidad del vendedor titular se mantiene protegida.
          </p>
        </div>
        <Link href="/verificacion" className="pf-btn-secondary">
          ← Volver a la bandeja
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <span className="text-xs font-mono opacity-75">
                  Artículo #{review.articleId}
                </span>
                <h2 className="text-xl font-bold mt-1">{review.title}</h2>
              </div>
              <Badge variant={decisionBadgeVariant(review.reviewStatus)}>
                {displayStatus}
              </Badge>
            </div>

            <dl
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t pt-4"
              style={{ borderColor: "var(--pf-border)" }}
            >
              <div>
                <dt className="font-semibold opacity-75">Categoría</dt>
                <dd className="mt-1">{review.category}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Precio inicial propuesto (USD)</dt>
                <dd className="mt-1 font-mono font-bold">${review.initialPrice}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Estado de conservación</dt>
                <dd className="mt-1">{review.condition}</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Procedencia declarada</dt>
                <dd className="mt-1">{review.provenance}</dd>
              </div>
            </dl>

            <div className="mt-4 pt-4 border-t text-sm" style={{ borderColor: "var(--pf-border)" }}>
              <h3 className="font-semibold mb-1">Descripción técnica del artículo</h3>
              <p className="leading-relaxed whitespace-pre-line">{review.description}</p>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold mb-3">
              Evidencia fotográfica y certificados adjuntos
            </h2>
            <p className="text-xs mb-4 opacity-80">
              Documentación y fotografías cargadas en el expediente para validación técnica mediante acceso protegido.
            </p>

            {review.files.length === 0 ? (
              <p className="text-sm opacity-75" role="status">
                Este artículo no tiene archivos adjuntos registrados.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {review.files.map((file, idx) => {
                  const isPhoto = file.kind === "FOTO";
                  const fileUrl = `/api/files/${encodeURIComponent(file.id)}`;
                  const sizeKb = Math.max(1, Math.round(file.size / 1024));

                  return (
                    <div
                      key={file.id}
                      className="p-4 border rounded-lg flex flex-col justify-between gap-3 text-xs"
                      style={{ borderColor: "var(--pf-border)" }}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-semibold">
                            {isPhoto
                              ? `Fotografía #${idx + 1}`
                              : "Certificado documental"}
                          </span>
                          <Badge variant={isPhoto ? "neutral" : "accent"}>
                            {file.kind}
                          </Badge>
                        </div>

                        {isPhoto && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={fileUrl}
                            alt={`Evidencia fotográfica ${idx + 1} de ${review.title}`}
                            className="w-full h-40 object-cover rounded border mb-2"
                            style={{ borderColor: "var(--pf-border)" }}
                          />
                        )}

                        <p className="font-mono opacity-75">
                          {file.mimeType} · {sizeKb} KB
                        </p>
                      </div>

                      <div>
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pf-btn-secondary inline-block text-center w-full"
                        >
                          {isPhoto ? "Abrir fotografía" : "Abrir certificado PDF"}
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div>
          <Card>
            <h2 className="text-lg font-semibold mb-2">Resolución del Verificador</h2>
            {isPending ? (
              <>
                <p className="text-xs mb-4 opacity-80">
                  La aprobación habilita el artículo para que la administración programe su subasta.
                </p>
                <ReviewDecisionForm reviewId={review.id} />
              </>
            ) : (
              <div className="space-y-3 text-sm" role="status">
                <p className="text-xs opacity-80">
                  Este expediente ya fue evaluado y cerrado. No admite una nueva resolución.
                </p>
                <div>
                  <span className="font-semibold block text-xs opacity-75">
                    Dictamen emitido
                  </span>
                  <div className="mt-1">
                    <Badge variant={decisionBadgeVariant(review.reviewStatus)}>
                      {displayStatus}
                    </Badge>
                  </div>
                </div>
                {review.decidedAt && (
                  <div>
                    <span className="font-semibold block text-xs opacity-75">
                      Fecha de resolución
                    </span>
                    <span className="font-mono text-xs">
                      {new Date(review.decidedAt).toLocaleString("es-EC")}
                    </span>
                  </div>
                )}
                {review.comments && (
                  <div>
                    <span className="font-semibold block text-xs opacity-75">
                      Observaciones registradas
                    </span>
                    <p className="mt-1 p-3 rounded border bg-black/5 whitespace-pre-line">
                      {review.comments}
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
