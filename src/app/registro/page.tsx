import Link from "next/link";
import Card from "@/components/ui/Card";
import RegisterForm from "./RegisterForm";

export default function RegisterPage() {
  return <main className="pf-page w-full">
    <Card className="mx-auto max-w-2xl">
    <section className="space-y-6" aria-labelledby="register-title">
      <Link href="/" className="text-sm font-semibold">PujaFácil</Link>
      <div><h1 id="register-title" className="text-2xl font-bold">Crear una cuenta</h1><p className="mt-2 text-sm">Utiliza únicamente datos y documentos ficticios para esta demostración.</p></div>
      <RegisterForm />
      <p id="register-help" className="text-sm">La cuenta se creará pendiente de aprobación y solicitará únicamente perfiles de comprador o vendedor.</p>
      <Link href="/iniciar-sesion" className="pf-btn-secondary">Volver a iniciar sesión</Link>
    </section>
    </Card>
  </main>;
}
