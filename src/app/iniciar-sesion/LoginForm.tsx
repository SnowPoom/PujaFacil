"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loginSchema } from "@/lib/auth/schemas";
import Button from "@/components/ui/Button";

export default function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok || !result.ok) { setError(result.error?.message ?? "No se pudo iniciar sesión."); return; }
      router.replace("/panel");
      router.refresh();
    } catch { setError("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
    <div><label htmlFor="email" className="pf-label">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required className="pf-input" /></div>
    <div><label htmlFor="password" className="pf-label">Contraseña</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={256} required className="pf-input" /></div>
    {error && <p role="alert" className="pf-error">{error}</p>}
    <Button type="submit" disabled={pending} className="w-full">{pending ? "Iniciando sesión…" : "Iniciar sesión"}</Button>
  </form>;
}
