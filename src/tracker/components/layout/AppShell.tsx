import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { ErrorBoundary } from '@/tracker/app/ErrorBoundary';
import { cn } from '@/tracker/lib/cn';
import { MobileBottomNav, MobileTopBar } from './MobileNavigation';
import { Sidebar } from './Sidebar';

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 px-4 py-6 sm:px-6 lg:px-8" role="status" aria-label="Loading page">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid grid-cols-1 gap-4 pt-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const isChat = pathname.startsWith('/chat');
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <a href="#main" className="sr-only z-50 rounded-md bg-ink px-3 py-2 text-sm text-on-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main id="main" tabIndex={-1} className={cn('scroll-thin min-h-0 flex-1 outline-none', isChat ? 'overflow-hidden' : 'overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8')}>
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}

/** Width/padding wrapper used by every non-chat page. */
export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('stagger mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8', className)}>{children}</div>;
}
