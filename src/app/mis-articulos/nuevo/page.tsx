import { Suspense } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth/server";
import NewArticleForm from "./NewArticleForm";
export default function NewArticlePage() {
 return <Suspense fallback={<main className="pf-page"><p role="status">Cargando formulario…</p></main>}><Form /></Suspense>;
}
async function Form() {
 const user = await requireCurrentUser();
 if (user.status !== "ACTIVA" || !user.roles.includes("VENDEDOR")) return <main className="pf-page"><section className="pf-card space-y-4"><h1 className="pf-title">Publicar artículo</h1><p className="pf-error" role="alert">Necesitas una cuenta activa con perfil de vendedor para publicar artículos.</p><Link href="/panel" className="pf-btn-secondary">Volver al panel</Link></section></main>;
 return <NewArticleForm />;
}
