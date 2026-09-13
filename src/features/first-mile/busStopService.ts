import rawBusStops
  from '@/shared/data/bus/stops.json';

import type {
  IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';

export interface BusStop {
  stopId: string;
  name: string;
  lat: number;
  lon: number;

  distanceToAccessibleStationMeters:
    number | null;
}

interface AccessibleStopLike {
  stop: {
    lat: number;
    lon: number;
  };
}

const BUS_STOPS =
  rawBusStops as BusStop[];

export const BUS_STOP_RADIUS_METERS =
  1500;

function haversineMeters(
  a: {
    lat: number;
    lon: number;
  },
  b: {
    lat: number;
    lon: number;
  },
): number {
  const earthRadius =
    6_371_000;

  const toRadians = (
    value: number,
  ) =>
    value *
    Math.PI /
    180;

  const lat1 =
    toRadians(a.lat);

  const lat2 =
    toRadians(b.lat);

  const deltaLat =
    toRadians(
      b.lat - a.lat,
    );

  const deltaLon =
    toRadians(
      b.lon - a.lon,
    );

  const sinLat =
    Math.sin(
      deltaLat / 2,
    );

  const sinLon =
    Math.sin(
      deltaLon / 2,
    );

  const h =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLon *
      sinLon;

  return (
    2 *
    earthRadius *
    Math.asin(
      Math.sqrt(h),
    )
  );
}
function pointInsideRing(
  point: {
    lat: number;
    lon: number;
  },
  ring: [number, number][],
): boolean {
  if (ring.length < 3) {
    return false;
  }

  let inside = false;

  for (
    let i = 0,
      j = ring.length - 1;
    i < ring.length;
    j = i++
  ) {
    // Isochrone coordinates are GeoJSON order:
    // [longitude, latitude]
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > point.lat !==
        yj > point.lat &&
      point.lon <
        ((xj - xi) *
          (point.lat - yi)) /
          (yj - yi) +
          xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInsideRegion(
  point: {
    lat: number;
    lon: number;
  },
  region: IsochroneRegion,
): boolean {
  // Must be inside the outer boundary
  if (
    !pointInsideRing(
      point,
      region.outer,
    )
  ) {
    return false;
  }

  // But must NOT be inside one of the
  // unreachable holes
  const insideHole =
    region.holes.some(
      hole =>
        pointInsideRing(
          point,
          hole,
        ),
    );

  return !insideHole;
}

function pointInsideAnyRegion(
  point: {
    lat: number;
    lon: number;
  },
  regions:
    IsochroneRegion[],
): boolean {
  return regions.some(
    region =>
      pointInsideRegion(
        point,
        region,
      ),
  );
}

export function busStopsNearAccessibleStations(
  accessibleStops:
    AccessibleStopLike[],
  reachableRegions:
    IsochroneRegion[],
  radiusMeters =
    BUS_STOP_RADIUS_METERS,
): BusStop[] {
  if (
    accessibleStops.length === 0 ||
    reachableRegions.length === 0
  ) {
    return [];
  }
  return BUS_STOPS.flatMap(
    busStop => {
      let nearest =
        Number.POSITIVE_INFINITY;

      for (
        const result of
        accessibleStops
      ) {
        const distance =
          haversineMeters(
            {
              lat: busStop.lat,
              lon: busStop.lon,
            },
            {
              lat:
                result.stop.lat,
              lon:
                result.stop.lon,
            },
          );

        if (
          distance < nearest
        ) {
          nearest =
            distance;
        }
      }
      if (
        nearest >
        radiusMeters
      ) {
        return [];
      }

      const insideReachableArea =
        pointInsideAnyRegion(
          {
            lat: busStop.lat,
            lon: busStop.lon,
          },
          reachableRegions,
        );

      if (!insideReachableArea) {
        return [];
      }

      return [
        {
          ...busStop,

          distanceToAccessibleStationMeters:
            nearest,
        },
      ];
    },
  );
}