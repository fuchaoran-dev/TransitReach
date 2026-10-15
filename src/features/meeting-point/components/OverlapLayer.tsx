import { Polygon } from 'react-leaflet';
import type { OverlapPolygon } from '../overlapService';

/**
 * The ground everyone can reach.
 *
 * Only the true intersection is drawn; individual surfaces remain calculation inputs.
 * A bright cyan border makes the answer legible on both light and dark basemaps.
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
            color: '#0891b2',
            weight: 4,
            opacity: 1,
            fillColor: '#22d3ee',
            fillOpacity: 0.38,
          }}
        />
      ))}
    </>
  );
}
