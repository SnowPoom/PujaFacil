import Card from "@/components/ui/Card";
import RecoveryForm from "./RecoveryForm";

export default function ForgotPage() {
  return <main className="pf-page w-full"><Card className="mx-auto max-w-lg"><section className="space-y-6">
    <h1 className="pf-title ">Recuperar contraseña</h1>
    <p>Solicita un enlace de recuperación para establecer una nueva contraseña. El enlace es válido durante 10 minutos y se puede utilizar una sola vez.</p>
    <RecoveryForm />
  </section></Card></main>;
}
