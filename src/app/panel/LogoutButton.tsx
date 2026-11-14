"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  return <div><button type="button" className="pf-btn-secondary" disabled={pending} onClick={logout}>{pending ? "Cerrando sesión…" : "Cerrar sesión"}</button>{error && <p role="alert" className="pf-error">{error}</p>}</div>;
}
