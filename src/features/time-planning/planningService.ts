import type { LatLng } from '@/features/reachability/types';
import type { ServiceCategory, ServiceLocation } from '@/shared/types/service';
import { computeReachability, TRAVEL_MODE, type IsochroneRegion } from '@/shared/data/adapters/routingAdapter';
import { routeJourneys, type TransitPlanItinerary } from '@/shared/services/transitRoutingClient';
import { arrivalAvailability } from '@/features/essential-services/arrivalAvailability';
import { overlapContains } from '@/features/meeting-point/overlapService';
import { deduplicateServices } from '@/features/essential-services/serviceDataRules';
import type { WeatherDay } from '@/pages/components/WeatherPlanning';

export type Availability = 'available' | 'unavailable' | 'unknown';
export type PlanningPreference = 'avoid-rain' | 'less-walking' | 'fastest';
export type WeatherCondition = 'dry' | 'rain' | 'storm' | 'cloud' | 'haze' | 'unknown';
export interface ServiceEvidence {
  service: ServiceLocation;
  reachable: boolean;
  availability: Availability;
  reason: string;
}
export interface ServiceSnapshot {
  departure: string;
  regions: IsochroneRegion[];
  area: number;
  entries: ServiceEvidence[];
}
export interface DepartureOption {
  departure: string;
  availability: Availability;
  reason: string;
  travelMinutes?: number;
  walkMinutes?: number;
  transfers?: number;
  weather: WeatherCondition;
  weatherLabel: string;
  weatherComplete: boolean;
  wetWalkingMinutes?: number;
}

export const malaysiaInstant = (wallTime: string) => `${wallTime}:00+08:00`;
export function matchesService(service: ServiceLocation, categories: ReadonlySet<ServiceCategory>, query: string, labels: Record<ServiceCategory, string>) {
  const text = query.trim().toLowerCase();
  return (categories.size === 0 || categories.has(service.category)) &&
    (!text || service.name.toLowerCase().includes(text) || labels[service.category].toLowerCase().includes(text));
}

function aborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Planning cancelled', 'AbortError');
}
/** Bound the routing load: only two destinations at once, and every request can time out. */
export async function mapLimited<T, R>(values: T[], signal: AbortSignal, task: (value: T) => Promise<R>, progress?: (done: number, total: number) => void): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(2, values.length) }, async () => {
    while (cursor < values.length) {
      aborted(signal);
      const index = cursor++;
      results[index] = await task(values[index]);
      aborted(signal);
      progress?.(++done, values.length);
    }
  }));
  return results;
}

async function timedRoutes(origin: LatLng, service: ServiceLocation, departure: string, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20_000);
  try {
    aborted(signal);
    return await routeJourneys(origin, { lat: service.lat!, lon: service.lon! }, malaysiaInstant(departure), controller.signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Include initial waiting, not just OTP's in-vehicle itinerary duration. */
export function elapsedMinutes(route: TransitPlanItinerary, departure: string): number | null {
  const requested = Date.parse(malaysiaInstant(departure));
  if (!Number.isFinite(requested) || route.endTimeMs == null || route.startTimeMs == null || route.startTimeMs < requested || route.endTimeMs < route.startTimeMs) return null;
  const elapsed = (route.endTimeMs - requested) / 60_000;
  return Number.isFinite(elapsed) ? elapsed : null;
}

function routeAvailability(service: ServiceLocation, departure: string, routes: TransitPlanItinerary[], budget: number) {
  const within = routes.map(route => ({ route, minutes: elapsedMinutes(route, departure) }))
    .filter((item): item is { route: TransitPlanItinerary; minutes: number } => item.minutes !== null && item.minutes <= budget);
  if (!within.length) {
    const incomplete = routes.some(route => elapsedMinutes(route, departure) === null);
    return { availability: incomplete ? 'unknown' as const : 'unavailable' as const, reason: incomplete ? 'Route timing incomplete' : 'No scheduled journey within the travel budget', options: [] };
  }
  const options = within.map(item => ({ ...item, hours: arrivalAvailability(service.hours, malaysiaInstant(departure), item.minutes) }));
  const open = options.filter(item => item.hours.status === 'Open');
  if (open.length) return { availability: 'available' as const, reason: 'Scheduled journey within budget; estimated open at arrival', options: open };
  if (options.some(item => item.hours.status === 'Unknown')) return { availability: 'unknown' as const, reason: options.find(item => item.hours.status === 'Unknown')!.hours.reason, options: within };
  return { availability: 'unavailable' as const, reason: options[0].hours.status === 'Closing before arrival' ? 'Closes before estimated arrival' : 'Closed at estimated arrival', options: [] };
}

export async function serviceSnapshot(origin: LatLng, budget: number, departure: string, services: ServiceLocation[], signal: AbortSignal, progress?: (done: number, total: number) => void): Promise<ServiceSnapshot> {
  const { result } = await computeReachability(origin, budget, signal, malaysiaInstant(departure), TRAVEL_MODE);
  aborted(signal);
  const contains = overlapContains(result.regions.map(region => [region.outer, ...region.holes]));
  const entries = await mapLimited(deduplicateServices(services), signal, async (service): Promise<ServiceEvidence> => {
    const reachable = contains(service.lat!, service.lon!);
    if (!reachable) return { service, reachable, availability: 'unavailable', reason: 'Outside the modelled reachable area' };
    if (!service.hours?.trim()) return { service, reachable, availability: 'unknown', reason: 'Opening hours missing from source' };
    try {
      const evidence = routeAvailability(service, departure, await timedRoutes(origin, service, departure, signal), budget);
      return { service, reachable, availability: evidence.availability, reason: evidence.reason };
    } catch {
      aborted(signal);
      return { service, reachable, availability: 'unknown', reason: 'Route check failed or timed out' };
    }
  }, progress);
  return { departure, regions: result.regions, area: result.areaKm2, entries };
}

export type ComparisonScope = 'reachable' | 'available';
export function compareServices(a: ServiceSnapshot, b: ServiceSnapshot, scope: ComparisonScope) {
  const left = new Map(a.entries.map(entry => [entry.service.id, entry]));
  const right = new Map(b.entries.map(entry => [entry.service.id, entry]));
  const changes = [...new Set([...left.keys(), ...right.keys()])].map(id => {
    const before = left.get(id);
    const after = right.get(id);
    const service = (after ?? before)!.service;
    const state = (entry: ServiceEvidence | undefined): Availability => scope === 'reachable'
      ? entry?.reachable ? 'available' : 'unavailable'
      : entry?.availability ?? 'unknown';
    const oldState = state(before); const newState = state(after);
    const kind = oldState === 'unknown' || newState === 'unknown' ? 'unknown'
      : oldState !== 'available' && newState === 'available' ? 'gained'
      : oldState === 'available' && newState !== 'available' ? 'lost'
      : oldState === 'available' ? 'both' : 'neither';
    return { service, before, after, kind, current: newState === 'available' };
  });
  return changes;
}

export function weatherCondition(summary: string): WeatherCondition {
  const text = summary.trim().toLowerCase();
  if (/ribut|thunder/.test(text)) return 'storm';
  if (/tiada hujan|no rain/.test(text)) return 'dry';
  if (/hujan|rain|shower/.test(text)) return 'rain';
  if (/jerebu|haze/.test(text)) return 'haze';
  if (/mendung|berawan|cloud|overcast/.test(text)) return 'cloud';
  return 'unknown';
}

/** Check every walking period crossed, not only the departure's forecast icon. */
export function walkingWeather(route: TransitPlanItinerary, days: WeatherDay[]) {
  const portions: { condition: WeatherCondition; minutes: number }[] = [];
  for (const leg of route.legs.filter(leg => leg.mode === 'WALK')) {
    if (leg.startTimeMs == null || leg.endTimeMs == null || leg.endTimeMs <= leg.startTimeMs) return { weather: 'unknown' as const, weatherComplete: false, weatherLabel: 'Walking timing unavailable', wetWalkingMinutes: undefined };
    for (let cursor = leg.startTimeMs; cursor < leg.endTimeMs;) {
      const wall = new Date(cursor + 8 * 3_600_000).toISOString();
      const date = wall.slice(0, 10); const hour = Number(wall.slice(11, 13));
      const day = days.find(item => item.date === date);
      const period = hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 19 ? 'afternoon' : 'night';
      const boundary = hour < 6 ? 6 : hour < 12 ? 12 : hour < 19 ? 19 : 24;
      const next = Math.min(leg.endTimeMs, Date.parse(`${date}T00:00:00+08:00`) + boundary * 3_600_000);
      portions.push({ condition: weatherCondition(day?.[period] ?? ''), minutes: (next - cursor) / 60_000 });
      cursor = next;
    }
  }
  // No timed walking legs does not establish that the outdoor exposure was checked.
  const complete = portions.length > 0 && portions.every(part => part.condition !== 'unknown');
  const wet = portions.filter(part => part.condition === 'rain' || part.condition === 'storm').reduce((sum, part) => sum + part.minutes, 0);
  const weather: WeatherCondition = !complete ? 'unknown' : portions.some(part => part.condition === 'storm') ? 'storm' : wet > 0 ? 'rain' : portions.some(part => part.condition === 'haze') ? 'haze' : portions.some(part => part.condition === 'cloud') ? 'cloud' : 'dry';
  const labels: Record<WeatherCondition, string> = { dry: 'No rain forecast during walking periods', rain: 'Rain forecast during walking', storm: 'Thunderstorms forecast during walking', haze: 'Haze forecast during walking', cloud: 'Cloudy during walking periods', unknown: 'Weather not fully checked' };
  return { weather, weatherComplete: complete, weatherLabel: labels[weather], wetWalkingMinutes: complete ? wet : undefined };
}

export function departureCandidates(dates: string[], from: string, to: string, now = Date.now()) {
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  const start = minutes(from); const end = minutes(to);
  const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!clockPattern.test(from) || !clockPattern.test(to) || start > end) return [];
  const result: string[] = [];
  for (const date of dates) {
    for (let minute = start; minute <= end; minute += 60) {
      const wall = `${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      if (Date.parse(malaysiaInstant(wall)) >= now) result.push(wall);
    }
  }
  return result;
}

export function rankDepartures(options: DepartureOption[], preference: PlanningPreference): DepartureOption[] {
  // Unknown opening/arrival evidence never becomes a feasible recommendation.
  // Avoid-rain cannot rank missing weather as good weather.
  const eligible = options.filter(option => option.availability === 'available' && option.travelMinutes != null && option.walkMinutes != null && option.transfers != null &&
    (preference !== 'avoid-rain' || option.weatherComplete));
  const weatherRank = (option: DepartureOption) => option.weather === 'storm' ? 3 : option.weather === 'rain' ? 2 : option.weather === 'haze' ? 1 : 0;
  const keys = (option: DepartureOption) => preference === 'avoid-rain'
    ? [weatherRank(option), option.wetWalkingMinutes!, option.walkMinutes!, option.travelMinutes!, option.transfers!]
    : preference === 'less-walking' ? [option.walkMinutes!, option.transfers!, option.travelMinutes!]
    : [option.travelMinutes!, option.walkMinutes!, option.transfers!];
  return [...eligible].sort((a, b) => {
    const left = keys(a); const right = keys(b);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return a.departure.localeCompare(b.departure);
  });
}

export async function evaluateDeparture(origin: LatLng, service: ServiceLocation, departure: string, budget: number, days: WeatherDay[], preference: PlanningPreference, signal: AbortSignal): Promise<DepartureOption> {
  const base = { departure, weather: 'unknown' as const, weatherLabel: 'Weather not checked', weatherComplete: false };
  try {
    const routes = await timedRoutes(origin, service, departure, signal);
    const evidence = routeAvailability(service, departure, routes, budget);
    if (evidence.availability !== 'available') return { ...base, availability: evidence.availability, reason: evidence.reason };
    const choices: DepartureOption[] = evidence.options.map(({ route, minutes }) => ({
      departure, availability: 'available', reason: evidence.reason,
      travelMinutes: minutes, walkMinutes: route.walkTimeSeconds / 60, transfers: route.transfers,
      ...walkingWeather(route, days),
    }));
    // Return an unchecked option for display if none has enough forecast evidence.
    return rankDepartures(choices, preference)[0] ?? { ...choices[0], reason: 'Venue is estimated open, but weather evidence is incomplete' };
  } catch {
    aborted(signal);
    return { ...base, availability: 'unknown', reason: 'Route service unavailable or timed out' };
  }
}
