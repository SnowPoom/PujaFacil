"use client";
import { formatDate } from "@/lib/presentation";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import Badge from "@/components/ui/Badge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { articleInputSchema } from "@/modules/articles/article-schema";
import {
  ArticleItem,
  CATEGORY_OPTIONS,
  CONDITION_OPTIONS,
} from "../../_components/ArticleStatusBadge";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "neutral" | "success" | "error" | "accent" }
> = {
  BORRADOR: { label: "Borrador", variant: "neutral" },
  PENDIENTE_REVISION: { label: "Pendiente de revisión", variant: "accent" },
  REQUIERE_CORRECCIONES: { label: "Requiere correcciones", variant: "accent" },
  APROBADO: { label: "Aprobado", variant: "success" },
  RECHAZADO: { label: "Rechazado", variant: "error" },
  ASOCIADO_SUBASTA: { label: "Asociado a subasta", variant: "accent" },
  ARCHIVADO: { label: "Archivado", variant: "neutral" },
};

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

  // Estados para subida de archivos
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileSuccess, setFileSuccess] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const certInputRef = useRef<HTMLInputElement>(null);

  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadArticle = useCallback(async () => {
    if (!id) return;

    try {
      const res = await fetch(`/api/articles/${id}`, {
        credentials: "same-origin",
      });

      if (!res.ok) {
        setHttpStatus(res.status);
        const data = await res.json().catch(() => null);
        setApiError(data?.error?.message || "No se pudo cargar el artículo.");
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
      setApiError("Error de red al consultar el artículo.");
    }
  }, [id]);

  useEffect(() => {
    let isMounted = true;

    async function initialLoad() {
      await loadArticle();
      if (isMounted) {
        setLoading(false);
      }
    }

    initialLoad();

    return () => {
      isMounted = false;
    };
  }, [loadArticle]);

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

  // Subir fotografía: valida en cliente JPG, PNG, WebP y <= 10 MB
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFileSuccess(null);

    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    const extMatch = /\.([a-z0-9]+)$/i.exec(file.name);
    const ext = extMatch ? extMatch[1].toLowerCase() : "";
    const allowedExtensions = ["jpg", "jpeg", "png", "webp"];

    if (!allowedMimeTypes.includes(file.type) || !allowedExtensions.includes(ext)) {
      setFileError("La fotografía debe ser un archivo de imagen en formato JPG, PNG o WebP.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    const maxPhotoSize = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxPhotoSize) {
      setFileError("La fotografía no debe superar el límite de 10 MB.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    setUploadingPhoto(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "FOTO");
      body.append("articleId", id);

      const res = await fetch("/api/files", {
        method: "POST",
        credentials: "same-origin",
        body,
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        setFileSuccess("Fotografía subida exitosamente.");
        if (photoInputRef.current) photoInputRef.current.value = "";
        await loadArticle();
      } else {
        const msg = data?.error?.message || "No se pudo subir la fotografía.";
        setFileError(msg);
      }
    } catch {
      setFileError("Error de conexión al subir la fotografía.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  // Subir certificado: valida en cliente PDF y <= 20 MB
  async function handleCertUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFileSuccess(null);

    const isPdfMime = file.type === "application/pdf";
    const extMatch = /\.([a-z0-9]+)$/i.exec(file.name);
    const ext = extMatch ? extMatch[1].toLowerCase() : "";

    if (!isPdfMime || ext !== "pdf") {
      setFileError("El certificado debe ser un documento en formato PDF.");
      if (certInputRef.current) certInputRef.current.value = "";
      return;
    }

    const maxCertSize = 20 * 1024 * 1024; // 20 MB
    if (file.size > maxCertSize) {
      setFileError("El certificado PDF no debe superar el límite de 20 MB.");
      if (certInputRef.current) certInputRef.current.value = "";
      return;
    }

    setUploadingCert(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "CERTIFICADO");
      body.append("articleId", id);

      const res = await fetch("/api/files", {
        method: "POST",
        credentials: "same-origin",
        body,
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        setFileSuccess("Certificado de autenticidad subido exitosamente.");
        if (certInputRef.current) certInputRef.current.value = "";
        await loadArticle();
      } else {
        const msg = data?.error?.message || "No se pudo subir el certificado.";
        setFileError(msg);
      }
    } catch {
      setFileError("Error de conexión al subir el certificado.");
    } finally {
      setUploadingCert(false);
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
          <p className="text-sm text-[var(--pf-muted)] font-medium">Cargando artículo...</p>
        </Card>
      </main>
    );
  }

  // Vista de error 404 o 403
  if (httpStatus === 404 || httpStatus === 403 || (!article && !loading)) {
    return (
      <main className="pf-page">
        <Card className="text-center py-12 max-w-lg mx-auto">
          <h1 className="pf-title text-xl  mb-3">
            {httpStatus === 403 ? "Acceso denegado" : "Artículo no encontrado"}
          </h1>
          <p className="text-sm text-[var(--pf-muted)] mb-6">
            {httpStatus === 403
              ? "No tienes los permisos requeridos para acceder a este artículo."
              : "El artículo solicitado no existe o no se encuentra asociado a tu cuenta."}
          </p>
          <Link href="/mis-articulos" className="pf-btn">
            Volver a mis artículos
          </Link>
        </Card>
      </main>
    );
  }

  if (!article) return null;

  const isEditable =
    article.status === "BORRADOR" || article.status === "REQUIERE_CORRECCIONES";

  const allFiles = article.files || [];
  const photos = allFiles.filter((f) => f.kind === "FOTO");
  const certificates = allFiles.filter((f) => f.kind === "CERTIFICADO");
  const photosCount = photos.length;

  const currentStatusMeta = STATUS_CONFIG[article.status] || {
    label: article.status,
    variant: "neutral" as const,
  };

  return (
    <main className="pf-page">
      {/* Navegación y encabezado */}
      <div className="mb-6">
        <Link
          href="/mis-articulos"
          className="text-xs font-semibold text-[var(--pf-muted)] hover:text-[var(--pf-text)] inline-flex items-center gap-1 mb-2"
        >
          ← Volver a mis artículos
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="pf-title ">
              {isEditable ? "Editar artículo" : "Detalle del artículo"}
            </h1>
            <p className="text-sm text-[var(--pf-muted)] mt-1">
              Código de referencia: <span className="font-mono text-xs">{article.id}</span>
            </p>
          </div>
          <div>
            <Badge variant={currentStatusMeta.variant}>{currentStatusMeta.label}</Badge>
          </div>
        </div>
      </div>

      {/* Alertas de feedback general */}
      {successMsg && (
        <div className="pf-card border-[var(--pf-success-border)] bg-[var(--pf-success-bg)] mb-6 flex justify-between items-center py-3">
          <p className="pf-success font-medium my-0">{successMsg}</p>
          <button
            type="button"
            className="text-xs text-[var(--pf-muted)] hover:text-[var(--pf-text)] px-2"
            onClick={() => setSuccessMsg(null)}
            aria-label="Cerrar mensaje"
          >
            ✕
          </button>
        </div>
      )}

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

      {/* Alertas de subida de archivos */}
      {fileSuccess && (
        <div className="pf-card border-[var(--pf-success-border)] bg-[var(--pf-success-bg)] mb-6 flex justify-between items-center py-3">
          <p className="pf-success font-medium my-0">{fileSuccess}</p>
          <button
            type="button"
            className="text-xs text-[var(--pf-muted)] hover:text-[var(--pf-text)] px-2"
            onClick={() => setFileSuccess(null)}
            aria-label="Cerrar mensaje"
          >
            ✕
          </button>
        </div>
      )}

      {fileError && (
        <div className="pf-card border-[var(--pf-error-border)] bg-[var(--pf-error-bg)] mb-6 flex justify-between items-center py-3">
          <p className="pf-error font-medium my-0">{fileError}</p>
          <button
            type="button"
            className="text-xs text-[var(--pf-muted)] hover:text-[var(--pf-text)] px-2"
            onClick={() => setFileError(null)}
            aria-label="Cerrar mensaje de error"
          >
            ✕
          </button>
        </div>
      )}

          {article.reviews?.some((review) => review.comments) && <Card>
            <h2 className="text-lg font-semibold mb-3">Observaciones de verificación</h2>
            <ul className="space-y-3">{article.reviews.filter((review) => review.comments).map((review) => <li key={review.id} className="border rounded-xl p-4">
              <div className="flex flex-wrap gap-3 items-center"><Badge>{review.status ?? "PENDIENTE_REVISION"}</Badge>{review.decidedAt && <time className="text-xs text-[var(--pf-muted)]" dateTime={review.decidedAt}>{formatDate(review.decidedAt)}</time>}</div>
              <p className="mt-2 whitespace-pre-wrap">{review.comments}</p>
            </li>)}</ul>
          </Card>}

      {/* MODO LECTURA: cuando no es editable */}
      {!isEditable ? (
        <Card className="max-w-3xl">
          {/* Banner de estado no editable */}
          <div className="pf-card bg-[var(--pf-warning-bg)] border-[var(--pf-warning-border)] mb-6 py-3">
            <p className="text-sm text-[var(--pf-warning-text)] my-0 font-medium">
              Este artículo se encuentra en estado <strong>{currentStatusMeta.label}</strong>{" "}
              y no admite modificaciones en este momento.
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <h2 className="pf-label text-[var(--pf-muted)] mb-1">Título del artículo</h2>
              <p className="text-lg font-semibold text-[var(--pf-text)]">{article.title}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h2 className="pf-label text-[var(--pf-muted)] mb-1">Categoría</h2>
                <p className="text-sm font-medium text-[var(--pf-text)]">{article.category}</p>
              </div>
              <div>
                <h2 className="pf-label text-[var(--pf-muted)] mb-1">Condición</h2>
                <p className="text-sm font-medium text-[var(--pf-text)]">{article.condition}</p>
              </div>
            </div>

            <div>
              <h2 className="pf-label text-[var(--pf-muted)] mb-1">Precio inicial</h2>
              <p className="text-lg font-bold text-[var(--pf-text)]">${article.initialPrice} USD</p>
            </div>

            <div>
              <h2 className="pf-label text-[var(--pf-muted)] mb-1">Descripción</h2>
              <p className="text-sm text-[var(--pf-text)] whitespace-pre-line bg-[var(--pf-bg)] p-4 rounded-lg border border-[var(--pf-border)]">
                {article.description}
              </p>
            </div>

            <div>
              <h2 className="pf-label text-[var(--pf-muted)] mb-1">Procedencia e Historia</h2>
              <p className="text-sm text-[var(--pf-text)] whitespace-pre-line bg-[var(--pf-bg)] p-4 rounded-lg border border-[var(--pf-border)]">
                {article.provenance}
              </p>
            </div>

            {/* Galería de Fotografías en Modo Lectura */}
            <div>
              <h2 className="pf-label text-[var(--pf-text)] mb-2">Fotografías del expediente</h2>
              {photos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="border border-[var(--pf-border)] rounded-lg overflow-hidden bg-[var(--pf-bg)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/files/${photo.id}`}
                        alt={photo.originalName || "Fotografía del artículo"}
                        className="w-full h-32 object-cover"
                        loading="lazy"
                      />
                      <div className="p-2 text-xs text-[var(--pf-muted)] truncate border-t border-[var(--pf-border)] bg-white">
                        <span className="truncate block" title={photo.originalName}>
                          {photo.originalName}
                        </span>
                        <span className="text-[10px] text-[var(--pf-muted)]">
                          {(photo.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--pf-muted)] italic">No hay fotografías asociadas.</p>
              )}
            </div>

            {/* Certificado PDF en Modo Lectura */}
            <div>
              <h2 className="pf-label text-[var(--pf-text)] mb-2">Certificado de autenticidad</h2>
              {certificates.length > 0 ? (
                <div className="space-y-2">
                  {certificates.map((cert) => (
                    <div
                      key={cert.id}
                      className="flex items-center justify-between p-3 border border-[var(--pf-border)] rounded-lg bg-[var(--pf-bg)]"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-lg" aria-hidden="true">
                          📄
                        </span>
                        <div className="truncate">
                          <p className="text-sm font-semibold text-[var(--pf-text)] truncate">
                            {cert.originalName}
                          </p>
                          <p className="text-xs text-[var(--pf-muted)]">
                            {(cert.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <a
                        href={`/api/files/${cert.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pf-btn-secondary text-xs py-1 px-3 whitespace-nowrap"
                      >
                        Ver PDF ↗
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--pf-muted)] italic">No se adjuntó certificado de autenticidad.</p>
              )}
            </div>
          </div>

          <div className="pt-6 border-t border-[var(--pf-border)] mt-6 flex justify-end">
            <Link href="/mis-articulos" className="pf-btn-secondary">
              Volver a mis artículos
            </Link>
          </div>
        </Card>
      ) : (
        /* MODO EDICIÓN: BORRADOR o REQUIERE_CORRECCIONES */
        <div className="space-y-6 max-w-3xl">
          {article.status === "REQUIERE_CORRECCIONES" && (
            <div className="pf-card bg-[var(--pf-warning-bg)] border-[var(--pf-warning-border)] py-3">
              <p className="text-sm text-[var(--pf-warning-text)] my-0 font-medium">
                Este artículo requiere correcciones antes de ser aprobado. Revisa los datos,
                actualiza la información o fotografías necesarias y vuelve a enviarlo a revisión.
              </p>
            </div>
          )}


          {/* Formulario de Datos del Artículo */}
          <Card>
            <form onSubmit={handleSaveChanges} noValidate>
              <h2 className="text-lg font-bold text-[var(--pf-text)] mb-4 pb-2 border-b border-[var(--pf-border)]">
                Información del artículo
              </h2>

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
                  <p className="text-xs text-[var(--pf-muted)] mt-1">Mínimo 10 caracteres.</p>
                )}
              </div>

              {/* Botón para guardar solo datos de texto */}
              <div className="flex justify-end pt-3">
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={saving || submittingReview}
                >
                  {saving ? "Guardando…" : "Guardar cambios de texto"}
                </Button>
              </div>
            </form>
          </Card>

          {/* Sección de Archivos del Expediente (Fotos y Certificado) */}
          <Card>
            <h2 className="text-lg font-bold text-[var(--pf-text)] mb-1">
              Archivos del expediente
            </h2>
            <p className="text-xs text-[var(--pf-muted)] mb-6">
              Adjunta las fotografías descriptivas de la pieza y, si dispones de él, el certificado de autenticidad en PDF.
            </p>

            {/* Subsección: Fotografías */}
            <div className="mb-6 pb-6 border-b border-[var(--pf-border)]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-semibold text-sm text-[var(--pf-text)]">
                    Fotografías del artículo{" "}
                    <span className="text-[var(--pf-error)] font-normal">* (obligatoria al menos 1)</span>
                  </h3>
                  <p className="text-xs text-[var(--pf-muted)]">
                    Formatos JPG, PNG o WebP. Tamaño máximo 10 MB por imagen.
                  </p>
                </div>
                <span className="text-xs font-semibold px-2 py-1 bg-[var(--pf-bg)] rounded text-[var(--pf-text)] self-start sm:self-auto">
                  {photosCount} foto(s) cargada(s)
                </span>
              </div>

              {/* Miniaturas de fotos cargadas */}
              {photos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-4">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="border border-[var(--pf-border)] rounded-lg overflow-hidden bg-[var(--pf-bg)] shadow-sm"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/files/${photo.id}`}
                        alt={photo.originalName || "Fotografía"}
                        className="w-full h-32 object-cover"
                        loading="lazy"
                      />
                      <div className="p-2 text-xs text-[var(--pf-muted)] bg-white border-t border-[var(--pf-border)]">
                        <span className="truncate block font-medium" title={photo.originalName}>
                          {photo.originalName}
                        </span>
                        <span className="text-[10px] text-[var(--pf-muted)]">
                          {(photo.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-[var(--pf-warning-border)] bg-[var(--pf-warning-bg)] rounded-lg p-4 mb-4 text-center">
                  <p className="text-xs text-[var(--pf-warning-text)] font-medium">
                    Aún no has subido ninguna fotografía. Debes subir al menos una foto para poder enviar el artículo a verificación.
                  </p>
                </div>
              )}

              {/* Control de carga de fotografía */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <input
                  type="file"
                  id="foto-upload"
                  ref={photoInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoUpload}
                  disabled={uploadingPhoto || uploadingCert}
                  className="pf-input text-xs"
                />
                {uploadingPhoto && (
                  <span className="text-xs text-[var(--pf-muted)] font-medium animate-pulse whitespace-nowrap">
                    Subiendo archivo…
                  </span>
                )}
              </div>
            </div>

            {/* Subsección: Certificado de autenticidad */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-semibold text-sm text-[var(--pf-text)]">
                    Certificado de autenticidad <span className="text-[var(--pf-muted)] font-normal">(opcional)</span>
                  </h3>
                  <p className="text-xs text-[var(--pf-muted)]">
                    Formato PDF. Tamaño máximo 20 MB.
                  </p>
                </div>
              </div>

              {/* Lista de certificados cargados */}
              {certificates.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {certificates.map((cert) => (
                    <div
                      key={cert.id}
                      className="flex items-center justify-between p-3 border border-[var(--pf-border)] rounded-lg bg-[var(--pf-bg)]"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-xl" aria-hidden="true">
                          📄
                        </span>
                        <div className="truncate">
                          <p className="text-sm font-semibold text-[var(--pf-text)] truncate">
                            {cert.originalName}
                          </p>
                          <p className="text-xs text-[var(--pf-muted)]">
                            {(cert.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <a
                        href={`/api/files/${cert.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pf-btn-secondary text-xs py-1 px-3 whitespace-nowrap"
                      >
                        Ver PDF ↗
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--pf-muted)] italic mb-4">
                  No se ha adjuntado certificado todavía.
                </p>
              )}

              {/* Control de carga de certificado */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <input
                  type="file"
                  id="cert-upload"
                  ref={certInputRef}
                  accept="application/pdf"
                  onChange={handleCertUpload}
                  disabled={uploadingPhoto || uploadingCert}
                  className="pf-input text-xs"
                />
                {uploadingCert && (
                  <span className="text-xs text-[var(--pf-muted)] font-medium animate-pulse whitespace-nowrap">
                    Subiendo archivo…
                  </span>
                )}
              </div>
            </div>
          </Card>

          {/* Acciones principales y envío a revisión */}
          <Card>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Link href="/mis-articulos" className="pf-btn-secondary">
                  Volver
                </Link>
                {article.status === "BORRADOR" && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || submittingReview || uploadingPhoto || uploadingCert}
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    Eliminar borrador
                  </Button>
                )}
              </div>

              <div className="flex flex-col items-stretch sm:items-end gap-1">
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    saving ||
                    submittingReview ||
                    uploadingPhoto ||
                    uploadingCert ||
                    photosCount === 0
                  }
                  onClick={handleSubmitForReview}
                >
                  {submittingReview ? "Enviando…" : "Enviar a revisión"}
                </Button>

                {photosCount === 0 && (
                  <p className="text-xs text-[var(--pf-error)] font-medium mt-1 text-center sm:text-right">
                    Debes subir al menos una fotografía antes de enviar el artículo a verificación.
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Diálogo para eliminar borrador */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="¿Eliminar borrador?"
        message="Esta acción no se puede deshacer. Se eliminarán permanentemente los datos del artículo y sus archivos adjuntos."
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
