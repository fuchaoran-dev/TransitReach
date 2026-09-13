import {
  Polyline,
} from 'react-leaflet';

import {
  railShapeForRoute,
} from '@/shared/data/adapters/railShapeAdapter';

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

  return (
    <>
      {/* White outline so the
          selected rail is visible
          above map/polygons */}
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
    </>
  );
}