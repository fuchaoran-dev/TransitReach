import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

// Staggered reveal helper
export function useStaggeredReveal(count: number, interval = 60, startDelay = 0) {
  const [visibleCount, setVisibleCount] = useState(0);
  const prefersReduced = usePrefersReducedMotion();

  useEffect(() => {
    if (prefersReduced) {
      setVisibleCount(count);
      return;
    }
    let i = 0;
    let intervalTimer: ReturnType<typeof setInterval> | undefined;
    const startTimer = setTimeout(() => {
      intervalTimer = setInterval(() => {
      i++;
      setVisibleCount(i);
        if (i >= count && intervalTimer) clearInterval(intervalTimer);
      }, interval);
    }, startDelay);
    return () => {
      clearTimeout(startTimer);
      if (intervalTimer) clearInterval(intervalTimer);
    };
  }, [count, interval, prefersReduced, startDelay]);

  return visibleCount;
}
