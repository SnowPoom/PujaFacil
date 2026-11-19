/** Datos sintéticos para la exposición. No borra ni reinicia registros existentes. */
import { loadEnvConfig } from "@next/env";
import { Role, AccountStatus, ArticleStatus, AuctionStatus } from "@prisma/client";
import bcryptjs from "bcryptjs";
import sharp from "sharp";
import { createHash } from "node:crypto";
import catalog from "./assets/catalog.json";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { encryptCedula } from "@/lib/auth/crypto";
import { saveValidatedUpload } from "@/lib/uploads";
loadEnvConfig(process.cwd());
const fixedId = (n: number) => `cseed2026${String(n).padStart(16, "0")}`;
const accounts: { email: string; name: string; cedula: string; role: Role[]; status: AccountStatus }[] = [
  { email: "admin@pujafacil.test", name: "María Ríos", cedula: "1234567890", role: ["ADMIN_SUBASTAS"], status: "ACTIVA" },
  { email: "auditor@pujafacil.test", name: "Ana Torres", cedula: "0987654321", role: ["AUDITOR"], status: "ACTIVA" },
  { email: "verificador@pujafacil.test", name: "Vicente Mora", cedula: "1122334455", role: ["VERIFICADOR"], status: "ACTIVA" },
  { email: "vendedor@pujafacil.test", name: "Valentina Herrera", cedula: "5566778899", role: ["VENDEDOR"], status: "ACTIVA" },
  { email: "comprador1@pujafacil.test", name: "Carlos Vega", cedula: "6677889900", role: ["COMPRADOR"], status: "ACTIVA" },
  { email: "comprador2@pujafacil.test", name: "Laura Andrade", cedula: "7788990011", role: ["COMPRADOR"], status: "ACTIVA" },
  { email: "pendiente@pujafacil.test", name: "Pedro Salazar", cedula: "8899001122", role: ["COMPRADOR", "VENDEDOR"], status: "PENDIENTE" },
  { email: "verificador2@pujafacil.test", name: "Lucía Paredes", cedula: "9988776655", role: ["VERIFICADOR"], status: "ACTIVA" },
  { email: "comerciante@pujafacil.test", name: "Andrés Romero", cedula: "5544332211", role: ["COMPRADOR", "VENDEDOR"], status: "ACTIVA" },
];
const titles = catalog.map((item) => item.title);
const states: ArticleStatus[] = [
  "ASOCIADO_SUBASTA", "ASOCIADO_SUBASTA", "APROBADO", "PENDIENTE_REVISION", "REQUIERE_CORRECCIONES", "BORRADOR", "RECHAZADO", "APROBADO",
  "ASOCIADO_SUBASTA", "ASOCIADO_SUBASTA", "ASOCIADO_SUBASTA", "ASOCIADO_SUBASTA", "PENDIENTE_REVISION", "APROBADO", "APROBADO", "BORRADOR",
  "APROBADO", "APROBADO", "APROBADO", "APROBADO", "APROBADO", "APROBADO", "PENDIENTE_REVISION", "BORRADOR",
];
async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.includes("DEFINIR")) throw new Error("Define DEMO_PASSWORD en .env antes de cargar las cuentas.");
  const passwordHash = await bcryptjs.hash(password, 12);
  const users = [];
  for (const account of accounts) {
    const user = await prisma.user.upsert({ where: { email: account.email }, update: {}, create: {
      email: account.email, nombreCompleto: account.name, passwordHash,
      cedulaCifrada: encryptCedula(account.cedula), status: account.status,
      roles: { create: account.role.map((role) => ({ role })) },
    } });
    users.push(user);
    if (!await prisma.fileRecord.findFirst({ where: { ownerId: user.id, kind: "IDENTIDAD" } })) {
      const card = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#F7F5F1"/><rect x="32" y="32" width="836" height="436" rx="12" fill="white" stroke="#DDD9D1"/><text x="65" y="100" font-family="Arial" font-size="32" fill="#1F3A5F">PujaFácil · Ficha de registro</text><text x="65" y="200" font-family="Arial" font-size="28" fill="#1F2933">${account.name}</text><text x="65" y="260" font-family="Arial" font-size="24" fill="#1F2933">Documento: ${account.cedula}</text><text x="65" y="410" font-family="Arial" font-size="19" fill="#596575">Material académico sintético · Sin validez oficial</text></svg>`;
      const bytes = await sharp(Buffer.from(card)).png().toBuffer();
      await saveValidatedUpload(new File([new Uint8Array(bytes)], "identidad.png", { type: "image/png" }), { ownerId: user.id, kind: "IDENTIDAD" });
    }
  }
  const [admin, , verifier, seller, buyer1, buyer2] = users;
  const now = new Date();
  const hour = 3600000;
  for (let i = 0; i < titles.length; i++) {
    const id = fixedId(i + 100);
    // Conservar cualquier expediente existente, incluidas sus decisiones y fechas.
    if (await prisma.article.findUnique({ where: { id } })) continue;
    const item = catalog[i];
    const price = item.price;
    const article = await prisma.article.create({ data: {
      id, ownerId: seller.id, title: item.title, category: item.category,
      description: item.description,
      condition: i % 3 === 0 ? "Excelente" : "Muy bueno",
      provenance: `Colección particular en ${item.city}. El propietario aporta registro de adquisición y documentación para revisión de la casa de subastas.`,
      initialPrice: price.toFixed(2), status: states[i], createdAt: new Date(now.getTime() - (24 - i) * hour),
    } });
    const photo = await sharp(await readFile(`prisma/assets/${item.asset}`)).resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    await saveValidatedUpload(new File([new Uint8Array(photo)], "articulo.jpg", { type: "image/jpeg" }), { ownerId: seller.id, articleId: article.id, kind: "FOTO" });
    if (states[i] !== "BORRADOR") {
      const decision = states[i] === "PENDIENTE_REVISION" ? null : states[i] === "REQUIERE_CORRECCIONES" ? "REQUIERE_CORRECCIONES" : states[i] === "RECHAZADO" ? "RECHAZADO" : "APROBADO";
      if (i !== 12) await prisma.review.create({ data: {
        id: fixedId(i + 200), articleId: id, verifierId: i === 22 ? users[7].id : verifier.id, status: decision,
        assignedAt: new Date(now.getTime() - 2 * hour), decidedAt: decision ? new Date(now.getTime() - hour) : null,
        comments: decision === "REQUIERE_CORRECCIONES" ? "Adjunta una fotografía de la parte posterior y confirma el número de serie antes de reenviar el expediente." : decision === "RECHAZADO" ? "La procedencia declarada no permite confirmar la descripción comercial del artículo." : decision ? "Descripción, procedencia y fotografías revisadas. El artículo es apto para su publicación." : null,
      } });
    }
    if (states[i] === "ASOCIADO_SUBASTA") {
      const status: AuctionStatus = i === 1 ? "PROGRAMADA" : i === 9 ? "ADJUDICADA" : i === 10 ? "CERRADA_SIN_OFERTAS" : i === 11 ? "SUSPENDIDA" : "ACTIVA";
      const auction = await prisma.auction.create({ data: {
        id: fixedId(i + 300), articleId: id, createdById: admin.id, startingPrice: price.toFixed(2), minIncrement: "10.00", status,
        opensAt: new Date(now.getTime() + (status === "PROGRAMADA" ? hour : -3 * hour)),
        closesAt: new Date(now.getTime() + (["ADJUDICADA", "CERRADA_SIN_OFERTAS"].includes(status) ? -hour : 48 * hour)),
        closedAt: ["ADJUDICADA", "CERRADA_SIN_OFERTAS"].includes(status) ? new Date(now.getTime() - hour) : null,
      } });
      for (const [buyer, alias] of [[buyer1, "Postor-Cedro"], [buyer2, "Postor-Olivo"]] as const) {
        await prisma.auctionAlias.create({ data: { auctionId: auction.id, userId: buyer.id, alias: `Postor-${createHash("sha256").update(auction.id + buyer.id + alias).digest("hex").slice(0, 6)}` } });
      }
      if (["ACTIVA", "ADJUDICADA"].includes(status)) {
        for (let n = 0; n < 2; n++) {
          const bid = await prisma.bid.create({ data: { auctionId: auction.id, buyerId: n === 0 ? buyer1.id : buyer2.id, amount: (price + n * 10).toFixed(2), requestId: `seed-${i}-${n}`, acceptedAt: new Date(now.getTime() - (2 * hour) + n * 60000) } });
          if (n === 1 && status === "ADJUDICADA") await prisma.auction.update({ where: { id: auction.id }, data: { winnerBidId: bid.id } });
        }
      }
      await prisma.chatMessage.create({ data: { room: `auction:${auction.id}`, auctionId: auction.id, authorId: buyer1.id, text: "¿El artículo se entrega con los accesorios indicados en la descripción?" } });
    }
  }
  if (!await prisma.chatMessage.findFirst({ where: { room: "general" } })) {
    await prisma.chatMessage.createMany({ data: [
      { room: "general", authorId: buyer1.id, text: "Buenas tardes. ¿Dónde puedo consultar las próximas subastas?" },
      { room: "general", authorId: seller.id, text: "En el menú Subastas puedes filtrar por las que tienen apertura programada." },
    ] });
  }
  if (!await prisma.notification.findFirst({ where: { userId: seller.id, type: "REVISION_DECIDIDA" } })) {
    await prisma.notification.create({ data: { userId: seller.id, type: "REVISION_DECIDIDA", title: "Un artículo requiere correcciones", body: "Revisa las observaciones del expediente antes de enviarlo nuevamente a verificación.", url: `/mis-articulos/${fixedId(104)}/editar` } });
  }
  console.log("Carga completada: 9 cuentas y hasta 24 artículos exclusivos con fotografías diferentes, expedientes y subastas. Los registros previos se conservaron.");
}
main().catch((error) => { console.error("No se pudo completar la carga:", error instanceof Error ? error.message : "error inesperado"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
