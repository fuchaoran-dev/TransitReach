import OpeningHours from 'opening_hours';
import type { ConfirmedMeetingPlan } from '@/features/meeting-point/types';
import { routeArriveByJourneys, type TransitPlanItinerary } from '@/shared/services/transitRoutingClient';
import { fetchBusDelay } from './reliabilityClient';
import type {
  CheckedPassLeg,
  ClosingMargin,
  ConnectionCheck,
  JourneyOptionSummary,
  PassWeakPoint,
  PersonalPass,
  PersonalPassStatus,
  WeatherEvidence,
} from './types';
import { PASS_SCHEMA_VERSION } from './types';
import {
  fetchOfficialForecast,
  walkingWeatherFromForecast,
  weatherDistrictForVenue,
  type OfficialForecastSnapshot,
} from './weatherService';

export interface CheckPersonalPlanInput {
  roomCode: string;
  memberId: string;
  plan: ConfirmedMeetingPlan;
  origin: { lat: number; lon: number };
  /** Earlier route target used by the personal “Leave earlier” fix. */
  routeTargetTime?: string;
}

export interface CheckedPassOptions {
  passes: PersonalPass[];
  summaries: JourneyOptionSummary[];
}

const MINUTE_MS = 60_000;

function isoAt(value: number | null, offsetSeconds: number): string | null {
  return value === null ? null : new Date(value + offsetSeconds * 1000).toISOString();
}

function malaysiaWallTime(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(item => item.type === type)?.value);
  return new Date(
    number('year'),
    number('month') - 1,
    number('day'),
    number('hour'),
    number('minute'),
    number('second'),
  );
}

export function evaluateClosingMargin(hours: string | undefined, arrivalTime: string): ClosingMargin {
  if (!hours) return { status: 'not-checked', reason: 'hours-missing', label: 'Hours unknown' };
  if (/\b(PH|SH|sunrise|sunset|dawn|dusk|easter)\b/i.test(hours)) {
    return { status: 'not-checked', reason: 'hours-conditional', label: 'Hours unknown' };
  }
  const arrival = new Date(arrivalTime);
  if (!Number.isFinite(arrival.getTime())) {
    return { status: 'not-checked', reason: 'closing-time-unavailable', label: 'Hours unknown' };
  }

  try {
    const parsed = new OpeningHours(hours);
    const wallArrival = malaysiaWallTime(arrival);
    if (parsed.getUnknown(wallArrival)) {
      return { status: 'not-checked', reason: 'hours-conditional', label: 'Hours unknown' };
    }

    const source = 'OSM opening_hours; source freshness unverified';
    let closingWall: Date | null = null;
    if (parsed.getState(wallArrival)) {
      const nextChange = parsed.getNextChange(wallArrival, new Date(wallArrival.getTime() + 14 * 86_400_000));
      if (nextChange && !parsed.getState(new Date(nextChange.getTime() + 1000))) closingWall = nextChange;
      else if (!nextChange) return { status: 'always-open', label: 'Open 24 hours', source };
    } else {
      const intervals = parsed.getOpenIntervals(
        new Date(wallArrival.getTime() - 14 * 86_400_000),
        wallArrival,
      );
      closingWall = intervals.length > 0 ? intervals[intervals.length - 1][1] : null;
    }
    if (!closingWall) {
      return { status: 'not-checked', reason: 'closing-time-unavailable', label: 'Hours unknown' };
    }
    const marginSeconds = Math.round((closingWall.getTime() - wallArrival.getTime()) / 1000);
    return {
      status: 'checked',
      marginSeconds,
      closesAt: new Date(arrival.getTime() + marginSeconds * 1000).toISOString(),
      source,
    };
  } catch {
    return { status: 'not-checked', reason: 'hours-invalid', label: 'Hours unknown' };
  }
}

async function checkedLegs(itinerary: TransitPlanItinerary, signal?: AbortSignal): Promise<CheckedPassLeg[]> {
  const evidence = await Promise.all(itinerary.legs.map(leg => {
    if (leg.mode === 'WALK') return Promise.resolve(null);
    if (leg.mode !== 'BUS') {
      return Promise.resolve({
        status: 'not-checked' as const,
        reason: 'not-applicable' as const,
        label: 'Not checked' as const,
      });
    }
    const travelAt = new Date(leg.startTimeMs ?? itinerary.startTimeMs ?? Date.now()).toISOString();
    return fetchBusDelay(leg.routeId ?? leg.routeShortName, leg.from.stopId, travelAt, signal);
  }));

  let cumulativeDelaySeconds = 0;
  return itinerary.legs.map((leg, index) => {
    const delay = evidence[index];
    const ownDelaySeconds = delay?.status === 'checked' ? delay.seconds : 0;
    // A prior vehicle's delay follows the passenger through walking and downstream
    // arrival estimates. It must not move the next fixed service's departure; only that
    // service's own supported delay may do that. This is what lets a missed connection
    // become a negative spare-time result instead of cancelling the incoming delay out.
    const offsetAtStart = leg.transitLeg && leg.mode !== 'WALK'
      ? ownDelaySeconds
      : cumulativeDelaySeconds;
    if (delay?.status === 'checked') cumulativeDelaySeconds += delay.seconds;
    return {
      ...leg,
      id: `leg-${index}`,
      estimatedStartTime: isoAt(leg.startTimeMs, offsetAtStart),
      estimatedEndTime: isoAt(leg.endTimeMs, cumulativeDelaySeconds),
      cumulativeDelaySeconds,
      delay,
    };
  });
}

function connectionChecks(legs: CheckedPassLeg[]): ConnectionCheck[] {
  const transitIndexes = legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => leg.transitLeg && leg.mode !== 'WALK')
    .map(({ index }) => index);

  return transitIndexes.slice(1).map((toLegIndex, connectionIndex) => {
    const fromLegIndex = transitIndexes[connectionIndex];
    const from = legs[fromLegIndex];
    const to = legs[toLegIndex];
    const transferArrival = legs[toLegIndex - 1] ?? from;
    const arrivalMs = transferArrival.estimatedEndTime ? Date.parse(transferArrival.estimatedEndTime) : NaN;
    const departureMs = to.estimatedStartTime ? Date.parse(to.estimatedStartTime) : NaN;
    const checked = Number.isFinite(arrivalMs) && Number.isFinite(departureMs);
    return {
      id: `connection-${fromLegIndex}-${toLegIndex}`,
      atName: from.to.name || to.from.name || 'Connection',
      fromLegIndex,
      toLegIndex,
      estimatedArrivalTime: transferArrival.estimatedEndTime,
      estimatedDepartureTime: to.estimatedStartTime,
      spareSeconds: checked ? Math.round((departureMs - arrivalMs) / 1000) : null,
      status: checked ? 'checked' : 'not-checked',
    };
  });
}

interface MarginCandidate {
  kind: PassWeakPoint['kind'];
  label: string;
  marginSeconds: number;
  legId?: string;
  connectionId?: string;
}

function weakPoint(
  legs: CheckedPassLeg[],
  connections: ConnectionCheck[],
  arrivalMarginSeconds: number,
  closing: ClosingMargin,
): PassWeakPoint {
  const candidates: MarginCandidate[] = [
    {
      kind: 'arrival',
      marginSeconds: arrivalMarginSeconds,
      label: `The estimated arrival margin is ${Math.abs(Math.round(arrivalMarginSeconds / 60))} min ${arrivalMarginSeconds >= 0 ? 'before' : 'after'} the meeting time.`,
    },
    ...connections.flatMap(connection => connection.spareSeconds === null ? [] : [{
      kind: 'connection' as const,
      marginSeconds: connection.spareSeconds,
      connectionId: connection.id,
      label: `The tightest connection is at ${connection.atName}, with about ${Math.round(connection.spareSeconds / 60)} min spare.`,
    }]),
  ];
  if (closing.status === 'checked') {
    candidates.push({
      kind: 'closing',
      marginSeconds: closing.marginSeconds,
      label: `The meeting place is estimated to close ${Math.abs(Math.round(closing.marginSeconds / 60))} min ${closing.marginSeconds >= 0 ? 'after' : 'before'} arrival.`,
    });
  }
  const tightest = candidates.reduce((lowest, candidate) =>
    candidate.marginSeconds < lowest.marginSeconds ? candidate : lowest,
  );
  const uncheckedLeg = legs.find(leg => leg.transitLeg && leg.delay?.status === 'not-checked');
  if (uncheckedLeg && tightest.marginSeconds >= 0) {
    const name = uncheckedLeg.routeShortName
      ? `${uncheckedLeg.mode === 'BUS' ? 'Bus' : uncheckedLeg.mode} ${uncheckedLeg.routeShortName}`
      : `The ${uncheckedLeg.mode.toLowerCase()} leg`;
    return {
      kind: 'unchecked-delay',
      marginSeconds: null,
      legId: uncheckedLeg.id,
      label: `${name} delay is Not checked; the ${Math.round(arrivalMarginSeconds / 60)} min arrival margin does not include it.`,
    };
  }
  return tightest;
}

function passStatus(
  legs: CheckedPassLeg[],
  connections: ConnectionCheck[],
  arrivalMarginSeconds: number,
  closing: ClosingMargin,
  weather: WeatherEvidence[],
): PersonalPassStatus {
  const failedMargin = arrivalMarginSeconds < 0 ||
    connections.some(connection => connection.spareSeconds !== null && connection.spareSeconds < 0) ||
    (closing.status === 'checked' && closing.marginSeconds < 0);
  if (failedMargin) return 'Check needed';
  if (
    legs.some(leg => leg.transitLeg && leg.delay?.status === 'not-checked') ||
    connections.some(connection => connection.status === 'not-checked') ||
    closing.status === 'not-checked' ||
    weather.some(period => period.status === 'not-checked')
  ) return 'Not checked';
  return 'Ready';
}

async function buildPass(
  itinerary: TransitPlanItinerary,
  index: number,
  input: CheckPersonalPlanInput,
  forecast: OfficialForecastSnapshot | null,
  signal?: AbortSignal,
): Promise<PersonalPass | null> {
  if (itinerary.startTimeMs === null || itinerary.endTimeMs === null) return null;
  // The legacy OTP adapter uses zero for missing point fields. Neither coordinate is
  // zero in the Klang Valley, so those placeholders cannot describe a usable private pass.
  if (itinerary.legs.length === 0 || itinerary.legs.some(leg => [leg.from, leg.to].some(point =>
    !Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
    point.lat === 0 || point.lon === 0 || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180,
  ))) return null;
  const legs = await checkedLegs(itinerary, signal);
  const connections = connectionChecks(legs);
  const finalLeg = legs.length > 0 ? legs[legs.length - 1] : undefined;
  const estimatedArrivalTime = finalLeg?.estimatedEndTime ?? new Date(itinerary.endTimeMs).toISOString();
  const arrivalMarginSeconds = Math.round((Date.parse(input.plan.arrivalTime) - Date.parse(estimatedArrivalTime)) / 1000);
  if (!Number.isFinite(arrivalMarginSeconds)) return null;
  const closing = evaluateClosingMargin(input.plan.venue.hours, estimatedArrivalTime);
  const weather = walkingWeatherFromForecast(
    estimatedArrivalTime,
    legs,
    forecast,
  );
  const selectedJourneyId = `journey-${index}`;
  const checkedAt = new Date().toISOString();
  return {
    schemaVersion: PASS_SCHEMA_VERSION,
    kind: 'group-outing',
    id: `${input.roomCode}-v${input.plan.version}`,
    roomCode: input.roomCode,
    memberId: input.memberId,
    planVersion: input.plan.version,
    checkedAt,
    routeTargetTime: input.routeTargetTime ?? input.plan.arrivalTime,
    meeting: input.plan,
    selectedJourneyId,
    leaveTime: new Date(itinerary.startTimeMs).toISOString(),
    estimatedArrivalTime,
    arrivalMarginSeconds,
    status: passStatus(legs, connections, arrivalMarginSeconds, closing, weather),
    legs,
    connections,
    walking: {
      totalSeconds: legs.filter(leg => leg.mode === 'WALK').reduce((sum, leg) => sum + leg.durationSeconds, 0),
      totalDistanceMeters: legs.filter(leg => leg.mode === 'WALK').reduce((sum, leg) => sum + leg.distanceMeters, 0),
      directions: legs.flatMap(leg => leg.mode === 'WALK' ? leg.steps.map(step => ({ ...step, legId: leg.id })) : []),
    },
    weather,
    closingMargin: closing,
    weakPoint: weakPoint(legs, connections, arrivalMarginSeconds, closing),
  };
}

export async function checkPersonalPlan(
  input: CheckPersonalPlanInput,
  signal?: AbortSignal,
): Promise<CheckedPassOptions> {
  const [itineraries, forecast] = await Promise.all([
    routeArriveByJourneys(
      input.origin,
      { lat: input.plan.venue.lat, lon: input.plan.venue.lon },
      input.routeTargetTime ?? input.plan.arrivalTime,
      signal,
    ),
    fetchOfficialForecast(weatherDistrictForVenue(input.plan.venue), signal),
  ]);
  const checked = await Promise.all(itineraries.map((itinerary, index) =>
    buildPass(itinerary, index, input, forecast, signal),
  ));
  const passes = checked.filter((pass): pass is PersonalPass => pass !== null);
  if (passes.length === 0) throw new Error('No arrive-by journey is available for this meeting.');
  const summaries = passes.map((pass, index): JourneyOptionSummary => ({
    id: pass.selectedJourneyId,
    leaveTime: pass.leaveTime,
    estimatedArrivalTime: pass.estimatedArrivalTime,
    durationSeconds: Math.round((Date.parse(pass.estimatedArrivalTime) - Date.parse(pass.leaveTime)) / 1000),
    walkingSeconds: pass.walking.totalSeconds,
    transferCount: pass.connections.length,
    status: pass.status,
    selected: index === 0,
  }));
  return { passes, summaries };
}

export function earlierRouteTarget(arrivalTime: string, minutes = 15): string {
  const value = new Date(arrivalTime);
  if (!Number.isFinite(value.getTime())) throw new Error('The agreed arrival time is invalid.');
  return new Date(value.getTime() - Math.max(1, minutes) * MINUTE_MS).toISOString();
}
