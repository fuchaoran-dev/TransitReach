import { useMemo } from 'react';
import { MAP_W, MAP_H, RIVER_PATH, LAKE_POINTS, ROAD_NETWORK, TRANSIT_LINES } from '@/shared/data';
import type { MapPoint } from '@/shared/types/location';
import { pointsToSmoothPath, pointsToPath } from '@/shared/lib/geometry';
interface TransitMapProps {
  className?: string;
  showTransit?: boolean;
  showRoads?: boolean;
  showLabels?: boolean;
  highlightedLines?: string[];
  fadedLines?: string[];
  className2?: string;
}

export function TransitMap({
  className = '',
  showTransit = true,
  showRoads = true,
  showLabels = false,
  highlightedLines = [],
  fadedLines = [],
}: TransitMapProps) {
  const riverPath = useMemo(() => pointsToSmoothPath(RIVER_PATH, false), []);
  const lakePath = useMemo(() => pointsToSmoothPath(LAKE_POINTS, true), []);

  const roadOpacity = (cls: string) => {
    if (cls === 'highway') return 0.5;
    if (cls === 'arterial') return 0.35;
    return 0.22;
  };
  const roadWidth = (cls: string) => {
    if (cls === 'highway') return 7;
    if (cls === 'arterial') return 4.5;
    return 2.5;
  };
  const roadColor = (cls: string) => {
    if (cls === 'highway') return '#94a3b8';
    if (cls === 'arterial') return '#b8c5d3';
    return '#cbd5e1';
  };

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <defs>
        {/* Land base gradient */}
        <radialGradient id="land-grad" cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#173044" />
          <stop offset="60%" stopColor="#102333" />
          <stop offset="100%" stopColor="#091623" />
        </radialGradient>

        {/* Water gradient */}
        <linearGradient id="water-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#103a52" />
          <stop offset="100%" stopColor="#071724" />
        </linearGradient>

        {/* Park / green area gradient */}
        <radialGradient id="park-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1d4e45" />
          <stop offset="100%" stopColor="#12332f" />
        </radialGradient>

        {/* Subtle grid pattern */}
        <pattern id="grid-pattern" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e2e8f0" strokeWidth="0.5" opacity="0.5" />
        </pattern>

        {/* Contour pattern */}
        <pattern id="contour-pattern" width="120" height="120" patternUnits="userSpaceOnUse">
          <path d="M 0 60 Q 30 40 60 60 T 120 60" fill="none" stroke="#cbd5e1" strokeWidth="0.4" opacity="0.3" />
          <path d="M 0 30 Q 30 10 60 30 T 120 30" fill="none" stroke="#cbd5e1" strokeWidth="0.4" opacity="0.2" />
          <path d="M 0 90 Q 30 70 60 90 T 120 90" fill="none" stroke="#cbd5e1" strokeWidth="0.4" opacity="0.2" />
        </pattern>
      </defs>

      {/* Base land */}
      <rect width={MAP_W} height={MAP_H} fill="url(#land-grad)" />

      {/* Contour overlay */}
      <rect width={MAP_W} height={MAP_H} fill="url(#contour-pattern)" opacity="0.4" />

      {/* Grid */}
      <rect width={MAP_W} height={MAP_H} fill="url(#grid-pattern)" />

      {/* Green areas / parks */}
      <g opacity="0.55">
        <ellipse cx="300" cy="580" rx="55" ry="40" fill="url(#park-grad)" />
        <ellipse cx="660" cy="270" rx="50" ry="38" fill="url(#park-grad)" />
        <ellipse cx="230" cy="310" rx="40" ry="30" fill="url(#park-grad)" />
        <ellipse cx="710" cy="185" rx="42" ry="32" fill="url(#park-grad)" />
        <ellipse cx="860" cy="560" rx="60" ry="35" fill="url(#park-grad)" />
      </g>

      {/* Water: river */}
      <path
        d={riverPath}
        fill="none"
        stroke="url(#water-grad)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path
        d={riverPath}
        fill="none"
        stroke="#e0f2fe"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.6"
      />

      {/* Water: lake */}
      <path
        d={lakePath}
        fill="url(#water-grad)"
        opacity="0.8"
      />
      <path
        d={lakePath}
        fill="none"
        stroke="#e0f2fe"
        strokeWidth="2"
        opacity="0.5"
      />

      {/* Roads */}
      {showRoads && (
        <g>
          {ROAD_NETWORK.map((road, i) => {
            const d = pointsToPath(road.points, false);
            return (
              <g key={`road-${i}`}>
                {/* Road casing */}
                <path
                  d={d}
                  fill="none"
                  stroke={roadColor(road.class)}
                  strokeWidth={roadWidth(road.class) + 2}
                  strokeLinecap="round"
                  opacity={roadOpacity(road.class) * 0.5}
                />
                {/* Road surface */}
                <path
                  d={d}
                  fill="none"
                  stroke={roadColor(road.class)}
                  strokeWidth={roadWidth(road.class)}
                  strokeLinecap="round"
                  opacity={roadOpacity(road.class)}
                />
              </g>
            );
          })}
        </g>
      )}

      {/* Transit lines */}
      {showTransit && (
        <g>
          {TRANSIT_LINES.map((line) => {
            const d = pointsToSmoothPath(line.path, false);
            const isHighlighted = highlightedLines.includes(line.id);
            const isFaded = fadedLines.includes(line.id);
            const opacity = isFaded ? 0.2 : isHighlighted ? 1 : 0.55;
            const width = isHighlighted ? 5 : 3.5;
            return (
              <g key={line.id} style={{ transition: 'opacity 300ms ease-out' }}>
                {/* Line casing */}
                <path
                  d={d}
                  fill="none"
                  stroke="white"
                  strokeWidth={width + 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={opacity * 0.8}
                />
                {/* Line color */}
                <path
                  d={d}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={opacity}
                />
                {/* Stops */}
                {line.stops.map((stop) => (
                  <g key={stop.id}>
                    <circle
                      cx={stop.pos.x}
                      cy={stop.pos.y}
                      r={isHighlighted ? 4 : 3}
                      fill="white"
                      stroke={line.color}
                      strokeWidth={2}
                      opacity={opacity}
                      style={{ transition: 'r 200ms ease-out, opacity 300ms ease-out' }}
                    />
                    {showLabels && (
                      <text
                        x={stop.pos.x}
                        y={stop.pos.y - 8}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#475569"
                        fontWeight="600"
                        opacity={opacity}
                      >
                        {stop.name}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      )}

      {/* Subtle vignette */}
      <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
        <stop offset="60%" stopColor="white" stopOpacity="0" />
        <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.3" />
      </radialGradient>
      <rect width={MAP_W} height={MAP_H} fill="url(#vignette)" pointerEvents="none" />
    </svg>
  );
}

export type { MapPoint };
