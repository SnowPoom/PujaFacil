import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import {
  listAdminAuctions,
  listApprovedArticlesForScheduling,
} from "@/modules/auctions/auction-service";
import AdminSubastasClient from "./AdminSubastasClient";

export default function AdminSubastasPage() {
  return (
    <main className="pf-page space-y-6">
      <Suspense fallback={<p role="status">Cargando programación y supervisión de subastas…</p>}>
        <AdminSubastasContent />
      </Suspense>
    </main>
  );
}

async function AdminSubastasContent() {
  const actor = await requireCurrentUser();

  if (actor.status !== "ACTIVA" || !hasRole(actor, "ADMIN_SUBASTAS")) {
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Acceso restringido
          </h1>
          <p role="alert" className="pf-error">
            Solo un administrador de subastas con cuenta activa puede programar o supervisar subastas.
          </p>
          <Link href="/panel" className="pf-btn-secondary inline-block">
            Volver al panel
          </Link>
        </div>
      </Card>
    );
  }

  const [auctions, approvedArticles] = await Promise.all([
    listAdminAuctions(),
    listApprovedArticlesForScheduling(),
  ]);

  const serverNowIso = new Date().toISOString();

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Programación y supervisión de subastas
          </h1>
          <p className="text-sm mt-1">
            Configuración comercial de artículos aprobados y control del estado de las subastas.
          </p>
        </div>
        <Link href="/admin" className="pf-btn-secondary">
          ← Volver a Administración
        </Link>
      </div>

      <AdminSubastasClient
        initialAuctions={auctions}
        initialApprovedArticles={approvedArticles}
        serverNowIso={serverNowIso}
      />
    </>
  );
}
