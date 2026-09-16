import {
  Polygon,
} from 'react-leaflet';

import type {
  IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';

interface StationReachabilityLayerProps {
  regions: IsochroneRegion[];
  color?: string | null;
}

const DEFAULT_AREA_COLOR =
  '#0f766e';

/**
 * Secondary isochrone shown after a user explicitly selects a rail/BRT line from a
 * first-mile station. The selected line colour is reused when it is available so the
 * relationship between the line and its remaining-budget reach is visually clear.
 */
export function StationReachabilityLayer({
  regions,
  color,
}: StationReachabilityLayerProps) {
  const areaColor =
    color ?? DEFAULT_AREA_COLOR;

  return (
    <>
      {regions.map(
        (region, index) => (
          <Polygon
            key={index}
            positions={[
              region.outer.map(
                ([lon, lat]) =>
                  [
                    lat,
                    lon,
                  ] as [
                    number,
                    number,
                  ],
              ),

              ...region.holes.map(
                hole =>
                  hole.map(
                    ([lon, lat]) =>
                      [
                        lat,
                        lon,
                      ] as [
                        number,
                        number,
                      ],
                  ),
              ),
            ]}
            pathOptions={{
              className:
                'station-reach-area',
              color: areaColor,
              weight: 2,
              opacity: 0.9,
              fillColor: areaColor,
              fillOpacity: 0.14,
              dashArray: '7 5',
            }}
            interactive={false}
          />
        ),
      )}
    </>
  );
}
