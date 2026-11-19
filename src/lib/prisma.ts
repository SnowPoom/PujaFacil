import { PrismaClient } from "@prisma/client";

// Instancia singleton de PrismaClient.
// Evita múltiples conexiones durante el hot-reload de Next.js en modo desarrollo.
declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development" && process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
