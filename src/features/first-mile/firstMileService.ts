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
  FirstMileBusStopResult,
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
// ---------------------------------------------------------------- bus stops

interface StopServicesDoc {
  routes: Array<{
    id: string;
    feed: string;
    name: string;
    description: string;
    railLinks: string[];
  }>;
  /** [stopId, name, lat, lon, routeIndexes] */
  stops: Array<[string, string, number, number, number[]]>;
}

/**
 * How many bus stops are routed on foot per origin. Dense parts of the city have well over
 * a hundred stops inside a 15-minute walk, and each costs a request to the routing engine;
 * picking by new routes (below) means a handful already covers every distinct service.
 */
const MAX_BUS_CANDIDATES = 6;

/** How many bus stops are shown. More than this buries the answer. */
const MAX_BUS_STOPS = 4;

let stopServices: Promise<StopServicesDoc> | null = null;

/**
 * 6,000+ stops with their routes: loaded on first use rather than shipped in the main
 * bundle, since nobody needs them until they set a starting point.
 */
function loadStopServices(): Promise<StopServicesDoc> {
  stopServices ??= import('@/shared/data/bus/stop-services.json').then(
    module => module.default as unknown as StopServicesDoc,
  );
  return stopServices;
}

const titleCase = (name: string) =>
  name.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());

/**
 * Bus stops within the walking window (US 3.1).
 *
 * For most of the Klang Valley the nearest boardable service is a bus, not a train, so
 * a first mile that lists only stations tells most riders there is nothing nearby. This
 * lists the nearest stops that between them cover every distinct bus route in reach:
 * candidates are taken nearest first, and a stop is kept only if it serves a route no
 * nearer stop already does — one stop per service, not every pole on the street.
 *
 * Only stops in the feeds loaded into the routing engine are considered, so every one
 * listed is one a modelled journey can board at. As with stations, distance and time
 * come from a real walking route, never the straight line.
 */
export async function computeFirstMileBusAccess(
  origin: GeoPoint,
  thresholdMinutes = DEFAULT_FIRST_MILE_THRESHOLD_MINUTES,
  signal: AbortSignal,
): Promise<FirstMileBusStopResult[]> {
  const doc = await loadStopServices();
  signal.throwIfAborted();

  const maximumMetres = thresholdMinutes * 60 * WALK_SPEED_MS;
  const nearby = doc.stops
    .map(([stopId, name, lat, lon, routes]) => ({
      stop: { stopId, name, lat, lon },
      routeIndexes: routes,
      straight: straightLineMetres(origin, { lat, lon }),
    }))
    .filter(candidate => candidate.straight <= maximumMetres)
    .sort((a, b) => a.straight - b.straight);

  const covered = new Set<number>();
  const candidates = nearby.filter(candidate => {
    if (!candidate.routeIndexes.some(index => !covered.has(index))) return false;
    candidate.routeIndexes.forEach(index => covered.add(index));
    return true;
  }).slice(0, MAX_BUS_CANDIDATES);

  const stations = new Map(loadRailStops().map(stop => [stop.stopId, stop]));

  const settled = await Promise.allSettled(
    candidates.map(async candidate => {
      const route: WalkingRoute = candidate.straight < 10
        ? { distanceMeters: 0, durationSeconds: 0, geometry: [origin] }
        : await routeWalking(origin, candidate.stop, signal);
      return { candidate, route };
    }),
  );
  signal.throwIfAborted();

  const walked = settled
    .flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
    .filter(({ route }) => route.durationSeconds <= thresholdMinutes * 60)
    .sort((a, b) => a.route.distanceMeters - b.route.distanceMeters);

  // The walk can reorder stops the straight line put first, so routes are assigned again,
  // nearest walk first: a stop keeps only the routes no nearer-by-foot stop offers.
  const shown = new Set<number>();
  const results: FirstMileBusStopResult[] = [];
  for (const { candidate, route } of walked) {
    const fresh = candidate.routeIndexes.filter(index => !shown.has(index));
    if (fresh.length === 0) continue;
    fresh.forEach(index => shown.add(index));
    results.push({
      stop: candidate.stop,
      route,
      routes: fresh.map(index => {
        const r = doc.routes[index];
        return {
          routeId: r.id,
          name: r.name,
          description: r.description,
          // Nearest to this stop first: those are where a rider boarding here would
          // change to the train, which is what the list is for. A route's full station
          // list, in any fixed order, would name the far end of the line just as readily.
          railStations: r.railLinks
            .flatMap(id => stations.get(id) ?? [])
            .sort((a, b) =>
              straightLineMetres(candidate.stop, stopPoint(a)) -
              straightLineMetres(candidate.stop, stopPoint(b)))
            .map(station => titleCase(station.name)),
        };
      }),
    });
    if (results.length === MAX_BUS_STOPS) break;
  }
  return results;
}
