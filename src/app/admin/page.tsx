import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import { getAdminDashboardSummary } from "@/modules/auctions/auction-service";

export default function AdminDashboardPage() {
  return (
    <main className="pf-page space-y-6">
      <Suspense fallback={<p role="status">Cargando resumen administrativo…</p>}>
        <AdminDashboardContent />
      </Suspense>
    </main>
  );
}

async function AdminDashboardContent() {
  const actor = await requireCurrentUser();

  if (actor.status !== "ACTIVA" || !hasRole(actor, "ADMIN_SUBASTAS")) {
    return (
      <Card>
        <div className="space-y-4">
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Acceso restringido
          </h1>
          <p role="alert" className="pf-error">
            Solo un administrador de subastas con cuenta activa puede consultar el resumen de administración.
          </p>
          <Link href="/panel" className="pf-btn-secondary inline-block">
            Volver al panel
          </Link>
        </div>
      </Card>
    );
  }

  const summary = await getAdminDashboardSummary();

  const metrics = [
    {
      label: "Artículos pendientes de verificación",
      value: summary.pendingArticlesCount,
      badge: "PENDIENTE_REVISION",
      variant: "accent" as const,
      href: "/admin/verificaciones",
      cta: "Asignar verificadores",
    },
    {
      label: "Subastas programadas",
      value: summary.scheduledAuctionsCount,
      badge: "PROGRAMADA",
      variant: "neutral" as const,
      href: "/admin/subastas",
      cta: "Gestionar programación",
    },
    {
      label: "Subastas activas en vivo",
      value: summary.activeAuctionsCount,
      badge: "ACTIVA",
      variant: "success" as const,
      href: "/admin/subastas",
      cta: "Supervisar subastas",
    },
    {
      label: "Ofertas válidas registradas",
      value: summary.validBidsCount,
      badge: "TIEMPO REAL",
      variant: "neutral" as const,
      href: "/subastas",
      cta: "Ver catálogo público",
    },
  ];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pf-title " style={{ color: "var(--pf-primary)" }}>
            Administración de subastas
          </h1>

        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/verificaciones" className="pf-btn">
            Verificaciones
          </Link>
          <Link href="/admin/subastas" className="pf-btn">
            Subastas
          </Link>
          <Link href="/admin/usuarios" className="pf-btn-secondary">
            Usuarios
          </Link>
        </div>
      </div>

      <section
        aria-label="Indicadores operativos"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {metrics.map((metric) => (
          <Card key={metric.label} className="flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <Badge variant={metric.variant}>{metric.badge}</Badge>
              </div>
              <p className="text-3xl font-bold" style={{ color: "var(--pf-primary)" }}>
                {metric.value}
              </p>
              <p className="text-sm mt-1 font-medium">{metric.label}</p>
            </div>
            <Link href={metric.href} className="pf-btn-secondary text-center">
              {metric.cta}
            </Link>
          </Card>
        ))}
      </section>

      <Card>
        <h2 className="text-lg font-semibold mb-2">Flujo comercial controlado</h2>
        <p className="text-sm leading-relaxed mb-4">
          Desde este panel puedes asignar los expedientes pendientes a verificadores especialistas
          y programar subastas comerciales sobre los artículos aprobados.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/verificaciones" className="pf-btn">
            Ir a asignación de verificadores
          </Link>
          <Link href="/admin/subastas" className="pf-btn-secondary">
            Programar o supervisar subastas
          </Link>
        </div>
      </Card>
    </>
  );
}
