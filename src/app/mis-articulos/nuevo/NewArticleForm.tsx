"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import { articleInputSchema } from "@/modules/articles/article-schema";
import { CATEGORY_OPTIONS, CONDITION_OPTIONS } from "../_components/ArticleStatusBadge";

export default function NuevoArticuloPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    condition: "",
    provenance: "",
    initialPrice: "",
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    // Validación cliente con Zod
    const validation = articleInputSchema.safeParse(formData);
    if (!validation.success) {
      const errors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !errors[field]) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validation.data),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        const createdId = data.data?.article?.id || data.data?.id;
        if (createdId) {
          router.push(`/mis-articulos/${createdId}/editar`);
        } else {
          router.push("/mis-articulos");
        }
      } else {
        setApiError(data?.error?.message || "No se pudo crear el borrador del artículo.");
        setSubmitting(false);
      }
    } catch {
      setApiError("Error de conexión al enviar los datos del artículo.");
      setSubmitting(false);
    }
  }

  return (
    <main className="pf-page">
      {/* Encabezado */}
      <div className="mb-6">
        <Link
          href="/mis-articulos"
          className="text-xs font-semibold text-[var(--pf-muted)] hover:text-[var(--pf-text)] inline-flex items-center gap-1 mb-2"
        >
          ← Volver a mis artículos
        </Link>
        <h1 className="pf-title ">
          Publicar nuevo artículo
        </h1>
        <p className="text-sm text-[var(--pf-muted)] mt-1">
          Ingresa los detalles para registrar un borrador. Luego podrás adjuntar fotografías y enviarlo a verificación.
        </p>
      </div>

      {/* Alerta de error del servidor */}
      {apiError && (
        <div className="pf-card border-[var(--pf-error-border)] bg-[var(--pf-error-bg)] mb-6 flex justify-between items-center py-3">
          <p className="pf-error font-medium my-0">{apiError}</p>
          <button
            type="button"
            className="text-xs text-[var(--pf-muted)] hover:text-[var(--pf-text)] px-2"
            onClick={() => setApiError(null)}
            aria-label="Cerrar mensaje de error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Formulario dentro de Card */}
      <Card className="max-w-3xl">
        <form onSubmit={handleSubmit} noValidate>
          {/* Título */}
          <TextField
            label="Título del artículo"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder="Ej. Reloj de bolsillo suizo de plata siglo XIX"
            error={fieldErrors.title}
            required
            disabled={submitting}
          />

          {/* Categoría y Condición en 2 columnas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="pf-field">
              <label htmlFor="category" className="pf-label">
                Categoría <span aria-hidden="true">*</span>
              </label>
              <select
                id="category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                disabled={submitting}
                className={`pf-input ${fieldErrors.category ? "pf-input--error" : ""}`}
                aria-invalid={fieldErrors.category ? true : undefined}
                aria-describedby={fieldErrors.category ? "category-error" : undefined}
              >
                <option value="">Selecciona una categoría...</option>
                {CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {fieldErrors.category && (
                <p id="category-error" className="pf-error" role="alert">
                  {fieldErrors.category}
                </p>
              )}
            </div>

            <div className="pf-field">
              <label htmlFor="condition" className="pf-label">
                Condición / Estado <span aria-hidden="true">*</span>
              </label>
              <select
                id="condition"
                name="condition"
                value={formData.condition}
                onChange={handleChange}
                disabled={submitting}
                className={`pf-input ${fieldErrors.condition ? "pf-input--error" : ""}`}
                aria-invalid={fieldErrors.condition ? true : undefined}
                aria-describedby={fieldErrors.condition ? "condition-error" : undefined}
              >
                <option value="">Selecciona una condición...</option>
                {CONDITION_OPTIONS.map((cond) => (
                  <option key={cond} value={cond}>
                    {cond}
                  </option>
                ))}
              </select>
              {fieldErrors.condition && (
                <p id="condition-error" className="pf-error" role="alert">
                  {fieldErrors.condition}
                </p>
              )}
            </div>
          </div>

          {/* Precio inicial */}
          <TextField
            label="Precio inicial (USD)"
            name="initialPrice"
            type="text"
            value={formData.initialPrice}
            onChange={handleChange}
            placeholder="150.00"
            error={fieldErrors.initialPrice}
            required
            disabled={submitting}
          />

          {/* Descripción */}
          <div className="pf-field">
            <label htmlFor="description" className="pf-label">
              Descripción detallada <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={5}
              value={formData.description}
              onChange={handleChange}
              placeholder="Detalla materiales, dimensiones, fabricante, época, marcas distintivas o cualquier defecto..."
              disabled={submitting}
              className={`pf-input ${fieldErrors.description ? "pf-input--error" : ""}`}
              aria-invalid={fieldErrors.description ? true : undefined}
              aria-describedby={fieldErrors.description ? "description-error" : undefined}
            />
            {fieldErrors.description ? (
              <p id="description-error" className="pf-error" role="alert">
                {fieldErrors.description}
              </p>
            ) : (
              <p className="text-xs text-[var(--pf-muted)] mt-1">Mínimo 20 caracteres.</p>
            )}
          </div>

          {/* Procedencia */}
          <div className="pf-field">
            <label htmlFor="provenance" className="pf-label">
              Procedencia e Historia <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="provenance"
              name="provenance"
              rows={4}
              value={formData.provenance}
              onChange={handleChange}
              placeholder="Historial de adquisición, herencia, certificados de autenticidad o galería previa..."
              disabled={submitting}
              className={`pf-input ${fieldErrors.provenance ? "pf-input--error" : ""}`}
              aria-invalid={fieldErrors.provenance ? true : undefined}
              aria-describedby={fieldErrors.provenance ? "provenance-error" : undefined}
            />
            {fieldErrors.provenance ? (
              <p id="provenance-error" className="pf-error" role="alert">
                {fieldErrors.provenance}
              </p>
            ) : (
              <p className="text-xs text-[var(--pf-muted)] mt-1">Mínimo 10 caracteres.</p>
            )}
          </div>

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--pf-border)] mt-6">
            <Link href="/mis-articulos" className="pf-btn-secondary">
              Cancelar
            </Link>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Guardando borrador…" : "Guardar borrador"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
