"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { activationSchema, APPROVAL_REASON } from "@/lib/auth/schemas";

type Review = { reviewId: string; user: { nombreCompleto: string; cedula: string }; identity: { id: string; mimeType: string }; objectUrl: string };

export default function AccountReview({ userId, onClose, onActivated }: { userId: string; onClose: () => void; onActivated: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(`/api/admin/users/${userId}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "No se pudo abrir la revisión.");
        const file = await fetch(`/api/files/${result.data.identity.id}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!file.ok) {
          const failure = await file.json();
          throw new Error(failure.error?.message ?? "No se pudo consultar el documento de identidad protegido.");
        }
        const blob = await file.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setReview({ ...result.data, objectUrl });
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "No se pudo abrir la revisión.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [userId]);

  async function activate() {
    if (!review || busy) return;
    const parsed = activationSchema.safeParse({ reviewId: review.reviewId, documentoRevisadoId: review.identity.id, coherenciaConfirmada: confirmed, motivoCodigo: reason });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/users/${userId}/activate`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "No se pudo activar la cuenta."); return; }
      onActivated();
    } catch { setError("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setBusy(false); setConfirmOpen(false); }
  }

  return <section className="pf-card space-y-4" aria-labelledby="account-review-title">
    <h2 id="account-review-title" className="text-xl font-bold">Revisión protegida de la cuenta</h2>
    <p>Comprueba que el nombre y la cédula registrados coincidan con el documento ficticio antes de aprobar la cuenta.</p>
    {loading && <p role="status">Cargando datos y documento…</p>}
    {review && <>
      <dl className="space-y-2"><div><dt className="pf-label">Nombre registrado</dt><dd>{review.user.nombreCompleto}</dd></div><div><dt className="pf-label">Cédula ficticia registrada</dt><dd>{review.user.cedula}</dd></div></dl>
      {review.identity.mimeType.startsWith("image/") ?
        // El blob procede exclusivamente del endpoint protegido, sin URL pública ni optimización externa.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={review.objectUrl} alt="Documento de identidad ficticio para revisión" className="max-h-96 w-full object-contain" /> :
        <p>Documento PDF disponible. Ábrelo en otra pestaña para cotejarlo con los datos registrados.</p>}
      <a href={`/api/files/${review.identity.id}`} target="_blank" rel="noopener noreferrer" className="pf-btn-secondary">{review.identity.mimeType === "application/pdf" ? "Abrir PDF protegido en otra pestaña" : "Abrir documento protegido en otra pestaña"}</a>
      <fieldset disabled={busy} className="space-y-3">
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />He revisado el documento y comprobado su coherencia con los datos registrados.</label>
        <div><label htmlFor="approval-reason" className="pf-label">Motivo de aprobación</label><select id="approval-reason" className="pf-input" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Selecciona un motivo</option><option value={APPROVAL_REASON}>Datos registrados coherentes con el documento revisado</option></select></div>
        <p className="text-sm">El motivo predefinido evita incluir datos personales en la auditoría.</p>
        <Button disabled={busy || !confirmed || !reason} onClick={() => setConfirmOpen(true)}>Confirmar activación</Button>
      </fieldset>
    </>}
    {error && <p role="alert" className="pf-error">{error}</p>}
    <Button variant="secondary" disabled={busy} onClick={onClose}>Cerrar revisión</Button>
    <ConfirmDialog open={confirmOpen} title="Activar cuenta revisada" message="¿Confirmas la aprobación tras revisar el documento y comprobar su coherencia?" confirmText="Activar" loading={busy} onConfirm={activate} onCancel={() => { if (!busy) setConfirmOpen(false); }} />
  </section>;
}
