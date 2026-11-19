import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { requireCurrentUser } from "@/lib/auth/server";
import { listNotifications } from "@/modules/notifications/notification-service";
import NotificationsInbox from "./NotificationsInbox";

export default function NotificacionesPage() {
  return (
    <main className="pf-page w-full">
      <Suspense fallback={<p role="status">Cargando centro de notificaciones…</p>}>
        <NotificacionesContent />
      </Suspense>
    </main>
  );
}

async function NotificacionesContent() {
  const user = await requireCurrentUser();

  if (user.status !== "ACTIVA") {
    return (
      <Card className="space-y-4">
        <h1 className="pf-title ">Centro de notificaciones</h1>
        <p role="alert" className="pf-error">
          Tu cuenta debe estar activa para consultar y gestionar notificaciones.
        </p>
        <div>
          <Link href="/panel" className="pf-btn-secondary">
            Volver al panel
          </Link>
        </div>
      </Card>
    );
  }

  const { items } = await listNotifications(user.id);
  return <NotificationsInbox initialItems={items} />;
}
