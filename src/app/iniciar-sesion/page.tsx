import Link from "next/link";
import LoginForm from "./LoginForm";
import Card from "@/components/ui/Card";

export default function LoginPage() {
  return <main className="pf-page w-full">
    <Card className="mx-auto max-w-lg">
    <section className="space-y-6" aria-labelledby="login-title">

      <div><h1 id="login-title" className="pf-title ">Iniciar sesión</h1></div>
      <LoginForm />
      <div className="flex flex-wrap gap-4 text-sm"><Link href="/recuperar-clave">Recuperar contraseña</Link><Link href="/registro">Crear una cuenta</Link></div>
    </section>
    </Card>
  </main>;
}
