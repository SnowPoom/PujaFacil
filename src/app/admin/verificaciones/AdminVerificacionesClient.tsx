"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { assignReviewSchema } from "@/modules/reviews/review-schema";
import type {
  ActiveVerifierOption,
  PendingArticleAdminItem,
} from "@/modules/reviews/review-service";

interface AdminVerificacionesClientProps {
  initialArticles: PendingArticleAdminItem[];
  verifiers: ActiveVerifierOption[];
}

export default function AdminVerificacionesClient({
  initialArticles,
  verifiers,
}: AdminVerificacionesClientProps) {
  const router = useRouter();
  const [articles, setArticles] = useState<PendingArticleAdminItem[]>(initialArticles);
  const [selectedVerifiers, setSelectedVerifiers] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  function handleSelectVerifier(articleId: string, verifierId: string) {
    setSelectedVerifiers((prev) => ({ ...prev, [articleId]: verifierId }));
  }

  function resolveVerifierLabel(verifierId: string): string {
    return verifiers.find((v) => v.id === verifierId)?.label ?? `Verificador (${verifierId.slice(-6)})`;
  }

  async function handleAssign(articleId: string) {
    setFeedback(null);
    const verifierId = selectedVerifiers[articleId] ?? "";

    const parsed = assignReviewSchema.safeParse({ articleId, verifierId });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Selecciona un verificador válido.";
      setFeedback({ type: "error", text: msg });
      return;
    }

    setSubmittingId(articleId);
    try {
      const response = await fetch("/api/admin/reviews/assign", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = (await response.json().catch(() => null)) as
        | {
            ok: true;
            data: {
              review: {
                id: string;
                articleId: string;
                verifierId: string;
                assignedAt: string;
              };
            };
          }
        | { ok: false; error?: { code?: string; message?: string } }
        | null;

      if (!response.ok || !body || !body.ok) {
        const message =
          (body && !body.ok && body.error?.message) ||
          "No se pudo asignar el verificador al artículo.";
        setFeedback({ type: "error", text: message });
        return;
      }

      const createdReview = body.data.review;
      const label = resolveVerifierLabel(createdReview.verifierId);

      setArticles((prev) =>
        prev.map((item) =>
          item.id === articleId
            ? {
                ...item,
                openReview: {
                  id: createdReview.id,
                  verifierId: createdReview.verifierId,
                  assignedAt: createdReview.assignedAt,
                },
              }
            : item,
        ),
      );

      setFeedback({
        type: "success",
        text: `Artículo asignado correctamente a ${label}.`,
      });
      router.refresh();
    } catch {
      setFeedback({
        type: "error",
        text: "Error de conexión al intentar asignar el verificador.",
      });
    } finally {
      setSubmittingId(null);
    }
  }

  const unassignedCount = articles.filter((a) => !a.openReview).length;

  return (
    <>
      {feedback && (
        <Card>
          <p
            className={feedback.type === "error" ? "pf-error" : "pf-success"}
            role={feedback.type === "error" ? "alert" : "status"}
          >
            {feedback.text}
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold">Artículos pendientes de verificación</h2>
          <div className="flex items-center gap-2">
            <Badge variant="accent">{unassignedCount} por asignar</Badge>
            <Badge variant="neutral">{articles.length} en revisión</Badge>
          </div>
        </div>

        {articles.length === 0 ? (
          <p className="text-sm opacity-80 py-4" role="status">
            No hay artículos pendientes de revisión en este momento.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Artículo</th>
                  <th>Categoría</th>
                  <th>Precio inicial (USD)</th>
                  <th>Adjuntos</th>
                  <th>Estado</th>
                  <th>Verificador activo</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((item) => {
                  const isAssigned = Boolean(item.openReview);
                  const isSubmitting = submittingId === item.id;

                  return (
                    <tr key={item.id}>
                      <td className="font-mono text-xs">{item.id}</td>
                      <td>
                        <div className="font-semibold">{item.title}</div>
                        <div className="text-xs opacity-75">{item.condition}</div>
                      </td>
                      <td>{item.category}</td>
                      <td className="font-mono">${item.initialPrice}</td>
                      <td className="text-xs">
                        {item.photosCount} foto(s) ·{" "}
                        {item.hasCertificate ? "Con certificado" : "Sin certificado"}
                      </td>
                      <td>
                        <Badge variant={isAssigned ? "success" : "accent"}>
                          {isAssigned ? "ASIGNADO" : "PENDIENTE_REVISION"}
                        </Badge>
                      </td>
                      <td>
                        {item.openReview ? (
                          <span className="text-xs font-medium">
                            {resolveVerifierLabel(item.openReview.verifierId)}
                          </span>
                        ) : (
                          <select
                            aria-label={`Seleccionar verificador para ${item.title}`}
                            className="pf-input"
                            value={selectedVerifiers[item.id] ?? ""}
                            onChange={(e) => handleSelectVerifier(item.id, e.target.value)}
                            disabled={isSubmitting || verifiers.length === 0}
                          >
                            <option value="">Seleccionar verificador…</option>
                            {verifiers.map((verif) => (
                              <option key={verif.id} value={verif.id}>
                                {verif.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        <Button
                          type="button"
                          disabled={isAssigned || isSubmitting || verifiers.length === 0}
                          onClick={() => handleAssign(item.id)}
                        >
                          {isSubmitting ? "Asignando…" : "Asignar"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
