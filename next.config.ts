import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // El loader de Tailwind implementa el contrato webpack. Usamos webpack también
  // en desarrollo para evitar el fallo de IPC de workers de Turbopack en Windows.
  webpack(config) {
    // Añadir Tailwind a la cadena CSS existente conserva la extracción y los
    // estilos de Next. Los loaders se ejecutan de derecha a izquierda.
    for (const group of config.module.rules as { oneOf?: { use?: (string | { loader?: string })[] }[] }[]) {
      for (const rule of group.oneOf ?? []) {
        if (Array.isArray(rule.use) && rule.use.some((entry) => typeof entry === "object" && entry.loader?.includes("postcss-loader"))) {
          rule.use.push({ loader: "@tailwindcss/turbopack" });
        }
      }
    }
    return config;
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
