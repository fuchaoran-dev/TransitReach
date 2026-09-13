import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

export interface LiveTransitVehicle {
  id: string;

  routeId: string | null;
  tripId: string | null;

  lat: number;
  lon: number;

  bearing: number | null;
  speedMps: number | null;

  timestamp: number | null;

  distanceToAccessibleStopMeters: number | null;
}

interface AccessibleStopLike {
  stop: {
    lat: number;
    lon: number;
  };
}

const LIVE_TRANSIT_URL =
  '/gtfs-rt/rapid-bus-kl';

const LIVE_TRANSIT_CACHE_MS = 60_000;

let cachedVehicles:
  LiveTransitVehicle[] | null = null;

let cachedAt = 0;

let inFlightRequest:
  Promise<LiveTransitVehicle[]> | null = null;

let rateLimitedUntil = 0;

/**
 * We only show vehicles reasonably close to a station
 * that the user can reach on foot.
 *
 * This prevents Epic 3 from turning into a general
 * Kuala Lumpur vehicle tracker.
 */
export const LIVE_TRANSIT_RADIUS_METERS = 1500;

function numericValue(
  value: unknown,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value
  ) {
    const parsed = Number(
      String(value),
    );

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const earthRadius = 6_371_000;

  const toRadians = (
    degrees: number,
  ) => degrees * Math.PI / 180;

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const deltaLat =
    toRadians(b.lat - a.lat);

  const deltaLon =
    toRadians(b.lon - a.lon);

  const sinLat =
    Math.sin(deltaLat / 2);

  const sinLon =
    Math.sin(deltaLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLon *
      sinLon;

  return (
    2 *
    earthRadius *
    Math.asin(Math.sqrt(h))
  );
}

/**
 * Downloads the official Rapid KL GTFS-Realtime
 * VehiclePosition feed and converts protobuf entities
 * into simple frontend objects.
 */
export async function fetchLiveTransitVehicles(
  _signal?: AbortSignal,
): Promise<LiveTransitVehicle[]> {
  const now = Date.now();

  /*
   * Reuse the latest GTFS-Realtime snapshot for
   * 60 seconds.
   *
   * Changing the user's location should not cause
   * another request to data.gov.my.
   */
  if (
    cachedVehicles !== null &&
    now - cachedAt < LIVE_TRANSIT_CACHE_MS
  ) {
    return cachedVehicles;
  }

  /*
   * If the API has already rate-limited us,
   * do not keep sending more requests.
   */
  if (now < rateLimitedUntil) {
    if (cachedVehicles !== null) {
      return cachedVehicles;
    }

    throw new Error(
      'Live vehicle data is temporarily unavailable. Please try again shortly.',
    );
  }

  /*
   * If another request is already running,
   * reuse that request instead of creating
   * another one.
   */
  if (inFlightRequest) {
    return inFlightRequest;
  }

  inFlightRequest = (async () => {
    const response = await fetch(
      LIVE_TRANSIT_URL,
      {
        cache: 'no-store',
      },
    );

    /*
     * HTTP 429 = Too Many Requests.
     *
     * Respect Retry-After when available.
     * Otherwise wait 60 seconds.
     */
    if (response.status === 429) {
      const retryAfterHeader =
        response.headers.get(
          'Retry-After',
        );

      const retryAfterSeconds =
        retryAfterHeader
          ? Number(retryAfterHeader)
          : NaN;

      const retryDelay =
        Number.isFinite(
          retryAfterSeconds,
        )
          ? retryAfterSeconds * 1000
          : 60_000;

      rateLimitedUntil =
        Date.now() + retryDelay;

      /*
       * If we already have an older valid
       * snapshot, keep displaying it instead
       * of removing all bus markers.
       */
      if (cachedVehicles !== null) {
        return cachedVehicles;
      }

      throw new Error(
        'Live vehicle data is temporarily rate limited. Retrying shortly.',
      );
    }

    if (!response.ok) {
      throw new Error(
        `Live transit feed returned ${response.status}`,
      );
    }

    const binary =
      new Uint8Array(
        await response.arrayBuffer(),
      );

    const feed =
      GtfsRealtimeBindings
        .transit_realtime
        .FeedMessage
        .decode(binary);

    const results:
      LiveTransitVehicle[] = [];

    for (
      const entity of feed.entity
    ) {
      const vehicle =
        entity.vehicle;

      const position =
        vehicle?.position;

      if (!vehicle || !position) {
        continue;
      }

      const lat =
        numericValue(
          position.latitude,
        );

      const lon =
        numericValue(
          position.longitude,
        );

      if (
        lat === null ||
        lon === null
      ) {
        continue;
      }

      const vehicleId =
        vehicle.vehicle?.id ??
        entity.id ??
        `${lat}-${lon}`;

      results.push({
        id: vehicleId,

        routeId:
          vehicle.trip?.routeId ??
          null,

        tripId:
          vehicle.trip?.tripId ??
          null,

        lat,
        lon,

        bearing:
          numericValue(
            position.bearing,
          ),

        speedMps:
          numericValue(
            position.speed,
          ),

        timestamp:
          numericValue(
            vehicle.timestamp,
          ),

        distanceToAccessibleStopMeters:
          null,
      });
    }

    /*
     * Store the complete Rapid KL vehicle
     * snapshot.
     */
    cachedVehicles = results;
    cachedAt = Date.now();
    rateLimitedUntil = 0;

    return results;
  })();

  try {
    return await inFlightRequest;
  } finally {
    inFlightRequest = null;
  }
}

/**
 * AC 3.2:
 * Only vehicles near stations that are currently
 * accessible through Epic 3 are retained.
 */
export function vehiclesNearAccessibleStops(
  vehicles: LiveTransitVehicle[],
  accessibleStops:
    AccessibleStopLike[],
  radiusMeters =
    LIVE_TRANSIT_RADIUS_METERS,
): LiveTransitVehicle[] {
  if (
    accessibleStops.length === 0
  ) {
    return [];
  }

  return vehicles.flatMap(
    vehicle => {
      let nearest =
        Number.POSITIVE_INFINITY;

      for (
        const result of
        accessibleStops
      ) {
        const distance =
          haversineMeters(
            {
              lat: vehicle.lat,
              lon: vehicle.lon,
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
          nearest = distance;
        }
      }

      if (
        nearest >
        radiusMeters
      ) {
        return [];
      }

      return [
        {
          ...vehicle,
          distanceToAccessibleStopMeters:
            nearest,
        },
      ];
    },
  );
}