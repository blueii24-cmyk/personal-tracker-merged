import type { HTMLAttributes } from 'react';
import { cn } from '@/tracker/lib/cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('skeleton', className)} {...rest} />;
}
