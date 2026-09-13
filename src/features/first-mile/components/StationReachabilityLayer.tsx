import {
  Polygon,
} from 'react-leaflet';

import type {
  IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';

interface StationReachabilityLayerProps {
  regions:
    IsochroneRegion[];
}

const STATION_AREA_COLOR =
  '#7c3aed';

export function StationReachabilityLayer({
  regions,
}: StationReachabilityLayerProps) {
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

              color:
                STATION_AREA_COLOR,

              weight: 2,

              opacity: 0.8,

              fillColor:
                STATION_AREA_COLOR,

              fillOpacity: 0.2,
            }}
            interactive={
              false
            }
          />
        ),
      )}
    </>
  );
}