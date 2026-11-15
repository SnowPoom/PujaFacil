/**
 * prisma/seed.ts — Semilla de datos ficticios para PujaFácil
 *
 * Cédulas ficticias cifradas con el helper compartido AES-256-GCM.
 *
 * Uso: npm run db:seed
 * Requiere: DEMO_PASSWORD y ENCRYPTION_KEY_HEX en .env
 */
import { PrismaClient, Role, AccountStatus, ArticleStatus, AuctionStatus } from "@prisma/client";
import bcryptjs from "bcryptjs";
import { encryptCedula } from "@/lib/auth/crypto";

const prisma = new PrismaClient();
// CUID v1 fijos para los registros demo buscados por ID. El resto usa @default(cuid()).
const demoApprovedArticleId = "cmwi7cxk10001pf01a1b2c3d4";
const demoDraftArticleId = "cmwi7cxk10002pf01a1b2c3d4";
const demoAuctionId = "cmwi7cxk10000pf01a1b2c3d4";
const legacyDemoApprovedArticleId = "demo-articulo-aprobado";
const legacyDemoDraftArticleId = "demo-articulo-borrador";
const legacyDemoAuctionId = "demo-subasta-programada";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  throw new Error("DEMO_PASSWORD no está definido en .env");
}

async function main() {
  const passwordHash = await bcryptjs.hash(DEMO_PASSWORD!, 12);

  // Admin de subastas
  await prisma.user.upsert({
    where: { email: "admin@pujafacil.test" },
    update: { passwordHash, cedulaCifrada: encryptCedula("1234567890"), status: AccountStatus.ACTIVA, roles: { deleteMany: {}, create: [{ role: Role.ADMIN_SUBASTAS }] } },
    create: {
      nombreCompleto: "Administrador Demo",
      email: "admin@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedula("1234567890"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.ADMIN_SUBASTAS }] },
    },
  });

  // Auditor
  await prisma.user.upsert({
    where: { email: "auditor@pujafacil.test" },
    update: { passwordHash, cedulaCifrada: encryptCedula("0987654321"), status: AccountStatus.ACTIVA, roles: { deleteMany: {}, create: [{ role: Role.AUDITOR }] } },
    create: {
      nombreCompleto: "Ana Auditora Demo",
      email: "auditor@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedula("0987654321"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.AUDITOR }] },
    },
  });

  // Verificador
  await prisma.user.upsert({
    where: { email: "verificador@pujafacil.test" },
    update: { passwordHash, cedulaCifrada: encryptCedula("1122334455"), status: AccountStatus.ACTIVA, roles: { deleteMany: {}, create: [{ role: Role.VERIFICADOR }] } },
    create: {
      nombreCompleto: "Vicente Verificador Demo",
      email: "verificador@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedula("1122334455"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.VERIFICADOR }] },
    },
  });

  // Vendedor
  const vendedor = await prisma.user.upsert({
    where: { email: "vendedor@pujafacil.test" },
    update: { passwordHash, cedulaCifrada: encryptCedula("5566778899"), status: AccountStatus.ACTIVA, roles: { deleteMany: {}, create: [{ role: Role.VENDEDOR }] } },
    create: {
      nombreCompleto: "Valentina Vendedora Demo",
      email: "vendedor@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedula("5566778899"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.VENDEDOR }] },
    },
  });

  // Compradores
  const comprador1 = await prisma.user.upsert({
    where: { email: "comprador1@pujafacil.test" },
    update: { passwordHash, cedulaCifrada: encryptCedula("6677889900"), status: AccountStatus.ACTIVA, roles: { deleteMany: {}, create: [{ role: Role.COMPRADOR }] } },
    create: {
      nombreCompleto: "Carlos Comprador Demo",
      email: "comprador1@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedula("6677889900"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.COMPRADOR }] },
    },
  });

  await prisma.user.upsert({
    where: { email: "comprador2@pujafacil.test" },
    update: { passwordHash, cedulaCifrada: encryptCedula("7788990011"), status: AccountStatus.ACTIVA, roles: { deleteMany: {}, create: [{ role: Role.COMPRADOR }] } },
    create: {
      nombreCompleto: "Laura Compradora Demo",
      email: "comprador2@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedula("7788990011"),
      status: AccountStatus.ACTIVA,
      roles: { create: [{ role: Role.COMPRADOR }] },
    },
  });

  // Usuario pendiente (sin activar)
  await prisma.user.upsert({
    where: { email: "pendiente@pujafacil.test" },
    update: { passwordHash, cedulaCifrada: encryptCedula("8899001122"), status: AccountStatus.PENDIENTE, roles: { deleteMany: {}, create: [{ role: Role.COMPRADOR }] } },
    create: {
      nombreCompleto: "Pedro Pendiente Demo",
      email: "pendiente@pujafacil.test",
      passwordHash,
      cedulaCifrada: encryptCedula("8899001122"),
      status: AccountStatus.PENDIENTE,
      roles: { create: [{ role: Role.COMPRADOR }] },
    },
  });

  // Subasta PROGRAMADA de demostración
  const ahora = new Date();
  const abre = new Date(ahora.getTime() + 2 * 60 * 60 * 1000);  // en 2 horas
  const cierra = new Date(ahora.getTime() + 26 * 60 * 60 * 1000); // en 26 horas

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@pujafacil.test" } });

  await prisma.$transaction(async (tx) => {
    // Las FK usan ON UPDATE CASCADE: conservar archivos, revisiones y subastas.
    // Si algún ID antiguo y su nuevo CUID coexisten, toda esta transacción se revierte.
    for (const [legacyId, id] of [
      [legacyDemoApprovedArticleId, demoApprovedArticleId],
      [legacyDemoDraftArticleId, demoDraftArticleId],
    ]) {
      await tx.article.updateMany({ where: { id: legacyId }, data: { id } });
    }

    // Artículo APROBADO de demostración
    const articuloAprobado = await tx.article.upsert({
      where: { id: demoApprovedArticleId },
      update: {},
      create: {
        id: demoApprovedArticleId,
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
    await tx.article.upsert({
      where: { id: demoDraftArticleId },
      update: {},
      create: {
        id: demoDraftArticleId,
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

    // Conservar también pujas, alias y mensajes de la subasta anterior.
    // Si ambos IDs ya existen, la restricción única aborta sin fusionar ni borrar datos.
    await tx.auction.updateMany({
      where: { id: legacyDemoAuctionId },
      data: { id: demoAuctionId },
    });
    // El nombre de sala es texto y no se actualiza mediante la FK de auctionId.
    await tx.chatMessage.updateMany({
      where: { auctionId: demoAuctionId, room: `auction:${legacyDemoAuctionId}` },
      data: { room: `auction:${demoAuctionId}` },
    });

    const subastaDemo = await tx.auction.upsert({
      where: { id: demoAuctionId },
      update: {},
      create: {
        id: demoAuctionId,
        articleId: articuloAprobado.id,
        createdById: admin.id,
        startingPrice: "150.00",
        minIncrement: "10.00",
        opensAt: abre,
        closesAt: cierra,
        status: AuctionStatus.PROGRAMADA,
      },
    });

    // Usar siempre el ID de la subasta devuelta, también para el alias demo.
    await tx.auctionAlias.upsert({
      where: { auctionId_userId: { auctionId: subastaDemo.id, userId: comprador1.id } },
      update: {},
      create: {
        auctionId: subastaDemo.id,
        userId: comprador1.id,
        alias: "Pujador-Alfa",
      },
    });
  });

  console.log("✅ Seed completado — solo datos ficticios");
}

main()
  .catch(() => {
    console.error("No se pudo completar el seed. Revisa la conexión, las migraciones y las variables requeridas.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
