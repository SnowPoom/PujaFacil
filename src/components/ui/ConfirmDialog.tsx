"use client";

import React, { useEffect, useRef, useCallback } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Aceptar",
  cancelText = "Cancelar",
  loading = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Guardar el foco previo y enfocar el diálogo al abrir
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      // Pequeño delay para asegurar render
      requestAnimationFrame(() => {
        confirmBtnRef.current?.focus();
      });
    } else {
      // Restaurar foco al cerrar
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    }
  }, [open]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  // Trampa de foco dentro del diálogo
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    },
    []
  );

  // Clic en overlay cierra
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onCancel();
      }
    },
    [onCancel]
  );

  if (!open) return null;

  return (
    <div
      className="pf-overlay"
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pf-dialog-title"
        aria-describedby="pf-dialog-message"
        className="pf-dialog"
        onKeyDown={handleKeyDown}
      >
        <h2 id="pf-dialog-title" className="pf-dialog__title">
          {title}
        </h2>
        <p id="pf-dialog-message" className="pf-dialog__message">
          {message}
        </p>
        <div className="pf-dialog__actions">
          <button
            type="button"
            className="pf-btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className="pf-btn"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Procesando…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
