import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:shadow-sm hover:brightness-110 disabled:opacity-40',
  secondary: 'border border-line-strong text-primary hover:bg-primary-container/60 disabled:opacity-50',
  subtle: 'bg-primary-container text-on-primary-container hover:brightness-95 disabled:opacity-50',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40',
  danger: 'bg-danger text-on-ink hover:opacity-90 disabled:opacity-40',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5 rounded-full',
  md: 'h-10 px-5 text-sm gap-2 rounded-full',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-full',
  icon: 'size-10 rounded-full',
  'icon-sm': 'size-8 rounded-full',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,box-shadow,filter,transform] duration-200 select-none active:scale-[0.95] active:duration-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
