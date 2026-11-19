import Link from "next/link";
import Card from "@/components/ui/Card";
import RegisterForm from "./RegisterForm";

export default function RegisterPage() {
  return <main className="pf-page w-full">
    <Card className="mx-auto max-w-2xl">
    <section className="space-y-6" aria-labelledby="register-title">
      <Link href="/" className="text-sm font-semibold">PujaFácil</Link>
      <div><h1 id="register-title" className="pf-title ">Crear una cuenta</h1><p className="mt-2 text-sm">Regístrate para participar en subastas o publicar tus artículos.</p></div>
      <RegisterForm />
      <p id="register-help" className="text-sm">Tu cuenta quedará pendiente de aprobación. Puedes solicitar el perfil de comprador, vendedor o ambos.</p>
      <Link href="/iniciar-sesion" className="pf-btn-secondary">Volver a iniciar sesión</Link>
    </section>
    </Card>
  </main>;
}
