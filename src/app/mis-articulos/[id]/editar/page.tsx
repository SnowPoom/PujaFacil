"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { articleInputSchema } from "@/modules/articles/article-schema";
import ArticleStatusBadge, {
  ArticleItem,
  ARTICLE_STATUS_CONFIG,
  CATEGORY_OPTIONS,
  CONDITION_OPTIONS,
} from "../../_components/ArticleStatusBadge";

function EditarArticuloContent() {
  const params = useParams();
  const router = useRouter();

  const id =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
      ? params.id[0]
      : "";

  const [article, setArticle] = useState<ArticleItem | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    condition: "",
    provenance: "",
    initialPrice: "",
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    let isMounted = true;

    async function fetchArticle() {
      try {
        const res = await fetch(`/api/articles/${id}`, {
          credentials: "same-origin",
        });

        if (!isMounted) return;

        if (!res.ok) {
          setHttpStatus(res.status);
          const data = await res.json().catch(() => null);
          setApiError(data?.error?.message || "No se pudo cargar el artículo.");
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (data?.ok && data?.data?.article) {
          const item: ArticleItem = data.data.article;
          setArticle(item);
          setFormData({
            title: item.title,
            description: item.description,
            category: item.category,
            condition: item.condition,
            provenance: item.provenance,
            initialPrice: item.initialPrice,
          });
          setHttpStatus(null);
        } else {
          setApiError(data?.error?.message || "Error al consultar los datos del artículo.");
        }
      } catch {
        if (isMounted) {
          setApiError("Error de red al consultar el artículo.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchArticle();

    return () => {
      isMounted = false;
    };
  }, [id]);

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

  async function handleSaveChanges(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setApiError(null);
    setSuccessMsg(null);

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
      return false;
    }

    setSaving(true);

    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validation.data),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok && data?.data?.article) {
        setArticle(data.data.article);
        setSuccessMsg("Cambios guardados exitosamente.");
        return true;
      } else {
        setApiError(data?.error?.message || "No se pudieron guardar los cambios.");
        return false;
      }
    } catch {
      setApiError("Error de conexión al guardar los cambios.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForReview() {
    setApiError(null);
    setSuccessMsg(null);
    setSubmittingReview(true);

    try {
      const res = await fetch(`/api/articles/${id}/submit`, {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok && data?.data?.article) {
        setArticle(data.data.article);
        setSuccessMsg(
          "Artículo enviado a revisión con éxito. Un verificador evaluará la publicación."
        );
      } else {
        setApiError(
          data?.error?.message ||
            "No se pudo enviar el artículo a verificación. Asegúrate de adjuntar al menos una fotografía."
        );
      }
    } catch {
      setApiError("Error de conexión al enviar el artículo a verificación.");
    } finally {
      setSubmittingReview(false);
    }
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    setApiError(null);

    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        router.push("/mis-articulos");
      } else {
        setApiError(data?.error?.message || "No se pudo eliminar el borrador.");
        setConfirmDeleteOpen(false);
        setDeleting(false);
      }
    } catch {
      setApiError("Error de conexión al eliminar el borrador.");
      setConfirmDeleteOpen(false);
      setDeleting(false);
    }
  }

  // Vista de carga
  if (loading) {
    return (
      <main className="pf-page">
        <Card className="text-center py-12 max-w-lg mx-auto">
          <p className="text-sm text-slate-600 font-medium">Cargando artículo...</p>
        </Card>
      </main>
    );
  }

  // Vista de error 404 o 403
  if (httpStatus === 404 || httpStatus === 403 || (!article && !loading)) {
    return (
      <main className="pf-page">
        <Card className="text-center py-12 max-w-lg mx-auto">
          <h1 className="text-xl font-bold mb-3 text-slate-800">
            {httpStatus === 403 ? "Acceso denegado" : "Artículo no encontrado"}
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            {httpStatus === 403
              ? "No tienes los permisos requeridos para acceder a este artículo."
              : "El artículo solicitado no existe o no se encuentra asociado a tu cuenta."}
          </p>
          <Link href="/mis-articulos" className="pf-btn">
            Volver a Mis artículos
          </Link>
        </Card>
      </main>
    );
  }

  if (!article) return null;

  const isEditable =
    article.status === "BORRADOR" || article.status === "REQUIERE_CORRECCIONES";

  return (
    <main className="pf-page">
      {/* Navegación y encabezado */}
      <div className="mb-6">
        <Link
          href="/mis-articulos"
          className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 mb-2"
        >
          ← Volver a Mis artículos
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {isEditable ? "Editar artículo" : "Detalle del artículo"}
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Código de referencia: <span className="font-mono text-xs">{article.id}</span>
            </p>
          </div>
          <div>
            <ArticleStatusBadge status={article.status} />
          </div>
        </div>
      </div>

      {/* Alertas de feedback */}
      {successMsg && (
        <div className="pf-card border-green-200 bg-green-50 mb-6 flex justify-between items-center py-3">
          <p className="pf-success font-medium my-0">{successMsg}</p>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-800 px-2"
            onClick={() => setSuccessMsg(null)}
            aria-label="Cerrar mensaje"
          >
            ✕
          </button>
        </div>
      )}

      {apiError && (
        <div className="pf-card border-red-200 bg-red-50 mb-6 flex justify-between items-center py-3">
          <p className="pf-error font-medium my-0">{apiError}</p>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-800 px-2"
            onClick={() => setApiError(null)}
            aria-label="Cerrar mensaje de error"
          >
            ✕
          </button>
        </div>
      )}

      {/* MODO LECTURA: cuando no es editable */}
      {!isEditable ? (
        <Card className="max-w-3xl">
          {/* Banner de estado no editable */}
          <div className="pf-card bg-amber-50 border-amber-200 mb-6 py-3">
            <p className="text-sm text-amber-900 my-0 font-medium">
              ℹ️ Este artículo se encuentra en estado{" "}
              <strong>
                {ARTICLE_STATUS_CONFIG[article.status]?.label || article.status}
              </strong>{" "}
              y no admite modificaciones en este momento.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="pf-label text-slate-500 mb-1">Título del artículo</h2>
              <p className="text-lg font-semibold text-slate-900">{article.title}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h2 className="pf-label text-slate-500 mb-1">Categoría</h2>
                <p className="text-sm font-medium text-slate-800">{article.category}</p>
              </div>
              <div>
                <h2 className="pf-label text-slate-500 mb-1">Condición</h2>
                <p className="text-sm font-medium text-slate-800">{article.condition}</p>
              </div>
            </div>

            <div>
              <h2 className="pf-label text-slate-500 mb-1">Precio inicial</h2>
              <p className="text-lg font-bold text-slate-900">${article.initialPrice} USD</p>
            </div>

            <div>
              <h2 className="pf-label text-slate-500 mb-1">Descripción</h2>
              <p className="text-sm text-slate-700 whitespace-pre-line bg-slate-50 p-4 rounded-lg border border-slate-200">
                {article.description}
              </p>
            </div>

            <div>
              <h2 className="pf-label text-slate-500 mb-1">Procedencia e Historia</h2>
              <p className="text-sm text-slate-700 whitespace-pre-line bg-slate-50 p-4 rounded-lg border border-slate-200">
                {article.provenance}
              </p>
            </div>

            {article.files && article.files.length > 0 && (
              <div>
                <h2 className="pf-label text-slate-500 mb-1">Fotografías y Archivos</h2>
                <p className="text-sm text-slate-700">
                  {article.files.length} archivo(s) asociado(s).
                </p>
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-slate-200 mt-6 flex justify-end">
            <Link href="/mis-articulos" className="pf-btn-secondary">
              Volver a Mis artículos
            </Link>
          </div>
        </Card>
      ) : (
        /* MODO EDICIÓN: BORRADOR o REQUIERE_CORRECCIONES */
        <Card className="max-w-3xl">
          {article.status === "REQUIERE_CORRECCIONES" && (
            <div className="pf-card bg-amber-50 border-amber-200 mb-6 py-3">
              <p className="text-sm text-amber-900 my-0 font-medium">
                ⚠️ Este artículo requiere correcciones antes de ser aprobado. Revisa los datos y vuelve a enviarlo a revisión.
              </p>
            </div>
          )}

          <form onSubmit={handleSaveChanges} noValidate>
            {/* Título */}
            <TextField
              label="Título del artículo"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="Ej. Reloj de bolsillo suizo de plata siglo XIX"
              error={fieldErrors.title}
              required
              disabled={saving || submittingReview}
            />

            {/* Categoría y Condición */}
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
                  disabled={saving || submittingReview}
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
                  disabled={saving || submittingReview}
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
              disabled={saving || submittingReview}
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
                placeholder="Detalla materiales, dimensiones, fabricante, época..."
                disabled={saving || submittingReview}
                className={`pf-input ${fieldErrors.description ? "pf-input--error" : ""}`}
                aria-invalid={fieldErrors.description ? true : undefined}
                aria-describedby={fieldErrors.description ? "description-error" : undefined}
              />
              {fieldErrors.description ? (
                <p id="description-error" className="pf-error" role="alert">
                  {fieldErrors.description}
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">Mínimo 20 caracteres.</p>
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
                placeholder="Historial de adquisición, herencia, certificados de autenticidad..."
                disabled={saving || submittingReview}
                className={`pf-input ${fieldErrors.provenance ? "pf-input--error" : ""}`}
                aria-invalid={fieldErrors.provenance ? true : undefined}
                aria-describedby={fieldErrors.provenance ? "provenance-error" : undefined}
              />
              {fieldErrors.provenance ? (
                <p id="provenance-error" className="pf-error" role="alert">
                  {fieldErrors.provenance}
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">Mínimo 10 caracteres.</p>
              )}
            </div>

            {/* Acciones del formulario */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-6 border-t border-slate-200 mt-6">
              <div className="flex items-center gap-2">
                <Link href="/mis-articulos" className="pf-btn-secondary">
                  Volver
                </Link>
                {article.status === "BORRADOR" && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || submittingReview}
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    Eliminar borrador
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={saving || submittingReview}
                >
                  {saving ? "Guardando…" : "Guardar cambios"}
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  disabled={saving || submittingReview}
                  onClick={handleSubmitForReview}
                >
                  {submittingReview ? "Enviando…" : "Enviar a revisión"}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* Diálogo para eliminar borrador */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="¿Eliminar borrador?"
        message="Esta acción no se puede deshacer. Se eliminarán permanentemente los datos del artículo."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deleting}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
      />
    </main>
  );
}

export default function EditarArticuloPage() {
  return (
    <Suspense
      fallback={
        <main className="pf-page">
          <div className="pf-card text-center py-12">Cargando artículo...</div>
        </main>
      }
    >
      <EditarArticuloContent />
    </Suspense>
  );
}
