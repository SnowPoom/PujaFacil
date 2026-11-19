"use client";

import React from "react";
import { DISPLAY_LABELS, displayLabel, statusTone } from "@/lib/presentation";

type BadgeVariant = "neutral" | "success" | "error" | "accent";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClassMap: Record<BadgeVariant, string> = {
  neutral: "pf-badge",
  success: "pf-badge pf-badge--success",
  error: "pf-badge pf-badge--error",
  accent: "pf-badge pf-badge--accent",
};

export default function Badge({
  children,
  variant = "neutral",
  className = "",
}: BadgeProps) {
  const code = typeof children === "string" ? children : "";
  const tone = statusTone(code) ?? variant;
  return (
    <span className={`${variantClassMap[tone]} ${className}`.trim()}>
      {code in DISPLAY_LABELS ? displayLabel(code) : children}
    </span>
  );
}
