import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ReviewDecisionForm from "./ReviewDecisionForm";

interface VerificationDetailPageProps {
  params: Promise<{ id: string }>;
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
  const { id } = await params;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Evaluación de Expediente #{id}
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
                <span className="text-xs font-mono opacity-75">Lote en evaluación</span>
                <h2 className="text-xl font-bold mt-1">
                  Reloj Cronógrafo Suizo Automático c. 1968
                </h2>
              </div>
              <Badge variant="accent">PENDIENTE_REVISION</Badge>
            </div>

            <dl
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t pt-4"
              style={{ borderColor: "var(--pf-border)" }}
            >
              <div>
                <dt className="font-semibold opacity-75">Categoría</dt>
                <dd className="mt-1">Relojería de colección</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Precio inicial propuesto (USD)</dt>
                <dd className="mt-1 font-mono font-bold">$1250.00</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Estado de conservación</dt>
                <dd className="mt-1">Excelente estado de conservación, maquinaria revisada</dd>
              </div>
              <div>
                <dt className="font-semibold opacity-75">Procedencia declarada</dt>
                <dd className="mt-1">Colección privada adquirida en Ginebra (1998)</dd>
              </div>
            </dl>

            <div className="mt-4 pt-4 border-t text-sm" style={{ borderColor: "var(--pf-border)" }}>
              <h3 className="font-semibold mb-1">Descripción técnica del artículo</h3>
              <p className="leading-relaxed">
                Cronógrafo mecánico de carga automática con caja de acero inoxidable de 38 mm,
                cristal acrílico abombado original y esfera plateada con tres subesferas. Incluye
                estuche de época y certificado documental del taller relojero.
              </p>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold mb-3">
              Evidencia fotográfica y certificados adjuntos
            </h2>
            <p className="text-xs mb-4 opacity-80">
              Documentación y fotografías cargadas en el expediente para validación técnica.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div
                className="p-4 border rounded-lg text-center text-xs"
                style={{ borderColor: "var(--pf-border)" }}
              >
                <div className="font-semibold mb-1">Fotografía frontal</div>
                <span className="font-mono opacity-75">FOTO · JPEG</span>
              </div>
              <div
                className="p-4 border rounded-lg text-center text-xs"
                style={{ borderColor: "var(--pf-border)" }}
              >
                <div className="font-semibold mb-1">Calibre y reverso</div>
                <span className="font-mono opacity-75">FOTO · JPEG</span>
              </div>
              <div
                className="p-4 border rounded-lg text-center text-xs"
                style={{ borderColor: "var(--pf-border)" }}
              >
                <div className="font-semibold mb-1">Certificado documental</div>
                <span className="font-mono opacity-75">CERTIFICADO · PDF</span>
              </div>
            </div>
          </Card>
        </div>

        <div>
          <Card>
            <h2 className="text-lg font-semibold mb-2">Resolución del Verificador</h2>
            <p className="text-xs mb-4 opacity-80">
              La aprobación habilita el artículo para que la administración programe su subasta.
            </p>
            <ReviewDecisionForm reviewId={id} />
          </Card>
        </div>
      </div>
    </>
  );
}
