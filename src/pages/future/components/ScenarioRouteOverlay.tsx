import { useMemo } from 'react';
import type { MapPoint } from '@/shared/types/location';
import { usePrefersReducedMotion } from '@/shared/hooks';

interface ScenarioRouteOverlayProps {
  path: MapPoint[];
  color: string;
  stops: { name: string; pos: MapPoint }[];
  type: 'proposed' | 'suspended';
  animate?: boolean;
}

export function ScenarioRouteOverlay({ path, color, stops, type, animate = true }: ScenarioRouteOverlayProps) {
  const reduced = usePrefersReducedMotion();
  const d = useMemo(() => {
    let str = `M ${path[0].x} ${path[0].y}`;
    for (let i = 1; i < path.length; i++) {
      str += ` L ${path[i].x} ${path[i].y}`;
    }
    return str;
  }, [path]);

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={type === 'suspended' ? 3 : 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={type === 'suspended' ? '10 6' : undefined}
        opacity={type === 'suspended' ? 0.6 : 0.8}
        className={animate && !reduced ? 'draw-route' : ''}
        style={{ animationDuration: '1200ms' }}
      />
      {stops.map((stop, i) => (
        <g
          key={i}
          transform={`translate(${stop.pos.x}, ${stop.pos.y})`}
          className={animate && !reduced ? 'pin-enter' : ''}
          style={{ animationDelay: `${i * 100}ms` }}
        >
          {animate && !reduced && (
            <circle r="6" fill={color} opacity="0.3" className="expand-ring" style={{ animationDelay: `${i * 100}ms` }} />
          )}
          <circle r="5" fill="white" stroke={color} strokeWidth="2.5" />
          <circle r="2" fill={color} />
        </g>
      ))}
    </g>
  );
}
