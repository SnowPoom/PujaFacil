import { displayAlias } from "./aliases";
/** Presentación común. Los códigos de API y base de datos permanecen intactos. */
export const DISPLAY_LABELS: Record<string, string> = {
  COMPRADOR: "Comprador", VENDEDOR: "Vendedor", VERIFICADOR: "Verificador",
  ADMIN_SUBASTAS: "Administrador de subastas", AUDITOR: "Auditor",
  PENDIENTE: "Pendiente de aprobación", ACTIVA: "Activa", SUSPENDIDA: "Suspendida", CERRADA: "Cerrada",
  BORRADOR: "Borrador", PENDIENTE_REVISION: "Pendiente de revisión", REQUIERE_CORRECCIONES: "Requiere correcciones",
  APROBADO: "Aprobado", RECHAZADO: "Rechazado", ASOCIADO_SUBASTA: "Asociado a subasta", ARCHIVADO: "Archivado",
  PROGRAMADA: "Programada", CERRADA_SIN_OFERTAS: "Cerrada sin ofertas", ADJUDICADA: "Adjudicada", CANCELADA: "Cancelada",
  ASIGNADO: "Asignado", FOTO: "Fotografía", CERTIFICADO: "Certificado", IDENTIDAD: "Documento de identidad",
  EXITO: "Éxito", SUCCESS: "Éxito", OK: "Éxito", ERROR: "Error", FAILURE: "Error", DENEGADO: "Denegado",
  OUTBID: "Oferta superada", AUCTION_WON: "Subasta adjudicada", AUCTION_CLOSED: "Subasta finalizada",
  AUCTION_SUSPENDED: "Subasta suspendida", SUBASTA_SUSPENDIDA: "Subasta suspendida",
  AUCTION_SCHEDULED: "Subasta programada", SUBASTA_PROGRAMADA: "Subasta programada",
  SUBASTA_ACTIVADA: "Subasta activada", REVISION_ASIGNADA: "Revisión asignada", REVISION_DECIDIDA: "Revisión resuelta",
  ARCHIVO_CREADO: "Archivo adjuntado", ARCHIVO_ELIMINADO: "Archivo eliminado", IDENTIDAD_CONSULTADA: "Documento consultado",
};
export function displayLabel(code: string): string {
  return DISPLAY_LABELS[code] ?? code.replaceAll("_", " ").toLocaleLowerCase("es-EC").replace(/^./, (c) => c.toUpperCase());
}
export type StatusTone = "neutral" | "success" | "error" | "accent";
export function statusTone(code: string): StatusTone | undefined {
  if (["ACTIVA", "APROBADO", "ADJUDICADA", "EXITO", "SUCCESS", "OK"].includes(code)) return "success";
  if (["SUSPENDIDA", "CANCELADA", "RECHAZADO", "ERROR", "FAILURE", "DENEGADO"].includes(code)) return "error";
  if (["PROGRAMADA", "PENDIENTE", "PENDIENTE_REVISION", "REQUIERE_CORRECCIONES", "ASIGNADO", "ASOCIADO_SUBASTA"].includes(code)) return "accent";
  if (["BORRADOR", "ARCHIVADO", "CERRADA", "CERRADA_SIN_OFERTAS"].includes(code)) return "neutral";
}
const dateFormatter = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", dateStyle: "medium", timeStyle: "short" });
export function formatDate(value: string | Date): string {
  return dateFormatter.format(new Date(value));
}
/** Ecuador continental usa UTC−5 todo el año. */
export function toLocalDateTime(value: string): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return new Date(new Date(value).getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
export function fromLocalDateTime(value: string): string {
  return value ? `${value}:00-05:00` : "";
}

export function humanizeText(value: string): string {
  return displayAlias(value).replace(/\b[A-Z][A-Z_]{2,}\b/g, (code) => DISPLAY_LABELS[code] ?? code);
}
