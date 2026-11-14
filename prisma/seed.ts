/**
 * prisma/seed.ts — Semilla de datos ficticios para PujaFácil
 *
 * IMPORTANTE: Este seed requiere `encryptCedula` de src/lib/auth/crypto.ts (hito C0 de Christian).
 * Ejecutar SOLO después de que C0 esté fusionado en main.
 *
 * Uso: npm run db:seed
 * Requiere: DEMO_PASSWORD y ENCRYPTION_KEY_HEX en .env
 */
import { PrismaClient, Role, AccountStatus, ArticleStatus, AuctionStatus } from "@prisma/client";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();

// encryptCedula vendrá de Christian — importar cuando C0 esté disponible:
// import { encryptCedula } from "@/lib/auth/crypto";
// Por ahora usa un placeholder para que la migración no bloquee
function encryptCedulaPlaceholder(cedula: string): string {
  // TODO: reemplazar con encryptCedula de Christian en J2 (15/11)
  return `PENDIENTE_CIFRADO::${cedula}`;
}

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  throw new Error("DEMO_PASSWORD no está definido en .env");
}

async function main() {
  const passwordHash = await bcryptjs.hash(DEMO_PASSWORD!, 12);

  // Admin de subastas
  await prisma.user.upsert({
    where: { email: "admin@pujafacil.test" },
    update: {},
    create: {
      nombreCompleto: "Administrador Demo",
      email: "admin@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedulaPlaceholder("1234567890"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.ADMIN_SUBASTAS }] },
    },
  });

  // Auditor
  await prisma.user.upsert({
    where: { email: "auditor@pujafacil.test" },
    update: {},
    create: {
      nombreCompleto: "Ana Auditora Demo",
      email: "auditor@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedulaPlaceholder("0987654321"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.AUDITOR }] },
    },
  });

  // Verificador
  await prisma.user.upsert({
    where: { email: "verificador@pujafacil.test" },
    update: {},
    create: {
      nombreCompleto: "Vicente Verificador Demo",
      email: "verificador@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedulaPlaceholder("1122334455"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.VERIFICADOR }] },
    },
  });

  // Vendedor
  const vendedor = await prisma.user.upsert({
    where: { email: "vendedor@pujafacil.test" },
    update: {},
    create: {
      nombreCompleto: "Valentina Vendedora Demo",
      email: "vendedor@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedulaPlaceholder("5566778899"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.VENDEDOR }] },
    },
  });

  // Compradores
  const comprador1 = await prisma.user.upsert({
    where: { email: "comprador1@pujafacil.test" },
    update: {},
    create: {
      nombreCompleto: "Carlos Comprador Demo",
      email: "comprador1@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedulaPlaceholder("6677889900"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.COMPRADOR }] },
    },
  });

  await prisma.user.upsert({
    where: { email: "comprador2@pujafacil.test" },
    update: {},
    create: {
      nombreCompleto: "Laura Compradora Demo",
      email: "comprador2@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedulaPlaceholder("7788990011"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.COMPRADOR }] },
    },
  });

  // Usuario pendiente (sin activar)
  await prisma.user.upsert({
    where: { email: "pendiente@pujafacil.test" },
    update: {},
    create: {
      nombreCompleto: "Pedro Pendiente Demo",
      email: "pendiente@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedulaPlaceholder("8899001122"),
      status: AccountStatus.PENDIENTE,
      roles: { create: [{ role: Role.COMPRADOR }] },
    },
  });

  // Artículo APROBADO de demostración
  const articuloAprobado = await prisma.article.upsert({
    where: { id: "demo-articulo-aprobado" },
    update: {},
    create: {
      id: "demo-articulo-aprobado",
      ownerId: vendedor.id,
      title: "Reloj Antiguo Suizo (Demo)",
      description: "Reloj de bolsillo de manufactura suiza, circa 1920. Solo para demostración.",
      category: "Relojes",
      condition: "Bueno",
      provenance: "Colección privada ficticia",
      initialPrice: "150.00",
      status: ArticleStatus.APROBADO,
    },
  });

  // Artículo BORRADOR
  await prisma.article.upsert({
    where: { id: "demo-articulo-borrador" },
    update: {},
    create: {
      id: "demo-articulo-borrador",
      ownerId: vendedor.id,
      title: "Lámpara Art Déco (Demo, Borrador)",
      description: "Lámpara de escritorio estilo Art Déco. Solo para demostración.",
      category: "Iluminación",
      condition: "Regular",
      provenance: "Mercado de antigüedades ficticio",
      initialPrice: "80.00",
      status: ArticleStatus.BORRADOR,
    },
  });

  // Subasta PROGRAMADA de demostración
  const ahora = new Date();
  const abre = new Date(ahora.getTime() + 2 * 60 * 60 * 1000);  // en 2 horas
  const cierra = new Date(ahora.getTime() + 26 * 60 * 60 * 1000); // en 26 horas

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@pujafacil.test" } });

  await prisma.auction.upsert({
    where: { id: "demo-subasta-programada" },
    update: {},
    create: {
      id: "demo-subasta-programada",
      articleId: articuloAprobado.id,
      createdById: admin.id,
      startingPrice: "150.00",
      minIncrement: "10.00",
      opensAt: abre,
      closesAt: cierra,
      status: AuctionStatus.PROGRAMADA,
    },
  });

  // Alias de demostración
  await prisma.auctionAlias.upsert({
    where: { auctionId_userId: { auctionId: "demo-subasta-programada", userId: comprador1.id } },
    update: {},
    create: {
      auctionId: "demo-subasta-programada",
      userId: comprador1.id,
      alias: "Pujador-Alfa",
    },
  });

  console.log("✅ Seed completado — solo datos ficticios");
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
