import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Reads `?highlight=<record id>`, scrolls that record into view once `ready`, and clears the param
 * after the flash animation so a refresh doesn't replay it. Rows opt in with `data-record-id`.
 */
export function useHighlight(ready: boolean): string | null {
  const [params, setParams] = useSearchParams();
  const id = params.get('highlight');

  useEffect(() => {
    if (!id || !ready) return;
    const el = document.querySelector<HTMLElement>(`[data-record-id="${CSS.escape(id)}"]`);
    if (el) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
    const t = window.setTimeout(() => {
      setParams(
        (p) => {
          p.delete('highlight');
          return p;
        },
        { replace: true },
      );
    }, 2600);
    return () => window.clearTimeout(t);
  }, [id, ready, setParams]);

  return id;
}
