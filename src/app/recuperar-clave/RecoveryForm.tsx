"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { forgotSchema, resetSchema } from "@/lib/auth/schemas";

export default function RecoveryForm({ token }: { token?: string }) {
  const resetting = token !== undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(""); setMessage("");
    const input = resetting ? { token, newPassword: form.get("newPassword") } : { email: form.get("email") };
    const parsed = resetting ? resetSchema.safeParse(input) : forgotSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (resetting && form.get("newPassword") !== form.get("confirmation")) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${resetting ? "reset-password" : "forgot-password"}`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "No se pudo completar la solicitud."); return; }
      setMessage(result.data.message);
    } catch { setError("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    {!(message && resetting) && <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy || (resetting && !token)} className="space-y-4">
        {resetting ? <>
          <div><label htmlFor="newPassword" className="pf-label">Nueva contraseña</label><input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={15} maxLength={64} className="pf-input" required /></div>
          <div><label htmlFor="confirmation" className="pf-label">Confirmar contraseña</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={15} maxLength={64} className="pf-input" required /></div>
        </> : <div><label htmlFor="email" className="pf-label">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} className="pf-input" required /></div>}
        <Button type="submit" disabled={busy || (resetting && !token)}>{busy ? "Procesando…" : resetting ? "Guardar nueva contraseña" : "Solicitar recuperación"}</Button>
      </fieldset>
    </form>}
    {resetting && !token && <p className="pf-error" role="alert">Falta el enlace de recuperación. Solicita uno nuevo.</p>}
    {error && <p role="alert" className="pf-error">{error}</p>}
    {message && <p role="status" className="pf-success">{message}</p>}
    <div className="flex flex-wrap gap-4"><Link href="/iniciar-sesion">Volver a iniciar sesión</Link>{resetting && <Link href="/recuperar-clave">Solicitar otro enlace</Link>}</div>
  </div>;
}
