"use client";

import React from "react";

interface ButtonProps {
  variant?: "primary" | "secondary";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function Button({
  variant = "primary",
  type = "button",
  disabled = false,
  onClick,
  children,
  className = "",
}: ButtonProps) {
  const baseClass = variant === "secondary" ? "pf-btn-secondary" : "pf-btn";

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseClass} ${className}`.trim()}
    >
      {children}
    </button>
  );
}
