import { routeArriveByJourneys } from '@/shared/services/transitRoutingClient';
import type { TransitPlanItinerary } from '@/shared/services/transitRoutingClient';
import type { ConfirmedMeetingPlan } from '@/features/meeting-point/types';
import { PASS_SCHEMA_VERSION } from './types';
import type { CheckedPassLeg, JourneyOptionSummary, PersonalPass } from './types';

interface Input {
  roomCode: string;
  memberId: string;
  plan: ConfirmedMeetingPlan;
  origin: { lat: number; lon: number };
  budgetMinutes?: number;
  routeTargetTime?: string;
}

/** Real arrive-by itineraries only. No ML/weather calls or group status publication. */
export async function generateTravelPass(input: Input, signal?: AbortSignal): Promise<{ passes: PersonalPass[]; summaries: JourneyOptionSummary[] }> {
  if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(input.roomCode) || !input.memberId.trim() ||
    !Number.isInteger(input.plan.version) || input.plan.version < 1) throw new Error('The meeting identity is invalid.');
  const target = input.routeTargetTime ?? input.plan.arrivalTime;
  const deadline = Date.parse(target);
  if (!Number.isFinite(deadline) || deadline > Date.parse(input.plan.arrivalTime)) throw new Error('The meeting time is invalid.');
  if (deadline <= Date.now()) throw new Error('This meeting time has passed. Ask the group to plan a new meeting.');
  const zeroTravel = input.origin.lat === input.plan.venue.lat && input.origin.lon === input.plan.venue.lon;
  const samePoint = { name: input.plan.venue.name, stopId: null, lat: input.origin.lat, lon: input.origin.lon };
  // A true zero journey is known from identical points, never an outage fallback or radius guess.
  const routes: TransitPlanItinerary[] = zeroTravel ? [{ startTimeMs: deadline, endTimeMs: deadline, durationSeconds: 0,
    walkTimeSeconds: 0, waitingTimeSeconds: 0, transitTimeSeconds: 0, transfers: 0,
    legs: [{ mode: 'WALK', routeId: null, routeShortName: null, routeLongName: null, routeColor: null,
      startTimeMs: deadline, endTimeMs: deadline, durationSeconds: 0, distanceMeters: 0,
      from: samePoint, to: samePoint, geometry: [], transitLeg: false, steps: [] }] }] :
    await routeArriveByJourneys(input.origin, input.plan.venue, target, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const eligible = routes.filter(route => {
    if (route.startTimeMs === null || route.endTimeMs === null || route.legs.length === 0) return false;
    const duration = (route.endTimeMs - route.startTimeMs) / 1000;
    return Number.isFinite(duration) && duration >= 0 && route.endTimeMs <= deadline &&
      (input.budgetMinutes === undefined || duration <= input.budgetMinutes * 60) &&
      route.legs.every(leg => leg.startTimeMs !== null && leg.endTimeMs !== null &&
        leg.startTimeMs >= route.startTimeMs! && leg.endTimeMs <= route.endTimeMs! && leg.endTimeMs >= leg.startTimeMs &&
        [leg.from, leg.to].every(point => Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
          point.lat !== 0 && point.lon !== 0 && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180)) &&
      route.legs.every((leg, index) => index === 0 || route.legs[index - 1].endTimeMs! <= leg.startTimeMs!);
  }).sort((a, b) => b.startTimeMs! - a.startTimeMs! || a.durationSeconds - b.durationSeconds);
  if (!eligible.length) throw new Error('No journey reaches this meeting within your travel-time budget. Ask the group to adjust the meeting or budget.');
  const passes = eligible.map((route, index): PersonalPass => {
    const legs: CheckedPassLeg[] = route.legs.map((leg, legIndex) => ({
      ...leg, id: `leg-${legIndex}`, estimatedStartTime: new Date(leg.startTimeMs!).toISOString(),
      estimatedEndTime: new Date(leg.endTimeMs!).toISOString(), cumulativeDelaySeconds: 0,
      delay: leg.transitLeg ? { status: 'not-checked', reason: 'not-requested', label: 'Not checked' } : null,
    }));
    return {
      schemaVersion: PASS_SCHEMA_VERSION, evidenceMode: 'route-only', zeroTravel, kind: 'group-outing',
      id: `${input.roomCode}-v${input.plan.version}`, roomCode: input.roomCode, memberId: input.memberId,
      planVersion: input.plan.version, checkedAt: new Date().toISOString(), routeTargetTime: target,
      meeting: input.plan, selectedJourneyId: `journey-${index}`,
      leaveTime: new Date(route.startTimeMs!).toISOString(), estimatedArrivalTime: new Date(route.endTimeMs!).toISOString(),
      arrivalMarginSeconds: Math.floor((Date.parse(input.plan.arrivalTime) - route.endTimeMs!) / 1000),
      // The legacy canonical structure retains explicit unknowns; the route-only UI never
      // presents this as a personal Check or confuses it with the room's origin Ready.
      status: 'Not checked', legs, connections: [],
      walking: { totalSeconds: legs.filter(leg => leg.mode === 'WALK').reduce((sum, leg) => sum + leg.durationSeconds, 0),
        totalDistanceMeters: legs.filter(leg => leg.mode === 'WALK').reduce((sum, leg) => sum + leg.distanceMeters, 0),
        directions: legs.flatMap(leg => leg.mode === 'WALK' ? leg.steps.map(step => ({ ...step, legId: leg.id })) : []) },
      weather: [{ status: 'not-checked', reason: 'not-requested', label: 'Weather unknown' }],
      closingMargin: { status: 'not-checked', reason: 'not-requested', label: 'Hours unknown' },
      weakPoint: { kind: 'unchecked-delay', label: 'OSM/GTFS route estimates; live delays, weather and opening hours are not checked.', marginSeconds: null },
    };
  });
  const summaries = passes.map((pass, index): JourneyOptionSummary => ({ id: pass.selectedJourneyId,
    leaveTime: pass.leaveTime, estimatedArrivalTime: pass.estimatedArrivalTime,
    durationSeconds: (Date.parse(pass.estimatedArrivalTime) - Date.parse(pass.leaveTime)) / 1000,
    walkingSeconds: pass.walking.totalSeconds, walkingDistanceMeters: pass.walking.totalDistanceMeters, transferCount: Math.max(0, pass.legs.filter(leg => leg.transitLeg).length - 1),
    status: 'Not checked', selected: index === 0 }));
  return { passes, summaries };
}
