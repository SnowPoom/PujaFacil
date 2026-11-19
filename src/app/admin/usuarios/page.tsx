import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import { listAccounts, usersQuerySchema } from "@/lib/auth/accounts";
import UsersTable from "./UsersTable";

type Query = Promise<{ page?: string; status?: string }>;
export default function UsersPage({ searchParams }: { searchParams: Query }) {
  return <main className="pf-page w-full"><Suspense fallback={<p role="status">Cargando cuentas…</p>}><Accounts searchParams={searchParams} /></Suspense></main>;
}
async function Accounts({ searchParams }: { searchParams: Query }) {
  const actor = await requireCurrentUser();
  if (actor.status !== "ACTIVA" || !hasRole(actor, "ADMIN_SUBASTAS")) return <Card><h1 className="pf-title ">Acceso restringido</h1><p role="alert" className="pf-error">Solo un administrador de subastas activo puede aprobar cuentas.</p><Link href="/panel">Volver al panel</Link></Card>;
  const parsed = usersQuerySchema.safeParse(await searchParams);
  if (!parsed.success) return <Card><p role="alert" className="pf-error">Los filtros de cuentas no son válidos.</p><Link href="/admin/usuarios">Limpiar filtros</Link></Card>;
  const data = await listAccounts(parsed.data);
  return <Card><section className="space-y-6"><h1 className="pf-title ">Administración de usuarios</h1>
    <UsersTable {...data} status={parsed.data.status ?? ""} items={data.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))} />
    <Link href="/panel">Volver al panel</Link></section></Card>;
}
