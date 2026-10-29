"use client";

import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-[0_7px_18px_-11px_rgba(33,128,82,0.85)] hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300",
  secondary:
    "border border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]",
  outline:
    "border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:border-brand-300 hover:bg-brand-50/60 dark:hover:bg-brand-500/10",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]",
  danger: "bg-danger-500 text-white shadow-sm hover:bg-danger-600 disabled:bg-danger-500/50",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-9 rounded-xl px-3.5 text-[13px] gap-1.5",
  md: "h-10 rounded-xl px-4 text-sm gap-2",
  lg: "h-12 rounded-2xl px-5 text-base gap-2",
  icon: "h-10 w-10 rounded-xl justify-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading = false, disabled, className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center font-semibold transition-all duration-200 hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...props}
      >
        {loading && <Loader2 size={16} className="animate-spin" />}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
