export const RADAR_PERIOD_MS = 4000;
export const RADAR_DISCOVERY_MS = 2800;

export type RadarCategory = 'restaurant' | 'cafe' | 'bus' | 'train' | 'shopping' | 'meeting';

export interface RadarPoi {
  id: string;
  label: string;
  category: RadarCategory;
  /** Pixel offsets from the scanner centre; the anchor, not the raised icon, is detected. */
  x: number;
  y: number;
}

/** CSS angles: north is zero; positive angles turn clockwise in screen coordinates. */
export function radarAngle(x: number, y: number): number {
  return (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
}

/** Absolute crossings avoid both wraparound errors and missed frames after a hidden tab. */
export function radarDiscoveryAge(elapsedMs: number, angle: number): number | null {
  const firstCrossing = ((angle % 360 + 360) % 360) / 360 * RADAR_PERIOD_MS;
  if (elapsedMs < firstCrossing) return null;
  return (elapsedMs - firstCrossing) % RADAR_PERIOD_MS;
}

interface AnimationClock {
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
}

/** One rAF drives paused Web Animations, so beam and marker phases cannot drift. */
export function animateRadar(root: HTMLElement, pois: RadarPoi[], clock: AnimationClock, epoch?: number): () => void {
  const beam = root.querySelector<HTMLElement>('.meeting-radar-sweep');
  if (!beam) return () => {};
  const animations: Array<{ angle: number; tracks: Animation[] }> = [];
  const markers = root.querySelectorAll<HTMLElement>('.radar-poi');
  for (const [index, poi] of pois.entries()) {
    const marker = markers[index];
    if (!marker) continue;
    const tracks: Animation[] = [];
    const track = (selector: string, keyframes: Keyframe[]) => {
      const element = marker.querySelector<HTMLElement>(selector);
      if (!element) return;
      const animation = element.animate(keyframes, { duration: RADAR_DISCOVERY_MS, fill: 'both' });
      animation.pause();
      animation.currentTime = 0;
      tracks.push(animation);
    };
    track('.radar-poi-bubble', [
      { opacity: 0, transform: 'translateY(0) scale(.5)', offset: 0 },
      { opacity: 0.4, transform: 'translateY(-2px) scale(.65)', offset: 150 / 2800, easing: 'cubic-bezier(.2,.8,.2,1.4)' },
      { opacity: 1, transform: 'translateY(-10px) scale(1.15)', offset: 420 / 2800 },
      { opacity: 1, transform: 'translateY(-8px) scale(1)', offset: 550 / 2800 },
      { opacity: 1, transform: 'translateY(-12px) scale(1)', offset: 1000 / 2800 },
      { opacity: 1, transform: 'translateY(-8px) scale(1)', offset: 1400 / 2800 },
      { opacity: 1, transform: 'translateY(-10px) scale(1)', offset: 1800 / 2800 },
      { opacity: 0, transform: 'translateY(-6px) scale(.85)', offset: 1 },
    ]);
    track('.radar-poi-anchor', [
      { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.04 },
      { opacity: 0.8, offset: 1800 / 2800 }, { opacity: 0, offset: 1 },
    ]);
    track('.radar-poi-ripple', [
      { opacity: 0, transform: 'scale(.25)', offset: 0 },
      { opacity: 0.85, transform: 'scale(.5)', offset: 0.04 },
      { opacity: 0, transform: 'scale(2)', offset: 550 / 2800 },
      { opacity: 0, transform: 'scale(2)', offset: 1 },
    ]);
    track('.radar-poi-flash', [
      { opacity: 0, offset: 0 }, { opacity: 0.9, offset: 150 / 2800 },
      { opacity: 0, offset: 550 / 2800 }, { opacity: 0, offset: 1 },
    ]);
    animations.push({ angle: radarAngle(poi.x, poi.y), tracks });
  }
  let frame = 0;
  let start = epoch;
  let stopped = false;
  const tick = (timestamp: number) => {
    if (stopped) return;
    start ??= timestamp;
    const elapsed = Math.max(0, timestamp - start);
    beam.style.transform = `rotate(${elapsed / RADAR_PERIOD_MS * 360}deg)`;
    for (const { angle, tracks } of animations) {
      const age = radarDiscoveryAge(elapsed, angle);
      for (const animation of tracks) animation.currentTime = age === null ? 0 : Math.min(age, RADAR_DISCOVERY_MS);
    }
    frame = clock.request(tick);
  };
  frame = clock.request(tick);
  return () => {
    stopped = true;
    clock.cancel(frame);
    for (const { tracks } of animations) for (const animation of tracks) animation.cancel();
  };
}

/** Limit clutter without shifting any real map anchor. Prefer a range of categories. */
export function selectRadarPois(points: RadarPoi[], radius: number): RadarPoi[] {
  const nearby = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)
    && Math.hypot(p.x, p.y) >= 45 && Math.hypot(p.x, p.y) < radius * 0.92)
    .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.id.localeCompare(b.id));
  const selected: RadarPoi[] = [];
  const add = (point: RadarPoi) => {
    if (selected.length < 8 && !selected.some(p => p.id === point.id || Math.hypot(p.x - point.x, p.y - point.y) < 62)) selected.push(point);
  };
  for (const point of nearby) if (!selected.some(p => p.category === point.category)) add(point);
  for (const point of nearby) add(point);
  return selected;
}
