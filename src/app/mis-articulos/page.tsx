"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Pagination from "@/components/ui/Pagination";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ArticleStatusBadge, { ArticleItem } from "./_components/ArticleStatusBadge";

export default function MisArticulosPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [items, setItems] = useState<ArticleItem[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Estados de acciones por artículo
  const [submittingReviewId, setSubmittingReviewId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchArticles() {
      try {
        const qParam = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";
        const res = await fetch(`/api/articles?page=${page}&pageSize=8${qParam}`, {
          credentials: "same-origin",
        });

        if (!isMounted) return;

        if (!res.ok) {
          setHttpStatus(res.status);
          const data = await res.json().catch(() => null);
          setErrorMessage(data?.error?.message || "No se pudo cargar la lista de artículos.");
          setItems([]);
          setTotalPages(1);
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (data.ok && data.data) {
          setItems(data.data.items || []);
          setTotalPages(data.data.pages || 1);
          setHttpStatus(null);
        } else {
          setErrorMessage(data?.error?.message || "Error al obtener los datos.");
        }
      } catch {
        if (isMounted) {
          setErrorMessage("Error de red al consultar el catálogo de artículos.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchArticles();

    return () => {
      isMounted = false;
    };
  }, [page, searchQuery, reloadTrigger]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccessFeedback(null);
    setErrorMessage(null);
    setLoading(true);
    setPage(1);
    setSearchQuery(searchInput.trim());
  }

  function handleClearSearch() {
    setSuccessFeedback(null);
    setErrorMessage(null);
    setLoading(true);
    setSearchInput("");
    setPage(1);
    setSearchQuery("");
  }

  function handlePageChange(newPage: number) {
    setLoading(true);
    setPage(newPage);
  }

  async function handleSubmitForReview(id: string) {
    setSubmittingReviewId(id);
    setErrorMessage(null);
    setSuccessFeedback(null);

    try {
      const res = await fetch(`/api/articles/${id}/submit`, {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        setSuccessFeedback("Artículo enviado a revisión con éxito. Un verificador evaluará la publicación.");
        setReloadTrigger((prev) => prev + 1);
      } else {
        setErrorMessage(
          data?.error?.message || "No se pudo enviar el artículo a verificación. Verifica que tenga fotografías adjuntas."
        );
      }
    } catch {
      setErrorMessage("Error de conexión al enviar el artículo a verificación.");
    } finally {
      setSubmittingReviewId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingId) return;
    setDeleteLoading(true);
    setErrorMessage(null);
    setSuccessFeedback(null);

    try {
      const res = await fetch(`/api/articles/${deletingId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        setSuccessFeedback("Borrador eliminado exitosamente.");
        setDeletingId(null);
        setReloadTrigger((prev) => prev + 1);
      } else {
        setErrorMessage(data?.error?.message || "No se pudo eliminar el borrador.");
        setDeletingId(null);
      }
    } catch {
      setErrorMessage("Error de conexión al intentar eliminar el borrador.");
      setDeletingId(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // Vista de error de autorización 401
  if (httpStatus === 401) {
    return (
      <main className="pf-page">
        <Card className="text-center py-12 max-w-lg mx-auto">
          <h1 className="text-xl font-bold mb-3 text-slate-800">Sesión requerida</h1>
          <p className="text-sm text-slate-600 mb-6">
            Debes iniciar sesión con tu cuenta para acceder a la gestión de artículos.
          </p>
          <Link href="/iniciar-sesion" className="pf-btn">
            Iniciar sesión
          </Link>
        </Card>
      </main>
    );
  }

  // Vista de error de acceso restringido 403
  if (httpStatus === 403) {
    return (
      <main className="pf-page">
        <Card className="text-center py-12 max-w-lg mx-auto">
          <h1 className="text-xl font-bold mb-3 text-slate-800">Acceso restringido</h1>
          <p className="text-sm text-slate-600 mb-6">
            Tu cuenta debe tener el rol de Vendedor y encontrarse en estado ACTIVA para gestionar artículos.
          </p>
          <Link href="/perfil" className="pf-btn-secondary">
            Ver mi perfil
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="pf-page">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Mis artículos</h1>
          <p className="text-sm text-slate-600 mt-1">
            Gestiona tus lotes, borradores y artículos enviados a verificación para subasta.
          </p>
        </div>
        <Link href="/mis-articulos/nuevo" className="pf-btn self-start sm:self-auto">
          Publicar nuevo artículo
        </Link>
      </div>

      {/* Notificaciones de éxito y error */}
      {successFeedback && (
        <div className="pf-card border-green-200 bg-green-50 mb-6 flex justify-between items-center py-3">
          <p className="pf-success font-medium my-0">{successFeedback}</p>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-800 px-2"
            onClick={() => setSuccessFeedback(null)}
            aria-label="Cerrar mensaje"
          >
            ✕
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="pf-card border-red-200 bg-red-50 mb-6 flex justify-between items-center py-3">
          <p className="pf-error font-medium my-0">{errorMessage}</p>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-800 px-2"
            onClick={() => setErrorMessage(null)}
            aria-label="Cerrar mensaje"
          >
            ✕
          </button>
        </div>
      )}

      {/* Barra de búsqueda */}
      <Card className="mb-6 py-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="flex-1">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por título o categoría..."
              className="pf-input"
            />
          </div>
          <Button type="submit" variant="primary">
            Buscar
          </Button>
          {searchQuery && (
            <Button type="button" variant="secondary" onClick={handleClearSearch}>
              Limpiar
            </Button>
          )}
        </form>
      </Card>

      {/* Contenido principal: Loading, Vacío o Tabla */}
      {loading ? (
        <Card className="text-center py-12">
          <p className="text-sm text-slate-600 font-medium">Cargando tus artículos...</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-base font-semibold text-slate-800 mb-2">
            {searchQuery
              ? `No se encontraron artículos que coincidan con «${searchQuery}».`
              : "Aún no tienes artículos registrados."}
          </p>
          <p className="text-sm text-slate-600 mb-6">
            {searchQuery
              ? "Prueba modificando los términos de búsqueda o limpiando el filtro."
              : "Comienza publicando tu primer lote o pieza para subasta."}
          </p>
          {searchQuery ? (
            <Button variant="secondary" onClick={handleClearSearch}>
              Limpiar búsqueda
            </Button>
          ) : (
            <Link href="/mis-articulos/nuevo" className="pf-btn">
              Publicar nuevo artículo
            </Link>
          )}
        </Card>
      ) : (
        <>
          <Card className="p-0 overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>Título</th>
                    <th>Categoría</th>
                    <th>Precio inicial</th>
                    <th>Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-semibold text-slate-900">
                        <div>{item.title}</div>
                        <div className="text-xs text-slate-500 font-normal">
                          Condición: {item.condition}
                        </div>
                      </td>
                      <td>{item.category}</td>
                      <td className="font-medium text-slate-900">${item.initialPrice}</td>
                      <td>
                        <ArticleStatusBadge status={item.status} />
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <Link
                            href={`/mis-articulos/${item.id}/editar`}
                            className="pf-btn-secondary text-xs py-1 px-3"
                          >
                            Ver / Editar
                          </Link>

                          {(item.status === "BORRADOR" || item.status === "REQUIERE_CORRECCIONES") && (
                            <button
                              type="button"
                              className="pf-btn text-xs py-1 px-3"
                              disabled={submittingReviewId === item.id}
                              onClick={() => handleSubmitForReview(item.id)}
                            >
                              {submittingReviewId === item.id ? "Enviando…" : "Enviar a revisión"}
                            </button>
                          )}

                          {item.status === "BORRADOR" && (
                            <button
                              type="button"
                              className="pf-btn-secondary text-xs py-1 px-3"
                              disabled={deleteLoading}
                              onClick={() => setDeletingId(item.id)}
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Paginación */}
          <Pagination page={page} pages={totalPages} onPageChange={handlePageChange} />
        </>
      )}

      {/* Diálogo de confirmación para eliminar borrador */}
      <ConfirmDialog
        open={Boolean(deletingId)}
        title="¿Eliminar borrador?"
        message="Esta acción no se puede deshacer. Se eliminarán permanentemente los datos del artículo."
        confirmText="Eliminar"
        cancelText="Cancelar"
        loading={deleteLoading}
        onCancel={() => setDeletingId(null)}
        onConfirm={handleConfirmDelete}
      />
    </main>
  );
}
