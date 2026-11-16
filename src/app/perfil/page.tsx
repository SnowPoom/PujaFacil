import { Suspense } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { requireCurrentUser } from "@/lib/auth/server";
import { prisma } from "@/lib/prisma";
import ProfileForm from "./ProfileForm";

export default function ProfilePage() {
  return <main className="pf-page w-full"><Suspense fallback={<p role="status">Cargando perfil…</p>}><Profile /></Suspense></main>;
}
async function Profile() {
  const user = await requireCurrentUser();
  const contact = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { telefono: true, direccion: true } });
  return <Card className="mx-auto max-w-2xl"><section className="space-y-6">
    <h1 className="text-2xl font-bold">Mi perfil</h1>
    <dl className="space-y-2"><div><dt className="pf-label">Nombre</dt><dd>{user.nombreCompleto}</dd></div><div><dt className="pf-label">Correo</dt><dd>{user.email}</dd></div><div><dt className="pf-label">Perfiles</dt><dd>{user.roles.join(", ")}</dd></div><div><dt className="pf-label">Estado</dt><dd><Badge>{user.status}</Badge></dd></div></dl>
    <ProfileForm {...contact} /><Link href="/panel">Volver al panel</Link>
  </section></Card>;
}
