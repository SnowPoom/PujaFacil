"use client";

import React, { useState } from "react";
import Button from "@/components/ui/Button";
import {
  decideReviewSchema,
  type ReviewDecisionType,
} from "@/modules/reviews/review-schema";

interface ReviewDecisionFormProps {
  reviewId: string;
}

export default function ReviewDecisionForm({ reviewId }: ReviewDecisionFormProps) {
  const [decision, setDecision] = useState<ReviewDecisionType>("APROBADO");
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const parsed = decideReviewSchema.safeParse({ decision, comments });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setError(firstIssue?.message ?? "Verifica los datos ingresados.");
      return;
    }

    setSubmitting(true);
    // En la jornada del domingo 15 se conectará a POST /api/verification/[id]/decision
    setTimeout(() => {
      setSubmitting(false);
      setSuccessMsg(
        `Resolución "${parsed.data.decision}" validada para el expediente ${reviewId}. Lista para persistir.`
      );
    }, 250);
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
          disabled={submitting}
        >
          <option value="APROBADO">APROBADO — Habilitar para programación de subasta</option>
          <option value="REQUIERE_CORRECCIONES">
            REQUIERE_CORRECCIONES — Solicitar ajustes al vendedor
          </option>
          <option value="RECHAZADO">RECHAZADO — Denegar publicación comercial</option>
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
          disabled={submitting}
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
        <Button type="submit" disabled={submitting}>
          {submitting ? "Registrando dictamen…" : "Emitir resolución"}
        </Button>
      </div>
    </form>
  );
}
