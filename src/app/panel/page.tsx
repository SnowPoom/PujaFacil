import { Suspense } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import LogoutButton from "./LogoutButton";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export default function PanelPage() {
  return <main className="pf-page w-full"><Suspense fallback={<p role="status">Cargando tu panel…</p>}><Panel /></Suspense></main>;
}
async function Panel() {
  const user = await requireCurrentUser();
  const links = [];
  if (user.status === "ACTIVA") {
    // Christian.md (14/11): AUDITOR solo ve el enlace de auditoría en este panel.
    if (hasRole(user, "AUDITOR")) links.push({ href: "/auditoria", label: "Auditoría" });
    else {
    if (hasRole(user, "VENDEDOR")) links.push({ href: "/mis-articulos", label: "Mis artículos" });
    if (hasRole(user, "COMPRADOR")) links.push({ href: "/subastas", label: "Subastas" });
    if (hasRole(user, "VERIFICADOR")) links.push({ href: "/verificacion", label: "Verificación" });
    if (hasRole(user, "ADMIN_SUBASTAS")) links.push({ href: "/admin", label: "Administración" });
    if (user.roles.length > 0) links.push({ href: "/chat", label: "Chat" });
    }
  }
  return <Card><section className="space-y-6">
    <div><h1 className="text-2xl font-bold">Mi panel</h1><p className="mt-2">Bienvenido, {user.nombreCompleto}.</p></div>
    <p><Badge variant={user.status === "ACTIVA" ? "success" : "accent"}>{user.status}</Badge></p>
    {user.status === "PENDIENTE" && <div role="status"><h2 className="font-semibold">Pendiente de aprobación</h2><p className="mt-2">Un administrador debe revisar tu documento ficticio y activar tu cuenta antes de que puedas publicar, ofertar o chatear.</p></div>}
    {links.length > 0 && <nav aria-label="Operaciones de mi cuenta" className="flex flex-wrap gap-3">{links.map((link) => <Link key={link.href} href={link.href} className="pf-btn">{link.label}</Link>)}</nav>}
    <LogoutButton />
  </section></Card>;
}
