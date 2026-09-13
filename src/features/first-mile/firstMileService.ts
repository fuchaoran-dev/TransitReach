import {
  linesForStop,
  loadRailStops,
  type RailStop,
} from '@/shared/data/adapters/gtfsAdapter';

import { WALK_SPEED_MS } from '@/shared/data/adapters/routingAdapter';

import {
  routeWalking,
  WalkingRouteNotFoundError,
} from '@/shared/services/walkingRoutingClient';

import type {
  FirstMileStopResult,
  GeoPoint,
  WalkingRoute,
} from './types';

/**
 * How far anyone is asked to walk to reach transit.
 *
 * This is the first mile's own limit, and deliberately not the journey budget. The page
 * used to pass the whole travel-time budget in here, so choosing a 45-minute journey
 * listed every station within a 45-minute walk — a walk nobody takes, presented as
 * access. AC 3.1.5's "configured maximum walking threshold" is this number.
 */
export const DEFAULT_FIRST_MILE_THRESHOLD_MINUTES = 15;

const EARTH_RADIUS_METRES = 6_371_000;

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

/**
 * Used ONLY as a safe candidate pre-filter.
 *
 * It is never shown to the user as walking distance.
 * Any route that can be walked within the threshold must also have a
 * straight-line separation below that threshold.
 */
function straightLineMetres(
  a: GeoPoint,
  b: GeoPoint,
): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLon / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_METRES *
    Math.asin(Math.sqrt(h))
  );
}

function stopPoint(stop: RailStop): GeoPoint {
  return {
    lat: stop.lat,
    lon: stop.lon,
  };
}

/**
 * Finds GTFS stations that could physically be reachable within the
 * selected walking threshold.
 *
 * This is only a performance filter. Final distance/time always come
 * from OTP's pedestrian routing.
 */
function candidateStops(
  origin: GeoPoint,
  thresholdMinutes: number,
): RailStop[] {
  const theoreticalMaximumMetres =
    thresholdMinutes * 60 * WALK_SPEED_MS;

  return loadRailStops().filter(stop =>
    straightLineMetres(
      origin,
      stopPoint(stop),
    ) <= theoreticalMaximumMetres,
  );
}

async function routeToStop(
  origin: GeoPoint,
  stop: RailStop,
  signal: AbortSignal,
): Promise<FirstMileStopResult> {
  const directDistance = straightLineMetres(
    origin,
    stopPoint(stop),
  );

  let route: WalkingRoute;

  // If the origin itself is effectively the station, do not ask OTP to
  // generate a meaningless few-metre route.
  if (directDistance < 10) {
    route = {
      distanceMeters: 0,
      durationSeconds: 0,
      geometry: [origin],
    };
  } else {
    route = await routeWalking(
      origin,
      stopPoint(stop),
      signal,
    );
  }

  return {
    stop,
    lines: linesForStop(stop),
    route,
  };
}

/**
 * AC 3.1.1–3.1.5
 *
 * Returns every usable rail station reachable through the real
 * pedestrian network within the chosen threshold.
 *
 * Ordered by walking distance, nearest first. This is an ordering, not a
 * ranking: AC 3.2.2 forbids presenting one stop as better than another, and
 * nothing here does — no stop is marked closest, fastest or recommended, and
 * the walking and service figures are still stated separately for each. An
 * alphabetical list simply made the reader do the sorting themselves.
 *
 * Distance and time give the same order, since walking speed is a constant.
 */
export async function computeFirstMileAccess(
  origin: GeoPoint,
  thresholdMinutes = DEFAULT_FIRST_MILE_THRESHOLD_MINUTES,
  signal: AbortSignal,
): Promise<{
  stops: FirstMileStopResult[];
  unroutableCandidateCount: number;
}> {
  const candidates = candidateStops(
    origin,
    thresholdMinutes,
  );

  const settled = await Promise.allSettled(
    candidates.map(stop =>
      routeToStop(origin, stop, signal),
    ),
  );

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let unroutableCandidateCount = 0;

  const routed: FirstMileStopResult[] = [];

  for (const result of settled) {
    if (result.status === 'rejected') {
      if (
        result.reason instanceof WalkingRouteNotFoundError
      ) {
        unroutableCandidateCount++;
        continue;
      }

      // A single unroutable station should not destroy all other results.
      unroutableCandidateCount++;
      continue;
    }

    if (
      result.value.route.durationSeconds <=
      thresholdMinutes * 60
    ) {
      routed.push(result.value);
    }
  }

  // Nearest walk first. Ties fall back to the name so the order is stable.
  routed.sort((a, b) =>
    a.route.distanceMeters - b.route.distanceMeters ||
    a.stop.name.localeCompare(b.stop.name),
  );

  return {
    stops: routed,
    unroutableCandidateCount,
  };
}