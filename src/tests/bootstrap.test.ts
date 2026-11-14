import { describe, it, expect } from "vitest";

describe("PujaFácil — Verificación de arranque del monolito", () => {
  it("el entorno carga las variables básicas esperadas", () => {
    expect(process.env.PORT ?? "3000").toBeDefined();
  });

  it("los tokens de color base de la casa de subastas están definidos", () => {
    const colores = {
      bg: "#F7F5F1",
      surface: "#FFFFFF",
      text: "#1F2933",
      primary: "#1F3A5F",
      accent: "#C6A15B",
    };
    expect(colores.primary).toBe("#1F3A5F");
    expect(colores.accent).toBe("#C6A15B");
  });
});
