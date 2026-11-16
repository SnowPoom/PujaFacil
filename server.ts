import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import next from "next";
import { Server } from "socket.io";
import { registerSocketHandlers } from "@/server/socket/index";

const dev = process.env.NODE_ENV !== "production";

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const port = Number(process.env.PORT ?? 3000);
  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;

  let nodeServer: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

  if (keyPath && certPath) {
    nodeServer = createHttpsServer(
      { key: readFileSync(keyPath), cert: readFileSync(certPath) },
      (req, res) => handle(req, res)
    );
    console.log(`[server] Modo HTTPS — certs: ${keyPath}, ${certPath}`);
  } else if (keyPath || certPath) {
    console.error(
      "[server] ERROR: Debes configurar AMBAS variables HTTPS_KEY_PATH y HTTPS_CERT_PATH, o dejar las dos vacías."
    );
    process.exit(1);
  } else {
    nodeServer = createHttpServer((req, res) => handle(req, res));
    console.log("[server] Modo HTTP (desarrollo local sin TLS)");
  }

  const io = new Server(nodeServer, { path: "/socket.io" });
  registerSocketHandlers(io);

  nodeServer.listen(port, () => {
    const proto = keyPath && certPath ? "https" : "http";
    console.log(`[server] Escuchando en ${proto}://localhost:${port}`);
  });
});
