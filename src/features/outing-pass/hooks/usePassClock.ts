import { useEffect, useState } from 'react';

/** Update time labels without checking a room or recalculating the saved journey. */
export function usePassClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
