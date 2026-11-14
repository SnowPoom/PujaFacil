"use client";

import React from "react";

interface PaginationProps {
  page: number;
  pages: number;
  onPageChange: (newPage: number) => void;
}

export default function Pagination({ page, pages, onPageChange }: PaginationProps) {
  if (pages <= 1) return null;

  return (
    <nav className="pf-pagination" aria-label="Paginación">
      <button
        type="button"
        className="pf-btn-secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Página anterior"
      >
        ← Anterior
      </button>

      <span className="pf-pagination__info">
        {page} / {pages}
      </span>

      <button
        type="button"
        className="pf-btn-secondary"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Página siguiente"
      >
        Siguiente →
      </button>
    </nav>
  );
}
