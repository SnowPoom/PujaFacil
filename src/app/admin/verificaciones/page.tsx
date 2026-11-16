import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import { listPendingArticlesForAdmin } from "@/modules/reviews/review-service";
import AdminVerificacionesClient from "./AdminVerificacionesClient";

export default function AdminVerificacionesPage() {
  return (
    <main className="pf-page space-y-6">
      <Suspense fallback={<p role="status">Cargando cola de verificaciones…</p>}>
        <AdminVerificacionesContent />
      </Suspense>
    </main>
  );
}

async function AdminVerificacionesContent() {
  const actor = await requireCurrentUser();

  if (actor.status !== "ACTIVA" || !hasRole(actor, "ADMIN_SUBASTAS")) {
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Acceso restringido
          </h1>
          <p role="alert" className="pf-error">
            Solo un administrador de subastas con cuenta activa puede asignar verificadores.
          </p>
          <Link href="/panel" className="pf-btn-secondary inline-block">
            Volver a mi panel
          </Link>
        </div>
      </Card>
    );
  }

  const { articles, verifiers } = await listPendingArticlesForAdmin();

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Asignación de Verificaciones
          </h1>
          <p className="text-sm mt-1">
            Asigna los artículos recibidos a verificadores activos para su revisión documental.
          </p>
        </div>
        <Link href="/admin" className="pf-btn-secondary">
          ← Volver a Administración
        </Link>
      </div>

      <AdminVerificacionesClient initialArticles={articles} verifiers={verifiers} />
    </>
  );
}
