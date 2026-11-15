"use client";

import React, { useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { assignReviewSchema } from "@/modules/reviews/review-schema";

interface PendingArticleRow {
  id: string;
  title: string;
  category: string;
  initialPrice: string;
  submittedAt: string;
  assignedVerifierName?: string;
}

interface ActiveVerifierOption {
  id: string;
  label: string;
}

const INITIAL_PENDING_ARTICLES: PendingArticleRow[] = [
  {
    id: "art-pend-101",
    title: "Violín Europeo Maestro Luthier s. XIX",
    category: "Instrumentos Musicales",
    initialPrice: "2400.00",
    submittedAt: "2026-11-14T09:20:00Z",
  },
  {
    id: "art-pend-102",
    title: "Manuscrito Iluminado Facsimilar Numerado",
    category: "Libros y Manuscritos",
    initialPrice: "680.00",
    submittedAt: "2026-11-14T10:05:00Z",
  },
];

const ACTIVE_VERIFIERS: ActiveVerifierOption[] = [
  { id: "verif-demo-01", label: "Verificador Especialista #01 (ACTIVA)" },
  { id: "verif-demo-02", label: "Verificador Documental #02 (ACTIVA)" },
];

export default function AdminVerificacionesPage() {
  const [articles, setArticles] = useState<PendingArticleRow[]>(INITIAL_PENDING_ARTICLES);
  const [selectedVerifiers, setSelectedVerifiers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  function handleSelectVerifier(articleId: string, verifierId: string) {
    setSelectedVerifiers((prev) => ({ ...prev, [articleId]: verifierId }));
  }

  function handleAssign(articleId: string) {
    setFeedback(null);
    const verifierId = selectedVerifiers[articleId] ?? "";

    const parsed = assignReviewSchema.safeParse({ articleId, verifierId });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Selecciona un verificador válido.";
      setFeedback({ type: "error", text: msg });
      return;
    }

    const verifierObj = ACTIVE_VERIFIERS.find((v) => v.id === parsed.data.verifierId);
    setArticles((prev) =>
      prev.map((art) =>
        art.id === articleId
          ? { ...art, assignedVerifierName: verifierObj?.label ?? parsed.data.verifierId }
          : art
      )
    );
    setFeedback({
      type: "success",
      text: `Artículo ${articleId} asignado a ${verifierObj?.label ?? verifierId}.`,
    });
  }

  return (
    <main className="pf-page space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pf-primary)" }}>
            Asignación de Verificaciones
          </h1>
          <p className="text-sm mt-1">
            Asigna los artículos recibidos a verificadores activos para su revisión documental.
          </p>
        </div>
        <Link href="/admin" className="pf-btn-secondary">
          ← Volver a Administración
        </Link>
      </div>

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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Artículos pendientes de asignación</h2>
          <Badge variant="accent">{articles.length} en cola</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Artículo</th>
                <th>Categoría</th>
                <th>Precio inicial (USD)</th>
                <th>Estado</th>
                <th>Verificador activo</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((item) => (
                <tr key={item.id}>
                  <td className="font-mono text-xs">{item.id}</td>
                  <td className="font-semibold">{item.title}</td>
                  <td>{item.category}</td>
                  <td className="font-mono">${item.initialPrice}</td>
                  <td>
                    <Badge variant={item.assignedVerifierName ? "success" : "accent"}>
                      {item.assignedVerifierName ? "ASIGNADO" : "PENDIENTE_REVISION"}
                    </Badge>
                  </td>
                  <td>
                    {item.assignedVerifierName ? (
                      <span className="text-xs font-medium">{item.assignedVerifierName}</span>
                    ) : (
                      <select
                        aria-label={`Seleccionar verificador para ${item.title}`}
                        className="pf-input"
                        value={selectedVerifiers[item.id] ?? ""}
                        onChange={(e) => handleSelectVerifier(item.id, e.target.value)}
                      >
                        <option value="">Seleccionar verificador…</option>
                        {ACTIVE_VERIFIERS.map((verif) => (
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
                      disabled={Boolean(item.assignedVerifierName)}
                      onClick={() => handleAssign(item.id)}
                    >
                      Asignar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
