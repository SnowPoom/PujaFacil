import { displayLabel, formatDate } from "@/lib/presentation";
import { Suspense } from "react";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth/server";
import { hasRole } from "@/lib/auth/guards";
import { listAuditEvents, auditQuerySchema } from "@/lib/audit";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

type Query = Promise<Record<string, string | string[] | undefined>>;

export default function AuditoriaPage({ searchParams }: { searchParams: Query }) {
  return <main className="pf-page w-full"><Suspense fallback={<p role="status">Cargando auditoría…</p>}><AuditPanel searchParams={searchParams} /></Suspense></main>;
}

async function AuditPanel({ searchParams }: { searchParams: Query }) {
  const user = await requireCurrentUser();
  if (user.status !== "ACTIVA" || !hasRole(user, "AUDITOR")) redirect("/panel");
  const raw = await searchParams;
  const query = auditQuerySchema.safeParse({ page: raw.page, pageSize: raw.pageSize, action: raw.action || undefined });
  if (!query.success) return <Card><h1 className="pf-title ">Auditoría</h1><p role="alert" className="pf-error">Revisa los filtros: página positiva, tamaño entre 1 y 100 y un código de acción válido.</p><Link href="/auditoria" className="pf-btn-secondary">Restablecer filtros</Link></Card>;
  let data;
  try { data = await listAuditEvents(query.data); }
  catch (error) {
    unstable_rethrow(error);
    return <Card><h1 className="pf-title ">Auditoría</h1><p className="pf-error" role="alert">No se pudieron consultar los eventos. Inténtalo más tarde.</p></Card>;
  }
  const href = (page: number) => `/auditoria?${new URLSearchParams({ page: String(page), pageSize: String(data.pageSize), ...(query.data.action ? { action: query.data.action } : {}) })}`;
  return <Card><section className="space-y-6">
    <div><h1 className="pf-title ">Auditoría</h1><p className="mt-2">Eventos del sistema sin datos personales. Hora de Ecuador (UTC−5).</p></div>
    <form action="/auditoria" method="get" className="flex flex-wrap items-end gap-3">
      <div><label htmlFor="action" className="pf-label">Código de acción</label><input id="action" name="action" className="pf-input" defaultValue={query.data.action} maxLength={80} placeholder="ARCHIVO_CREADO" /></div>
      <div><label htmlFor="pageSize" className="pf-label">Eventos por página</label><select id="pageSize" name="pageSize" className="pf-input" defaultValue={data.pageSize}>{Array.from(new Set([10, 20, 50, 100, data.pageSize])).sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}</select></div>
      <Button type="submit">Filtrar</Button><Link href="/auditoria" className="pf-btn-secondary">Limpiar</Link>
    </form>
    <div className="overflow-x-auto"><table className="pf-table">
      <caption className="text-left mb-3">{data.total} eventos registrados</caption>
      <thead><tr><th scope="col">Fecha y hora</th><th scope="col">Acción</th><th scope="col">Recurso</th><th scope="col">Resultado</th></tr></thead>
      <tbody>{data.items.length === 0 ? <tr><td colSpan={4}>No hay eventos para estos filtros.</td></tr> : data.items.map((event) => <tr key={event.id}>
        <td><time dateTime={event.createdAt.toISOString()}>{formatDate(event.createdAt)}</time></td>
        <td><span>{displayLabel(event.action)}</span><span className="block text-xs text-[var(--pf-muted)] font-mono">{event.action}</span></td><td>{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ""}</td>
        <td><Badge variant={["EXITO", "SUCCESS", "OK"].includes(event.result) ? "success" : ["ERROR", "FAILURE", "DENEGADO"].includes(event.result) ? "error" : "neutral"}>{event.result}</Badge></td>
      </tr>)}</tbody>
    </table></div>
    <nav aria-label="Paginación de auditoría" className="pf-pagination">
      {data.page > 1 && <Link href={href(data.page - 1)} className="pf-btn-secondary">Anterior</Link>}
      <span className="pf-pagination__info">Página {data.page} de {data.pages}</span>
      {data.page < data.pages && <Link href={href(data.page + 1)} className="pf-btn-secondary">Siguiente</Link>}
    </nav>
  </section></Card>;
}
