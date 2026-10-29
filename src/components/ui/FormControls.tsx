"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldWrapperProps {
  label?: string;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
}

export function Field({ label, error, hint, htmlFor, children, required }: FieldWrapperProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--text-primary)]">
          {label}
          {required && <span className="ml-0.5 text-danger-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-[var(--text-tertiary)]">{hint}</p>}
      {error && <p className="text-xs font-medium text-danger-500">{error}</p>}
    </div>
  );
}

const baseControlClasses =
  "w-full rounded-lg border bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className = "", invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={`${baseControlClasses} ${invalid ? "border-danger-500" : "border-[var(--border-strong)]"} ${className}`}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className = "", invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={`${baseControlClasses} resize-none ${invalid ? "border-danger-500" : "border-[var(--border-strong)]"} ${className}`}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className = "", invalid, children, ...props }, ref) => (
    <select
      ref={ref}
      className={`${baseControlClasses} ${invalid ? "border-danger-500" : "border-[var(--border-strong)]"} ${className}`}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
