import Link from "next/link";
import LoginForm from "./LoginForm";
import Card from "@/components/ui/Card";

export default function LoginPage() {
  return <main className="pf-page w-full">
    <Card className="mx-auto max-w-lg">
    <section className="space-y-6" aria-labelledby="login-title">
      <Link href="/" className="text-sm font-semibold">PujaFácil</Link>
      <div><h1 id="login-title" className="text-2xl font-bold">Iniciar sesión</h1><p className="mt-2 text-sm">Accede a tu cuenta de la casa de subastas.</p></div>
      <LoginForm />
      <div className="flex flex-wrap gap-4 text-sm"><Link href="/recuperar-clave">Recuperar contraseña</Link><Link href="/registro">Crear una cuenta</Link></div>
    </section>
    </Card>
  </main>;
}
