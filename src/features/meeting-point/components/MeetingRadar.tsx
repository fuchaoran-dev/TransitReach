import { Radar } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion';
import { animateRadar, type RadarPoi } from '../radarScan';
import { RadarPoiMarker } from './RadarPoiMarker';

const NO_POIS: RadarPoi[] = [];

/** Decorative progress indicator, not a fabricated route or completion percentage. */
export function MeetingRadar({ pois = NO_POIS, diameter = 220 }: { pois?: RadarPoi[]; diameter?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const epoch = useRef<number | undefined>(undefined);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (reduced || typeof element.animate !== 'function') {
      element.dataset.motion = 'static';
      return;
    }
    element.dataset.motion = 'scanning';
    epoch.current ??= performance.now();
    return animateRadar(element, pois, {
      request: callback => window.requestAnimationFrame(callback),
      cancel: handle => window.cancelAnimationFrame(handle),
    }, epoch.current);
  }, [pois, reduced]);
  return <div ref={root} className="meeting-radar-overlay" role="status" aria-label="Calculating common reachable area">
    <div className="meeting-radar" style={{ width: diameter, height: diameter }} aria-hidden="true">
      <div className="meeting-radar-disc"><div className="meeting-radar-sweep" /></div>
      <div className="meeting-radar-ring meeting-radar-ring-middle" />
      <div className="meeting-radar-ring meeting-radar-ring-inner" />
      <span className="meeting-radar-core"><Radar size={38} strokeWidth={1.8} /></span>
      {pois.map(poi => <RadarPoiMarker key={poi.id} poi={poi} />)}
    </div>
    <p className="mt-3 rounded-full border border-cyan-300/30 bg-[#0e1c29]/95 px-4 py-2 text-sm font-semibold text-cyan-100">Finding common ground…</p>
  </div>;
}
