import { describe, expect, it } from "vitest";
import { displayLabel, formatDate, fromLocalDateTime, statusTone, toLocalDateTime } from "@/lib/presentation";
describe("Presentación coherente sin alterar contratos", () => {
 it("presenta códigos comerciales y ambos formatos de notificación en español", () => {
  expect(displayLabel("REQUIERE_CORRECCIONES")).toBe("Requiere correcciones");
  expect(displayLabel("SUBASTA_PROGRAMADA")).toBe(displayLabel("AUCTION_SCHEDULED"));
  expect(statusTone("SUSPENDIDA")).toBe("error");
  expect(statusTone("REQUIERE_CORRECCIONES")).toBe("accent");
 });
 it("muestra Ecuador y transforma la fecha del control sin desplazar la hora", () => {
  const value = "2026-11-19T15:30:00Z";
  expect(toLocalDateTime(value)).toBe("2026-11-19T10:30");
  expect(new Date(fromLocalDateTime("2026-11-19T10:30")).toISOString()).toBe("2026-11-19T15:30:00.000Z");
  expect(formatDate(value)).toContain("10:30"); expect(toLocalDateTime("")).toBe("");
 });
});
