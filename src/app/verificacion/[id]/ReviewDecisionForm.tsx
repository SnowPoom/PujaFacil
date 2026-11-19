"use client";
import { displayLabel } from "@/lib/presentation";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import {
  decideReviewSchema,
  type ReviewDecisionType,
} from "@/modules/reviews/review-schema";

interface ReviewDecisionFormProps {
  reviewId: string;
}

export default function ReviewDecisionForm({ reviewId }: ReviewDecisionFormProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<ReviewDecisionType>("APROBADO");
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (completed || submitting) return;

    setError(null);
    setSuccessMsg(null);

    const parsed = decideReviewSchema.safeParse({ decision, comments });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setError(firstIssue?.message ?? "Verifica los datos ingresados.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/verification/${encodeURIComponent(reviewId)}/decision`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = (await response.json().catch(() => null)) as
        | {
            ok: true;
            data: {
              review: { id: string; status: ReviewDecisionType | null };
              articleStatus: ReviewDecisionType;
            };
          }
        | { ok: false; error?: { code?: string; message?: string } }
        | null;

      if (!response.ok || !body || !body.ok) {
        const message =
          (body && !body.ok && body.error?.message) ||
          "No se pudo registrar la resolución del expediente.";
        setError(message);
        return;
      }

      setCompleted(true);
      setSuccessMsg(
        `Dictamen "${displayLabel(body.data.articleStatus)}" registrado exitosamente para el expediente ${reviewId}.`,
      );
      router.refresh();
    } catch {
      setError("Error de conexión al intentar guardar el dictamen.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="pf-field">
        <label htmlFor="decision-select" className="pf-label">
          Dictamen de verificación <span aria-hidden="true">*</span>
        </label>
        <select
          id="decision-select"
          name="decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value as ReviewDecisionType)}
          className="pf-input"
          disabled={submitting || completed}
        >
          <option value="APROBADO">Aprobar — Habilitar para programación de subasta</option>
          <option value="REQUIERE_CORRECCIONES">
            Solicitar correcciones — Solicitar ajustes al vendedor
          </option>
          <option value="RECHAZADO">Rechazar — Denegar publicación comercial</option>
        </select>
      </div>

      <div className="pf-field">
        <label htmlFor="review-comments" className="pf-label">
          Observaciones y justificación documental (5 a 1000 caracteres){" "}
          <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="review-comments"
          name="comments"
          rows={4}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Detalla la revisión de fotografías, procedencia declarada y certificados adjuntos..."
          className={`pf-input${error ? " pf-input--error" : ""}`}
          disabled={submitting || completed}
          required
        />
        <p className="text-xs mt-1 opacity-75">{comments.trim().length} / 1000 caracteres</p>
      </div>

      {error && (
        <p className="pf-error" role="alert">
          {error}
        </p>
      )}

      {successMsg && (
        <p className="pf-success" role="status">
          {successMsg}
        </p>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <Button type="submit" disabled={submitting || completed}>
          {submitting
            ? "Registrando dictamen…"
            : completed
              ? "Dictamen registrado"
              : "Emitir resolución"}
        </Button>
      </div>
    </form>
  );
}
