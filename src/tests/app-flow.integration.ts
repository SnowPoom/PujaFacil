/** Recorrido real sobre la instancia local. Crea un artículo comercial y elimina un borrador temporal propio. */
import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
loadEnvConfig(process.cwd());
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:3000";
async function call(path: string, cookie = "", method = "GET", input?: unknown) {
 const response = await fetch(origin + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(input instanceof FormData || input === undefined ? {} : { "Content-Type": "application/json" }) }, body: input instanceof FormData ? input : input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(60000) });
 const json = await response.json(); return { response, json };
}
async function ok(path: string, cookie = "", method = "GET", input?: unknown) {
 const result = await call(path, cookie, method, input);
 assert(result.response.ok && result.json.ok, `${method} ${path}: ${JSON.stringify(result.json)}`);
 return result.json.data;
}
async function login(email: string) {
 const { response, json } = await call("/api/auth/login", "", "POST", { email, password: process.env.DEMO_PASSWORD });
 assert(response.ok && json.ok, JSON.stringify(json));
 return { cookie: response.headers.get("set-cookie")!.split(";")[0], user: json.data.user };
}
const sockets: Socket[] = [];
async function connect(cookie: string, room: string) {
 const socket = io(origin, { autoConnect: false, transports: ["websocket"], reconnection: false, extraHeaders: { Cookie: cookie, Origin: origin } });
 sockets.push(socket);
 await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); socket.connect(); });
 assert.equal(socket.io.engine.transport.name, "websocket");
 const ack = await socket.timeout(10000).emitWithAck("chat:join", { room }); assert(ack.ok, JSON.stringify(ack));
 return socket;
}
async function main() {
 const admin = await login("admin@pujafacil.test"), seller = await login("vendedor@pujafacil.test"), verifier = await login("verificador@pujafacil.test");
 const buyer1 = await login("comprador1@pujafacil.test"), buyer2 = await login("comprador2@pujafacil.test");
 console.log("Acceso real de cinco cuentas: correcto.");
 const data = { title: "Cronógrafo de colección de Quito", description: "Cronógrafo de esfera clara con caja plateada y correa de cuero marrón, conservado en una colección particular de Quito.", category: "Relojería", condition: "Excelente", provenance: "Colección particular de Quito, con registro de adquisición y conservación en estuche.", initialPrice: "1850.00" };
 const disposable = await ok("/api/articles", seller.cookie, "POST", data);
 const draftId = disposable.article.id;
 await ok(`/api/articles/${draftId}`, seller.cookie, "PATCH", { title: "Cronógrafo de colección con estuche" });
 await ok(`/api/articles/${draftId}`, seller.cookie, "DELETE");
 assert.equal((await call(`/api/articles/${draftId}`, seller.cookie)).response.status, 404);
 console.log("Crear, consultar, actualizar y eliminar borrador: correcto.");
 const article = (await ok("/api/articles", seller.cookie, "POST", data)).article;
 const photo = new FormData(); photo.set("articleId", article.id); photo.set("kind", "FOTO"); photo.set("file", new File([new Uint8Array(await readFile("prisma/assets/reloj.jpg"))], "reloj.jpg", { type: "image/jpeg" }));
 await ok("/api/files", seller.cookie, "POST", photo);
 await ok(`/api/articles/${article.id}/submit`, seller.cookie, "POST");
 let review = (await ok("/api/admin/reviews/assign", admin.cookie, "POST", { articleId: article.id, verifierId: verifier.user.id })).review;
 const comments = "Confirma la procedencia y adjunta la referencia del estuche de conservación.";
 await ok(`/api/verification/${review.id}/decision`, verifier.cookie, "POST", { decision: "REQUIERE_CORRECCIONES", comments });
 let own = (await ok(`/api/articles/${article.id}`, seller.cookie)).article;
 assert.equal(own.reviews[0].comments, comments);
 await ok(`/api/articles/${article.id}`, seller.cookie, "PATCH", { provenance: "Colección particular de Quito. Estuche de conservación incluido y referencia de adquisición documentada." });
 await ok(`/api/articles/${article.id}/submit`, seller.cookie, "POST");
 review = (await ok("/api/admin/reviews/assign", admin.cookie, "POST", { articleId: article.id, verifierId: verifier.user.id })).review;
 await ok(`/api/verification/${review.id}/decision`, verifier.cookie, "POST", { decision: "APROBADO", comments: "Procedencia y fotografías revisadas. Expediente apto para programación." });
 own = (await ok(`/api/articles/${article.id}`, seller.cookie)).article; assert.equal(own.status, "APROBADO"); assert.equal(own.reviews.length, 2);
 console.log("Fotografía, revisión, observaciones del vendedor, reenvío y aprobación: correctos.");
 const now = Date.now();
 const auction = await ok("/api/auctions", admin.cookie, "POST", { articleId: article.id, startingPrice: "1850.00", minIncrement: "25.00", opensAt: new Date(now - 60000).toISOString(), closesAt: new Date(now + 60000).toISOString() });
 await ok(`/api/admin/auctions/${auction.id}/activate`, admin.cookie, "POST");
 const s1 = await connect(buyer1.cookie, `auction:${auction.id}`), s2 = await connect(buyer2.cookie, `auction:${auction.id}`);
 const updated = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("No llegó auction:updated")), 10000); s2.once("auction:updated", () => { clearTimeout(timer); resolve(); }); });
 const id = randomUUID();
 const first = await ok(`/api/auctions/${auction.id}/bids`, buyer1.cookie, "POST", { amount: "1850.00", requestId: id });
 await updated;
 const duplicate = await ok(`/api/auctions/${auction.id}/bids`, buyer1.cookie, "POST", { amount: "1850.00", requestId: id }); assert.equal(first.id, duplicate.id);
 const concurrent = await Promise.all([call(`/api/auctions/${auction.id}/bids`, buyer1.cookie, "POST", { amount: "1875.00", requestId: randomUUID() }), call(`/api/auctions/${auction.id}/bids`, buyer2.cookie, "POST", { amount: "1875.00", requestId: randomUUID() })]);
 assert.deepEqual(concurrent.map((r) => r.response.status).sort(), [201, 409]);
 const message = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("No llegó chat:new")), 10000); s2.once("chat:new", () => { clearTimeout(timer); resolve(); }); });
 const sent = await s1.timeout(10000).emitWithAck("chat:send", { room: `auction:${auction.id}`, text: "Buenas noches. La información del expediente está completa; gracias por la aclaración.", clientMessageId: randomUUID() }); assert(sent.ok); await message;
 console.log("Dos clientes WebSocket reales, chat, puja en vivo, idempotencia y concurrencia: correctos.");
 let closed = false;
 for (let i = 0; i < 75; i++) { const snapshot = await ok(`/api/auctions/${auction.id}`); if (snapshot.status === "ADJUDICADA") { assert(snapshot.winnerAlias); closed = true; break; } await delay(1000); }
 assert(closed, "La subasta no se adjudicó automáticamente");
 assert.equal((await call(`/api/auctions/${auction.id}/bids`, buyer1.cookie, "POST", { amount: "1900.00", requestId: randomUUID() })).response.status, 409);
 console.log("Cierre automático, ganador y rechazo tras cierre: correctos.");
 for (const [cookie, paths] of [[seller.cookie, ["/panel", "/perfil", "/mis-articulos", "/mis-articulos/nuevo", `/mis-articulos/${article.id}/editar`, "/mis-subastas", "/notificaciones", "/chat"]], [admin.cookie, ["/admin", "/admin/subastas", "/admin/usuarios", "/admin/verificaciones"]], [verifier.cookie, ["/verificacion", `/verificacion/${review.id}`]], [buyer1.cookie, ["/mis-ofertas", `/subastas/${auction.id}`]]] as const) {
  for (const path of paths) { const page = await fetch(origin + path, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(60000) }); assert.equal(page.status, 200, path); }
 }
 console.log(`Pantallas privadas por rol: correctas. Subasta creada: ${auction.id}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { for (const socket of sockets) socket.disconnect(); });
