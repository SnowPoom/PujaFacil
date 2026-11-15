"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Pagination from "@/components/ui/Pagination";

type Account = { id: string; status: string; roles: string[]; hasIdentity: boolean; createdAt: string };
export default function UsersTable({ items, page, pages, total, status }: { items: Account[]; page: number; pages: number; total: number; status: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  function navigate(nextPage: number, nextStatus = status) {
    const query = new URLSearchParams({ page: String(nextPage) });
    if (nextStatus) query.set("status", nextStatus);
    router.push(`/admin/usuarios?${query}`);
  }
  async function activate() {
    if (!target || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/users/${target.id}/activate`, { method: "POST", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "No se pudo activar la cuenta."); return; }
      setMessage("Cuenta activada correctamente."); router.refresh();
    } catch { setError("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setBusy(false); setTarget(null); }
  }
  return <div className="space-y-5">
    <div><label htmlFor="status" className="pf-label">Estado de cuenta</label><select id="status" className="pf-input" value={status} onChange={(event) => navigate(1, event.target.value)}><option value="">Pendientes y activas</option><option value="PENDIENTE">Pendientes</option><option value="ACTIVA">Activas</option></select></div>
    <p>{total} cuentas. Se muestran referencias internas sin nombres, correos ni documentos.</p>
    {error && <p role="alert" className="pf-error">{error}</p>}{message && <p role="status" className="pf-success">{message}</p>}
    <div className="overflow-x-auto"><table className="pf-table"><caption className="sr-only">Cuentas para aprobación</caption><thead><tr><th>Referencia</th><th>Estado</th><th>Perfil solicitado</th><th>Acciones</th></tr></thead><tbody>
      {items.map((account) => <tr key={account.id}><td>{account.id}</td><td><Badge variant={account.status === "ACTIVA" ? "success" : "accent"}>{account.status}</Badge></td><td>{account.roles.join(", ")}</td><td>{account.status === "PENDIENTE" ? <Button disabled={busy || !account.hasIdentity} onClick={() => { setError(""); setTarget(account); }}>Activar</Button> : "Activada"}{account.status === "PENDIENTE" && !account.hasIdentity && <p className="text-sm">Documento pendiente</p>}</td></tr>)}
      {items.length === 0 && <tr><td colSpan={4}>No hay cuentas en esta página.</td></tr>}
    </tbody></table></div>
    <Pagination page={page} pages={pages} onPageChange={navigate} />
    <ConfirmDialog open={target !== null} title="Activar cuenta" message={`¿Confirmas la activación de la cuenta ${target?.id ?? ""}? Podrá realizar las operaciones de sus perfiles.`} confirmText="Activar" onConfirm={activate} onCancel={() => { if (!busy) setTarget(null); }} loading={busy} />
  </div>;
}
