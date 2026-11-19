"use client";

import React from "react";

interface TextFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  step?: string;
}

export default function TextField({
  label,
  name,
  value,
  onChange,
  type = "text",
  error,
  required = false,
  placeholder,
  disabled = false,
  min,
  max,
  step,
}: TextFieldProps) {
  const inputClassName = `pf-input${error ? " pf-input--error" : ""}`;

  return (
    <div className="pf-field">
      <label htmlFor={name} className="pf-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={inputClassName}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error && (
        <p id={`${name}-error`} className="pf-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
