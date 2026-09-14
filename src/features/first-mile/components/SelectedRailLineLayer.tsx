import {
  CircleMarker,
  Polyline,
  Tooltip,
} from 'react-leaflet';

import {
  railShapeForRoute,
} from '@/shared/data/adapters/railShapeAdapter';

import {
  loadRailStops,
} from '@/shared/data/adapters/gtfsAdapter';


interface SelectedRailLineLayerProps {
  routeId:
    string | null;

  color?:
    string | null;
}


export function SelectedRailLineLayer({
  routeId,
  color,
}: SelectedRailLineLayerProps) {
  if (!routeId) {
    return null;
  }


  const shape =
    railShapeForRoute(
      routeId,
    );


  if (
    !shape ||
    shape.points.length < 2
  ) {
    return null;
  }


  const positions =
    shape.points.map(
      point =>
        [
          point.lat,
          point.lon,
        ] as [
          number,
          number,
        ],
    );


  const routeStops =
    loadRailStops().filter(
      stop =>
        stop.lines.includes(
          routeId,
        ),
    );


  return (
    <>
      {/* White outline */}
      <Polyline
        positions={
          positions
        }
        pathOptions={{
          color:
            '#ffffff',

          weight: 8,
          opacity: 0.9,

          lineCap:
            'round',

          lineJoin:
            'round',
        }}
        interactive={
          false
        }
      />


      {/* Actual GTFS line */}
      <Polyline
        positions={
          positions
        }
        pathOptions={{
          color:
            color ??
            '#0f766e',

          weight: 5,
          opacity: 1,

          lineCap:
            'round',

          lineJoin:
            'round',
        }}
        interactive={
          false
        }
      />


      {/* Rail stations */}
      {routeStops.map(
        stop => (
          <CircleMarker
            key={
              stop.stopId
            }
            center={[
              stop.lat,
              stop.lon,
            ]}
            radius={5}
            pathOptions={{
              color:
                color ??
                '#0f766e',

              fillColor:
                '#ffffff',

              fillOpacity: 1,

              weight: 2,
            }}
          >
            <Tooltip
              direction="top"
              offset={[
                0,
                -5,
              ]}
            >
              {stop.name}
            </Tooltip>
          </CircleMarker>
        ),
      )}
    </>
  );
}