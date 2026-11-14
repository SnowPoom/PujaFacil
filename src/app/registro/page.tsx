import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

export default function RegisterPage() {
  return <main className="pf-page w-full">
    <Card className="mx-auto max-w-2xl">
    <section className="space-y-6" aria-labelledby="register-title">
      <Link href="/" className="text-sm font-semibold">PujaFácil</Link>
      <div><h1 id="register-title" className="text-2xl font-bold">Crear una cuenta</h1><p className="mt-2 text-sm">Utiliza únicamente datos y documentos ficticios para esta demostración.</p></div>
      <p role="status" className="pf-error">El registro estará disponible cuando se integre la validación segura de documentos. Por ahora puedes iniciar sesión con una cuenta de demostración existente.</p>
      {/* J2: habilitar al integrar saveValidatedUpload y POST /api/auth/register. */}
      <form aria-describedby="register-help">
        <fieldset disabled className="space-y-4">
          <legend className="sr-only">Datos de registro</legend>
          <div><label htmlFor="nombreCompleto" className="pf-label">Nombre completo ficticio</label><input id="nombreCompleto" name="nombreCompleto" autoComplete="name" minLength={3} maxLength={100} required className="pf-input" /></div>
          <div><label htmlFor="email" className="pf-label">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} required className="pf-input" /></div>
          <div><label htmlFor="password" className="pf-label">Contraseña (15 a 64 caracteres)</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={64} required className="pf-input" /></div>
          <div><label htmlFor="cedula" className="pf-label">Cédula ficticia (10 dígitos)</label><input id="cedula" name="cedula" inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} required className="pf-input" /></div>
          <fieldset className="space-y-2"><legend className="pf-label">Perfiles solicitados</legend><label className="flex gap-2"><input type="checkbox" name="roles" value="COMPRADOR" />Comprador</label><label className="flex gap-2"><input type="checkbox" name="roles" value="VENDEDOR" />Vendedor</label></fieldset>
          <div><label htmlFor="identidad" className="pf-label">Documento de identidad ficticio</label><input id="identidad" name="identidad" type="file" required className="pf-input" /></div>
          <label className="flex gap-2 text-sm"><input name="terminos" type="checkbox" required />Acepto utilizar datos ficticios en esta demostración.</label>
          <Button className="w-full" type="submit" disabled>Registro pendiente de habilitación</Button>
        </fieldset>
      </form>
      <p id="register-help" className="text-sm">La cuenta se creará pendiente de aprobación y solicitará únicamente perfiles de comprador o vendedor.</p>
      <Link href="/iniciar-sesion" className="pf-btn-secondary">Volver a iniciar sesión</Link>
    </section>
    </Card>
  </main>;
}
