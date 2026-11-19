"use client";

import { useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import { registerSchema } from "@/lib/auth/schemas";

export default function RegisterForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const roles = form.getAll("roles");
    const parsed = registerSchema.safeParse({ ...Object.fromEntries(form), roles });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    form.set("roles", JSON.stringify(roles));
    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", { method: "POST", credentials: "same-origin", body: form });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "No se pudo crear la cuenta."); return; }
      setSuccess(true);
    } catch { setError("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }
  if (success) return <p role="status" className="pf-success">Cuenta creada, pendiente de aprobación. Puedes iniciar sesión para consultar tu estado.</p>;
  return <form onSubmit={submit} aria-describedby="register-help" className="space-y-4"><fieldset disabled={busy} className="space-y-4">
    <legend className="sr-only">Datos de registro</legend>
    <div><label htmlFor="nombreCompleto" className="pf-label">Nombre completo</label><input id="nombreCompleto" name="nombreCompleto" autoComplete="name" minLength={3} maxLength={100} required className="pf-input" /></div>
    <div><label htmlFor="email" className="pf-label">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} required className="pf-input" /></div>
    <div><label htmlFor="password" className="pf-label">Contraseña (15 a 64 caracteres)</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={64} required className="pf-input" /></div>
    <div><label htmlFor="cedula" className="pf-label">Cédula (10 dígitos)</label><input id="cedula" name="cedula" inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} required className="pf-input" /></div>
    <fieldset className="space-y-2"><legend className="pf-label">Perfiles solicitados</legend><label className="flex gap-2"><input type="checkbox" name="roles" value="COMPRADOR" />Comprador</label><label className="flex gap-2"><input type="checkbox" name="roles" value="VENDEDOR" />Vendedor</label></fieldset>
    <div><label htmlFor="identidad" className="pf-label">Documento de identidad (imagen hasta 10 MB o PDF hasta 20 MB)</label><input id="identidad" name="identidad" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="pf-input" /></div>
    <label className="flex gap-2 text-sm"><input name="terminos" type="checkbox" required />Confirmo que la información registrada es correcta.</label>
    <Button type="submit" disabled={busy} className="w-full">{busy ? "Creando cuenta…" : "Crear cuenta"}</Button>
  </fieldset>{error && <p role="alert" className="pf-error">{error}</p>}</form>;
}
