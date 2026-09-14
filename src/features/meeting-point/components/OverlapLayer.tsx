import { Polygon } from 'react-leaflet';
import type { OverlapPolygon } from '../overlapService';

/**
 * The ground everyone can reach.
 *
 * Graphite, the colour that already means "reachable area" on the reachability map (AC 1.3.4) —
 * here, the area the whole group can reach. It is drawn over the coloured areas with a darker,
 * heavier outline and a stronger fill than any one person's area, because it is the answer the
 * screen exists to give.
 */
export function OverlapLayer({ polygons }: { polygons: OverlapPolygon[] }) {
  return (
    <>
      {polygons.map((polygon, index) => (
        <Polygon
          key={index}
          // GeoJSON is [lon, lat]; Leaflet wants [lat, lon]. Holes follow the outer ring.
          positions={polygon.map(ring => ring.map(([lon, lat]) => [lat, lon] as [number, number]))}
          interactive={false}
          pathOptions={{
            className: 'meeting-overlap',
            color: '#1e293b',
            weight: 3,
            opacity: 0.9,
            fillColor: '#475569',
            fillOpacity: 0.35,
          }}
        />
      ))}
    </>
  );
}
