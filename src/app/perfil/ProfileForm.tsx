"use client";

import { useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import { profileSchema } from "@/lib/auth/schemas";

export default function ProfileForm({ telefono, direccion }: { telefono: string | null; direccion: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaved(false);
    const parsed = profileSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/profile", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "No se pudo guardar el perfil."); return; }
      setSaved(true);
    } catch { setError("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
    <div><label htmlFor="telefono" className="pf-label">Teléfono</label><input id="telefono" name="telefono" type="tel" autoComplete="tel" defaultValue={telefono ?? ""} maxLength={25} className="pf-input" /></div>
    <div><label htmlFor="direccion" className="pf-label">Dirección</label><input id="direccion" name="direccion" autoComplete="street-address" defaultValue={direccion ?? ""} maxLength={250} className="pf-input" /></div>
    <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar perfil"}</Button>
  </fieldset>{error && <p role="alert" className="pf-error">{error}</p>}{saved && <p role="status" className="pf-success">Perfil actualizado.</p>}</form>;
}
