import { useEffect, useRef, useState } from 'react';
import { todayStr } from './dates';

/** How often the clock is re-read while the window stays in front. */
const TICK_MS = 60_000;

/**
 * Calls `refresh` whenever the window may have been away or a minute has passed: the window gaining
 * focus, the page becoming visible again, and a 60 s interval. A Mac that slept through midnight
 * wakes up on one of these.
 */
function useClockTicks(onTick: () => void): void {
  const latest = useRef(onTick);
  latest.current = onTick;
  useEffect(() => {
    const refresh = () => latest.current();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(refresh, TICK_MS);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, []);
}

/** Today as `YYYY-MM-DD`, in local time. Rolls over at midnight without a reload. */
export function useToday(): string {
  const [today, setToday] = useState(todayStr);
  // the same string bails out of the render, so a minute tick on an ordinary day costs nothing
  useClockTicks(() => setToday(todayStr()));
  return today;
}

/** The current time, refreshed every minute and when the window comes back. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useClockTicks(() => setNow(new Date()));
  return now;
}
