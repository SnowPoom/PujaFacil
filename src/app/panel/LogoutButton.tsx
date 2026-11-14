"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) { setError("No se pudo cerrar la sesión. Inténtalo de nuevo."); return; }
      router.replace("/iniciar-sesion");
      router.refresh();
    } catch { setError("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setPending(false); }
  }
  return <div><Button type="button" variant="secondary" disabled={pending} onClick={logout}>{pending ? "Cerrando sesión…" : "Cerrar sesión"}</Button>{error && <p role="alert" className="pf-error">{error}</p>}</div>;
}
