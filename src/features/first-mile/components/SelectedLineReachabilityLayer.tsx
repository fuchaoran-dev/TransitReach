import {
  Polygon,
} from 'react-leaflet';

import type {
  IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';

interface SelectedLineReachabilityLayerProps {
  regions: IsochroneRegion[];
  color?: string | null;
}

const DEFAULT_AREA_COLOR = '#0f766e';

/**
 * Reachable area after boarding the explicitly selected rail/BRT line.
 *
 * The geometry has already been restricted to:
 *   first-mile walk -> selected line only -> practical walking egress,
 * and clipped to the main total reachability area before it reaches this layer.
 */
export function SelectedLineReachabilityLayer({
  regions,
  color,
}: SelectedLineReachabilityLayerProps) {
  const areaColor = color ?? DEFAULT_AREA_COLOR;

  return (
    <>
      {regions.map((region, index) => (
        <Polygon
          key={index}
          positions={[
            region.outer.map(
              ([lon, lat]) => [lat, lon] as [number, number],
            ),
            ...region.holes.map(hole =>
              hole.map(
                ([lon, lat]) => [lat, lon] as [number, number],
              ),
            ),
          ]}
          pathOptions={{
            className: 'selected-line-reach-area',
            color: areaColor,
            weight: 2,
            opacity: 0.95,
            fillColor: areaColor,
            fillOpacity: 0.14,
            dashArray: '7 5',
          }}
          interactive={false}
        />
      ))}
    </>
  );
}
