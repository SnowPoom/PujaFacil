"use client";

import React from "react";

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
  return (
    <span className={`${variantClassMap[variant]} ${className}`.trim()}>
      {children}
    </span>
  );
}
