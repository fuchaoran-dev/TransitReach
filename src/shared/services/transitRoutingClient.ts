/**
 * Point-to-point journey client for the self-hosted OpenTripPlanner instance.
 *
 * Epic 4 uses this endpoint only to inspect modelled journeys to a selected destination.
 * It does not hand the user off to a third-party directions product.
 */

const BASE_URL = (import.meta.env.VITE_OTP_BASE_URL ?? '').replace(/\/$/, '');

export interface TransitPlanPoint {
  name: string;
  stopId: string | null;
  lat: number;
  lon: number;
}

export interface TransitPlanLeg {
  mode: string;
  routeId: string | null;
  routeShortName: string | null;
  routeLongName: string | null;
  routeColor: string | null;
  durationSeconds: number;
  distanceMeters: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  from: TransitPlanPoint;
  to: TransitPlanPoint;
  geometry: Array<{ lat: number; lon: number }>;
  transitLeg: boolean;
}

export interface TransitPlanItinerary {
  durationSeconds: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  walkTimeSeconds: number;
  waitingTimeSeconds: number;
  transitTimeSeconds: number;
  transfers: number;
  legs: TransitPlanLeg[];
}

interface OtpPlace {
  name?: string;
  stopId?: unknown;
  lat?: number;
  lon?: number;
}

interface OtpLeg {
  mode?: string;
  routeId?: string;
  route?: string;
  routeShortName?: string;
  routeLongName?: string;
  routeColor?: string;
  duration?: number;
  distance?: number;
  startTime?: number;
  endTime?: number;
  from?: OtpPlace;
  to?: OtpPlace;
  transitLeg?: boolean;
  legGeometry?: {
    points?: string;
  };
}

interface OtpItinerary {
  duration?: number;
  startTime?: number;
  endTime?: number;
  walkTime?: number;
  waitingTime?: number;
  transitTime?: number;
  transfers?: number;
  legs?: OtpLeg[];
}

interface OtpPlanResponse {
  plan?: {
    itineraries?: OtpItinerary[];
  };
  error?: {
    message?: string;
  };
}

export class TransitJourneyUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TransitJourneyUnavailableError';
  }
}

function normalizeStopId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;

  const candidate = value as {
    id?: unknown;
    agencyId?: unknown;
  };

  if (typeof candidate.id !== 'string') return null;
  if (typeof candidate.agencyId === 'string' && candidate.agencyId) {
    return `${candidate.agencyId}:${candidate.id}`;
  }
  return candidate.id;
}

/** Decode the encoded polyline used by OTP's legacy REST plan response. */
function decodePolyline(encoded: string): Array<{ lat: number; lon: number }> {
  const points: Array<{ lat: number; lon: number }> = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({
      lat: lat / 1e5,
      lon: lon / 1e5,
    });
  }

  return points;
}

function pointFromOtp(place: OtpPlace | undefined, fallbackName: string): TransitPlanPoint {
  return {
    name: place?.name?.trim() || fallbackName,
    stopId: normalizeStopId(place?.stopId),
    lat: typeof place?.lat === 'number' ? place.lat : 0,
    lon: typeof place?.lon === 'number' ? place.lon : 0,
  };
}

function normalizeRouteColor(value: string | undefined): string | null {
  if (!value) return null;
  const clean = value.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean}` : null;
}

function normalizeLeg(leg: OtpLeg): TransitPlanLeg {
  const mode = (leg.mode ?? 'UNKNOWN').toUpperCase();
  return {
    mode,
    routeId: leg.routeId ?? null,
    routeShortName: leg.routeShortName ?? leg.route ?? null,
    routeLongName: leg.routeLongName ?? null,
    routeColor: normalizeRouteColor(leg.routeColor),
    durationSeconds: Math.max(0, leg.duration ?? 0),
    distanceMeters: Math.max(0, leg.distance ?? 0),
    startTimeMs: typeof leg.startTime === 'number' ? leg.startTime : null,
    endTimeMs: typeof leg.endTime === 'number' ? leg.endTime : null,
    from: pointFromOtp(leg.from, 'Journey point'),
    to: pointFromOtp(leg.to, 'Journey point'),
    geometry: leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points) : [],
    transitLeg: leg.transitLeg ?? mode !== 'WALK',
  };
}

function normalizeItinerary(itinerary: OtpItinerary): TransitPlanItinerary | null {
  const legs = (itinerary.legs ?? []).map(normalizeLeg);
  if (legs.length === 0) return null;

  const fallbackDuration = legs.reduce((total, leg) => total + leg.durationSeconds, 0);

  return {
    durationSeconds: Math.max(0, itinerary.duration ?? fallbackDuration),
    startTimeMs: typeof itinerary.startTime === 'number' ? itinerary.startTime : null,
    endTimeMs: typeof itinerary.endTime === 'number' ? itinerary.endTime : null,
    walkTimeSeconds: Math.max(0, itinerary.walkTime ?? 0),
    waitingTimeSeconds: Math.max(0, itinerary.waitingTime ?? 0),
    transitTimeSeconds: Math.max(0, itinerary.transitTime ?? 0),
    transfers: Math.max(0, itinerary.transfers ?? 0),
    legs,
  };
}

async function fetchPlan(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  mode: 'WALK' | 'TRANSIT,WALK',
  departureTime: string,
  numItineraries: number,
  signal?: AbortSignal,
): Promise<TransitPlanItinerary[]> {
  const [date, clock] = departureTime.split('T');
  const params = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lon}`,
    toPlace: `${destination.lat},${destination.lon}`,
    mode,
    date,
    time: clock.slice(0, 8),
    arriveBy: 'false',
    numItineraries: String(numItineraries),
    locale: 'en',
  });

  let response: Response;
  try {
    response = await fetch(
      `${BASE_URL}/otp/routers/default/plan?${params.toString()}`,
      { signal },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TransitJourneyUnavailableError(
      'Could not reach the journey routing service.',
      error,
    );
  }

  if (!response.ok) {
    throw new TransitJourneyUnavailableError(
      `Journey routing service returned ${response.status}.`,
    );
  }

  const body = (await response.json()) as OtpPlanResponse;
  return (body.plan?.itineraries ?? [])
    .map(normalizeItinerary)
    .filter((itinerary): itinerary is TransitPlanItinerary => itinerary !== null);
}

function itinerarySignature(itinerary: TransitPlanItinerary): string {
  const legSignature = itinerary.legs
    .map(leg => `${leg.mode}:${leg.routeId ?? leg.routeShortName ?? ''}`)
    .join('>');
  return `${Math.round(itinerary.durationSeconds / 30)}:${legSignature}`;
}

/**
 * Returns both a walking-only option and public-transport options where OTP can model them.
 * Duplicate itineraries are removed deterministically.
 */
export async function routeJourneys(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  departureTime: string,
  signal?: AbortSignal,
): Promise<TransitPlanItinerary[]> {
  const results = await Promise.allSettled([
    fetchPlan(origin, destination, 'WALK', departureTime, 1, signal),
    fetchPlan(origin, destination, 'TRANSIT,WALK', departureTime, 4, signal),
  ]);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const successful = results.flatMap(result =>
    result.status === 'fulfilled' ? result.value : [],
  );

  if (successful.length === 0) {
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (firstFailure) throw firstFailure.reason;
  }

  const unique = new Map<string, TransitPlanItinerary>();
  for (const itinerary of successful) {
    const signature = itinerarySignature(itinerary);
    const existing = unique.get(signature);
    if (!existing || itinerary.durationSeconds < existing.durationSeconds) {
      unique.set(signature, itinerary);
    }
  }

  return [...unique.values()].sort(
    (a, b) => a.durationSeconds - b.durationSeconds,
  );
}
