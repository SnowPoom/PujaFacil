import Link from "next/link";

export default function HomePage() {
  return (
    <main className="pf-page flex flex-col items-center justify-center min-h-screen gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold" style={{ color: "var(--pf-primary)" }}>
          PujaFácil
        </h1>
        <p className="text-lg mt-2" style={{ color: "var(--pf-text)" }}>
          Casa de subastas en línea
        </p>
      </div>

      <div className="pf-card flex flex-col gap-4 w-full max-w-sm text-center">
        <p className="text-sm" style={{ color: "var(--pf-text)" }}>
          Bienvenido. Accede o regístrate para participar en subastas.
        </p>
        <Link href="/iniciar-sesion" className="pf-btn">
          Iniciar sesión
        </Link>
        <Link href="/registro" className="pf-btn-secondary">
          Crear cuenta
        </Link>
      </div>
    </main>
  );
}
