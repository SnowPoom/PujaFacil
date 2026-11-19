"use client";

import React from "react";
import Badge from "@/components/ui/Badge";

export type ArticleStatus =
  | "BORRADOR"
  | "PENDIENTE_REVISION"
  | "REQUIERE_CORRECCIONES"
  | "APROBADO"
  | "RECHAZADO"
  | "ASOCIADO_SUBASTA"
  | "ARCHIVADO";

export interface FileRecordSummary {
  id: string;
  kind: "IDENTIDAD" | "FOTO" | "CERTIFICADO";
  mimeType: string;
  originalName: string;
  size: number;
  createdAt: string;
}

export interface ArticleItem {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  provenance: string;
  initialPrice: string;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
  files?: FileRecordSummary[];
  reviews?: { id: string; status: string | null; comments: string | null; assignedAt: string; decidedAt: string | null }[];
}

export const ARTICLE_STATUS_CONFIG: Record<
  ArticleStatus,
  { label: string; variant: "neutral" | "success" | "error" | "accent" }
> = {
  BORRADOR: {
    label: "Borrador",
    variant: "neutral",
  },
  PENDIENTE_REVISION: {
    label: "Pendiente de revisión",
    variant: "accent",
  },
  REQUIERE_CORRECCIONES: {
    label: "Requiere correcciones",
    variant: "accent",
  },
  APROBADO: {
    label: "Aprobado",
    variant: "success",
  },
  RECHAZADO: {
    label: "Rechazado",
    variant: "error",
  },
  ASOCIADO_SUBASTA: {
    label: "En subasta",
    variant: "accent",
  },
  ARCHIVADO: {
    label: "Archivado",
    variant: "neutral",
  },
};

export const CATEGORY_OPTIONS = [
  "Arte",
  "Joyería",
  "Relojería",
  "Coleccionables",
  "Antigüedades",
  "Vehículos",
  "Otros",
] as const;

export const CONDITION_OPTIONS = [
  "Nuevo",
  "Excelente",
  "Muy bueno",
  "Bueno",
  "Restaurado",
] as const;

export default function ArticleStatusBadge({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  const config =
    ARTICLE_STATUS_CONFIG[status as ArticleStatus] || {
      label: status,
      variant: "neutral" as const,
    };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
