/**
 * Client for the self-hosted OpenTripPlanner instance.
 *
 * Reachability is computed by routing over the real OSM street network and the rail
 * schedule. Nothing here substitutes straight-line distance for a walking component, and
 * the engine is ours rather than a third party's, so no user coordinate is handed to an
 * outside routing service.
 *
 * Setup, version pinning and the traps involved are documented in routing/README.md.
 */

import { loadRailFeedMetadata } from './gtfsAdapter';

/**
 * Where the routing service lives.
 *
 * Empty by default, meaning the app's **own origin**: requests go to `/otp/...` and are
 * proxied to the routing engine — by Netlify in production via `public/_redirects`, and
 * by the Vite dev server via the matching rule in `vite.config.ts`. Both read the same
 * address from the same file, so dev and production take the same route.
 *
 * This deliberately does not fall back to localhost. A deployed build that did would ask
 * every visitor's own machine for routing: it fails for all of them, looks exactly like
 * the routing server being down, and gives the deployer no hint that a missing
 * environment variable is the cause. Same-origin means deployment needs no configuration
 * beyond the redirect rule, which travels with the code.
 *
 * `VITE_OTP_BASE_URL` overrides it, for pointing at an engine other than the one in
 * `public/_redirects` without editing that file. Vite inlines it at build and dev-server
 * start, so it needs a restart or rebuild, never just a save.
 */
const BASE_URL = (import.meta.env.VITE_OTP_BASE_URL ?? '').replace(/\/$/, '');


/**
 * Departure time used for every computation.
 *
 * PROVISIONAL and deliberately arbitrary — a weekday 08:00 inside the feed's service
 * window. Epics 1, 2, 5, 6 and 8 must eventually share one agreed value or their numbers
 * will not reconcile with each other. This is surfaced in the interface rather than left
 * buried here, because a reachable area means nothing without the hour it was computed for.
 */
export const DEPARTURE_TIME = '2026-09-01T08:00:00+08:00';
export const DEPARTURE_TIME_LABEL = 'Tuesday 08:00';
export const DEPARTURE_TIME_IS_PROVISIONAL = true;

export type TravelMode = 'walking' | 'transit' | 'multimodal';

/**
 * The mode every screen computes with.
 *
 * The interface used to offer all three as a setting. That asked the user to choose a
 * modelling assumption rather than describe a trip: a rider without a car walks *and*
 * rides, and the walking-only case is already reported as a finding by AC 1.2.4 when no
 * service can be boarded. The type keeps all three because the routing engine accepts
 * them and the walk-only isochrone is still requested internally to detect that case.
 */
export const TRAVEL_MODE: TravelMode = 'multimodal';

/**
 * Walking speed OTP is configured with, in metres per second.
 * Mirrors `routingDefaults.walk.speed` in routing/otp/router-config.json.
 * AC 1.2.3 requires this to be stated in the interface; if you change one, change both.
 */
export const WALK_SPEED_MS = 1.33;

/**
 * Transit modes present in the loaded feed. Every rail route is SUBWAY; BRT Sunway is TRAM.
 */
const TRANSIT_MODES = 'WALK,SUBWAY,TRAM';

/**
 * Sentinel used to obtain a walking-only isochrone.
 *
 * OTP's TravelTime endpoint cannot be asked to exclude transit: passing `modes=WALK`
 * produces an *empty* transit-mode filter, which OTP treats as "no restriction" and so
 * includes every mode. The only way to get a walking-only result is to name a transit
 * mode the feed does not contain.
 *
 * FUNICULAR is chosen over the more obvious RAIL or BUS precisely because those become
 * real once the bus and feeder feeds are loaded, which would silently turn this into a
 * transit-inclusive query. Klang Valley has no funicular. `assertSentinelUnused()` fails
 * loudly if that ever stops being true.
 */
const WALK_ONLY_MODES = 'WALK,FUNICULAR';

export interface Ring {
  /** GeoJSON order: [lon, lat]. */
  coordinates: [number, number][];
}

export interface IsochroneRegion {
  outer: [number, number][];
  holes: [number, number][][];
}

export interface IsochroneResult {
  budgetMinutes: number;
  /** Disjoint regions. AC 1.3.1 forbids merging these into one enclosing shape. */
  regions: IsochroneRegion[];
  areaKm2: number;
}

export class RoutingUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'RoutingUnavailableError';
  }
}

export class RoutingTimeoutError extends Error {
  constructor(readonly limitMs: number) {
    super(`Reachability computation exceeded ${limitMs} ms.`);
    this.name = 'RoutingTimeoutError';
  }
}

/**
 * How long a computation may run before it is abandoned.
 *
 * AC 1.3.2 left this value blocked, pending a benchmark of a routing engine that had not
 * been stood up. It has been. Measured against the local instance over 36 runs — 9 origins
 * spread across the network × the four budgets, timing both isochrones in parallel exactly
 * as the app issues them:
 *
 *     p50 460 ms   p95 1075 ms   max 1089 ms
 *
 * 15 s is roughly 14× the observed maximum. The headroom is deliberate: those figures come
 * from a local instance with no network in the path, and the deployed engine will sit
 * behind real latency on a smaller machine than this one. Re-measure once it is hosted —
 * this number should come down, not stay at a figure chosen to be safe for an unknown.
 */
export const COMPUTATION_TIMEOUT_MS = 15_000;

/** Guards the walking-only sentinel against the feed growing a funicular. */
function assertSentinelUnused(): void {
  const modes = loadRailFeedMetadata()
    .feeds.flatMap(f => f.lines)
    .map(l => l.mode.toUpperCase());
  if (modes.includes('FUNICULAR')) {
    throw new Error(
      'The loaded feed contains a FUNICULAR route, which is used as the walking-only ' +
      'sentinel in routingAdapter. Pick a different absent mode and update WALK_ONLY_MODES.',
    );
  }
}

// ---------------------------------------------------------------- geometry

const EARTH_KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Shoelace area of a ring in km², using a local equirectangular approximation. */
function ringAreaKm2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const kx = kmPerDegLon(lat0);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * kx * (y2 * EARTH_KM_PER_DEG_LAT) - x2 * kx * (y1 * EARTH_KM_PER_DEG_LAT);
  }
  return Math.abs(sum / 2);
}

/** Total area of the regions, with holes subtracted. */
function totalAreaKm2(regions: IsochroneRegion[]): number {
  return regions.reduce(
    (sum, r) => sum + ringAreaKm2(r.outer) - r.holes.reduce((h, ring) => h + ringAreaKm2(ring), 0),
    0,
  );
}

interface OtpGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

function toRegions(geometry: OtpGeometry): IsochroneRegion[] {
  const polygons = (
    geometry.type === 'MultiPolygon'
      ? (geometry.coordinates as number[][][][])
      : [geometry.coordinates as number[][][]]
  );
  return polygons
    .filter(rings => rings.length > 0)
    .map(rings => ({
      outer: rings[0] as [number, number][],
      holes: rings.slice(1) as [number, number][][],
    }));
}

// ---------------------------------------------------------------- requests

async function fetchIsochrone(
  origin: { lat: number; lon: number },
  budgetMinutes: number,
  modes: string,
  departureTime: string,
  signal: AbortSignal,
): Promise<IsochroneRegion[]> {
  const url =
    `${BASE_URL}/otp/traveltime/isochrone?batch=true` +
    `&location=${origin.lat},${origin.lon}` +
    `&time=${encodeURIComponent(departureTime)}` +
    `&modes=${modes}&arriveBy=false&cutoff=${budgetMinutes}M`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new RoutingUnavailableError('Could not reach the routing service.', error);
  }
  if (!response.ok) {
    throw new RoutingUnavailableError(`Routing service returned ${response.status}.`);
  }

  const body = (await response.json()) as { features?: { geometry: OtpGeometry }[] };
  const feature = body.features?.[0];
  if (!feature) return [];
  return toRegions(feature.geometry);
}

export interface ReachabilityComputation {
  result: IsochroneResult;
  /**
   * True when no transit could be boarded within the budget, so the area shown is
   * walking only. AC 1.2.4 treats this as a valid finding, never an error.
   */
  walkingOnly: boolean;
}

/**
 * Computes the reachable area, and determines whether any transit was boardable.
 *
 * Both isochrones are requested concurrently. The walking-only one is needed either way:
 * it is what gets displayed when nothing can be boarded, and comparing the two is how
 * that condition is detected — OTP does not report it.
 */
export async function computeReachability(
  origin: { lat: number; lon: number },
  budgetMinutes: number,
  signal: AbortSignal,
  departureTime = DEPARTURE_TIME,
  mode: TravelMode = 'multimodal',
): Promise<ReachabilityComputation> {
  assertSentinelUnused();

  // The caller's signal (a superseded run) and the time limit both cancel the requests,
  // but they are different outcomes: one is discarded silently, the other is reported.
  // `timedOut` is what tells them apart once the fetch has already rejected as aborted.
  const inner = new AbortController();
  let timedOut = false;
  const abortInner = () => inner.abort();
  signal.addEventListener('abort', abortInner);
  const timer = setTimeout(() => {
    timedOut = true;
    inner.abort();
  }, COMPUTATION_TIMEOUT_MS);

  let full: IsochroneRegion[];
  let walkOnly: IsochroneRegion[] = [];
  try {
    if (mode === 'walking') {
      full = await fetchIsochrone(origin, budgetMinutes, WALK_ONLY_MODES, departureTime, inner.signal);
      walkOnly = full;
    } else {
      [full, walkOnly] = await Promise.all([
        fetchIsochrone(origin, budgetMinutes, TRANSIT_MODES, departureTime, inner.signal),
        fetchIsochrone(origin, budgetMinutes, WALK_ONLY_MODES, departureTime, inner.signal),
      ]);
    }
  } catch (error) {
    if (timedOut) throw new RoutingTimeoutError(COMPUTATION_TIMEOUT_MS);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abortInner);
  }

  const fullArea = totalAreaKm2(full);
  const walkArea = totalAreaKm2(walkOnly);

  // If no service can be boarded the two computations are the same search, so their
  // areas coincide. A small tolerance absorbs contouring noise.
  const walkingOnly = mode === 'walking' || fullArea <= walkArea * 1.005;
  const regions = walkingOnly ? walkOnly : full;

  return {
    walkingOnly,
    result: {
      budgetMinutes,
      regions,
      areaKm2: mode === 'walking' ? fullArea : walkingOnly ? walkArea : fullArea,
    },
  };
}

interface OtpPlanResponse {
  plan?: { itineraries?: Array<{ duration?: number }> };
  error?: { message?: string };
}

/**
 * Returns the shortest OTP itinerary duration for one real OSM service coordinate.
 * The duration includes walking access/egress, transit and schedule waiting time.
 */
export async function estimateTravelTime(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  mode: TravelMode,
  departureTime = DEPARTURE_TIME,
  signal?: AbortSignal,
): Promise<number | null> {
  const [date, clock] = departureTime.split('T');
  const params = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lon}`,
    toPlace: `${destination.lat},${destination.lon}`,
    mode: mode === 'walking' ? 'WALK' : 'TRANSIT,WALK',
    date,
    time: clock.slice(0, 8),
    arriveBy: 'false',
    numItineraries: '1',
    locale: 'en',
  });

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/otp/routers/default/plan?${params.toString()}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RoutingUnavailableError('Could not reach the routing service.', error);
  }
  if (!response.ok) throw new RoutingUnavailableError(`Routing service returned ${response.status}.`);

  const body = await response.json() as OtpPlanResponse;
  const durationSeconds = body.plan?.itineraries?.[0]?.duration;
  return typeof durationSeconds === 'number' ? Math.ceil(durationSeconds / 60) : null;
}
