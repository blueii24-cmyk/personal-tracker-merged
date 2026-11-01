import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/tracker/components/layout/AppShell';

const OverviewPage = lazy(() => import('@/tracker/components/dashboard/OverviewPage'));
const ChatPage = lazy(() => import('@/tracker/components/chat/ChatPage'));
const BulkingPage = lazy(() => import('@/tracker/components/bulking/BulkingPage'));
const BudgetPage = lazy(() => import('@/tracker/components/budget/BudgetPage'));
const HistoryPage = lazy(() => import('@/tracker/components/history/HistoryPage'));
const SettingsPage = lazy(() => import('@/tracker/components/settings/SettingsPage'));

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="bulking" element={<BulkingPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
