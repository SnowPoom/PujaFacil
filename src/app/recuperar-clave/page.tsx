import Card from "@/components/ui/Card";
import RecoveryForm from "./RecoveryForm";

export default function ForgotPage() {
  return <main className="pf-page w-full"><Card className="mx-auto max-w-lg"><section className="space-y-6">
    <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
    <p>Solicita un enlace de un solo uso válido durante 10 minutos. En esta demostración el enlace aparece en la consola del servidor de desarrollo.</p>
    <RecoveryForm />
  </section></Card></main>;
}
