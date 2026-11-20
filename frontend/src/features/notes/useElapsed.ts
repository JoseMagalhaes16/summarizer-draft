import { useEffect, useState } from 'react';

/** Seconds since `sinceIso` (clamped at 0), ticking every second while `active`. */
export function useElapsedSeconds(sinceIso: string | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, sinceIso]);
  if (!sinceIso) return 0;
  return Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 1000));
}
