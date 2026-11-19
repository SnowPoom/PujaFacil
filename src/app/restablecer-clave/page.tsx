import { Suspense } from "react";
import Card from "@/components/ui/Card";
import RecoveryForm from "@/app/recuperar-clave/RecoveryForm";

export default function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  return <main className="pf-page w-full"><Card className="mx-auto max-w-lg"><section className="space-y-6">
    <h1 className="pf-title ">Restablecer contraseña</h1>
    <p>Elige una frase larga y evita contraseñas comunes. Tus sesiones anteriores se cerrarán al guardar.</p>
    <Suspense fallback={<p role="status">Cargando enlace…</p>}><ResetContent searchParams={searchParams} /></Suspense>
  </section></Card></main>;
}
async function ResetContent({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <RecoveryForm token={typeof token === "string" ? token : ""} />;
}
