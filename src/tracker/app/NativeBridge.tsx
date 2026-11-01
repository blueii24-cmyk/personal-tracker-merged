import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { useToast } from '@/tracker/components/ui/Toast';
import { useTheme } from '@/tracker/features/theme/ThemeProvider';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { isNative } from '@/tracker/lib/platform/native';

/**
 * Renders nothing. Wires the app to the device: connectivity notices and the start-up storage notice work
 * everywhere; system-bar colours, the Android back button and resume handling only run inside the Android app.
 */
export function NativeBridge() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { toast } = useToast();
  const { service, refresh } = useTracker();
  const { resolved } = useTheme();

  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // Stored data that had to be set aside, or a device that refuses storage, is reported once and never silently.
  useEffect(() => {
    const notice = service.takeStorageNotice();
    if (notice) toast({ title: 'Storage notice', description: notice, tone: 'error', duration: 12000 });
  }, [service, toast]);

  useEffect(() => {
    const off = () => toast({ title: "You're offline", description: 'Your records are saved on this device. The AI assistant needs a connection.', tone: 'error' });
    const on = () => toast({ title: 'Back online', tone: 'success' });
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, [toast]);

  // Status-bar and navigation-bar icons follow the app theme (which may differ from the phone's theme).
  useEffect(() => {
    if (!isNative()) return;
    SystemBars.setStyle({ style: resolved === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
  }, [resolved]);

  useEffect(() => {
    if (!isNative()) return;
    let live = true;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    const keep = (p: Promise<{ remove: () => Promise<void> }>) =>
      p.then((h) => {
        if (live) handles.push(h);
        else void h.remove();
      });

    // Back: close the open dialog first, then step back through the app's own history, then leave the app.
    keep(
      CapApp.addListener('backButton', () => {
        const open = document.querySelectorAll('dialog[open]');
        if (open.length > 0) {
          open[open.length - 1]!.dispatchEvent(new Event('cancel', { cancelable: true }));
          return;
        }
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else if (pathRef.current !== '/') navigate('/', { replace: true });
        else void CapApp.exitApp();
      }),
    );
    // Coming back from the background: re-read records and re-check which day "today" is.
    keep(
      CapApp.addListener('resume', () => {
        refresh().catch(() => undefined);
      }),
    );
    return () => {
      live = false;
      handles.forEach((h) => void h.remove());
    };
  }, [navigate, refresh]);

  return null;
}
