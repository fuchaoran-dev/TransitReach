import { WALK_SPEED_MS } from '@/shared/data/adapters/routingAdapter';
import type {
  InterchangeEstimate,
  InterchangeLayout,
  JourneyLeg,
  ModelledJourney,
} from './types';
import type { TransitPlanItinerary, WalkStep } from '@/shared/services/transitRoutingClient';

const EARTH_RADIUS_METRES = 6_371_000;

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function distanceMetres(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function roundUpTo30Seconds(seconds: number): number {
  return Math.ceil(seconds / 30) * 30;
}

function modeFamily(leg: JourneyLeg): 'rail' | 'brt' | 'bus' | 'other' {
  // Mode first: bus route names are full of station names ("Stesen LRT Universiti ~ …"),
  // so a text match would read a bus as LRT, MRT or BRT.
  if (leg.mode === 'BUS') return 'bus';
  const text = `${leg.mode} ${leg.routeShortName ?? ''} ${leg.routeLongName ?? ''}`.toUpperCase();
  if (text.includes('BRT')) return 'brt';
  if (['SUBWAY', 'TRAM', 'RAIL', 'TRAIN', 'MONORAIL'].includes(leg.mode)) return 'rail';
  return 'other';
}

export function displayModeLabel(leg: JourneyLeg): string {
  // As in modeFamily: a bus is a bus whatever stations its route name mentions.
  if (leg.mode === 'BUS') return 'Bus';
  const text = `${leg.routeShortName ?? ''} ${leg.routeLongName ?? ''}`.toUpperCase();
  if (text.includes('BRT')) return 'BRT';
  if (text.includes('MRT')) return 'MRT';
  if (text.includes('LRT')) return 'LRT';
  if (text.includes('MONORAIL')) return 'Monorail';
  if (leg.mode === 'SUBWAY') return 'Rail';
  if (leg.mode === 'TRAM') return 'Rail';
  if (leg.mode === 'BUS') return 'Bus';
  return leg.mode.charAt(0) + leg.mode.slice(1).toLowerCase();
}

/**
 * What a leg is called wherever it is listed. A bus is known by its number ("Bus 822",
 * "Bus T801") — the long name is a route description ("Terminal Maluri ~ Lebuh Ampang"),
 * not what anyone looks for at the stop. A rail line is known by its long name.
 */
export function legTitle(leg: JourneyLeg): string {
  if (leg.mode === 'WALK') return 'Walk';
  if (leg.mode === 'BUS') return `Bus ${leg.routeShortName ?? leg.routeLongName ?? ''}`.trim();
  return leg.routeLongName ?? leg.routeShortName ?? displayModeLabel(leg);
}

/** Where a bus route runs, when the feed says more than its number. */
export function busRouteDescription(leg: JourneyLeg): string | null {
  if (leg.mode !== 'BUS' || !leg.routeLongName || leg.routeLongName === leg.routeShortName) return null;
  return leg.routeLongName;
}

/**
 * The way a walking step follows, as a rider would say it, or null when it has no name
 * worth reading out. OSM-named ways keep their name. Unnamed ways keep OTP's tag-derived
 * description ("footbridge", "steps") — those are exactly what a rider needs to hear —
 * but not a raw identifier like "way 803164605 from 1".
 */
export function describeStreet(step: WalkStep): string | null {
  const name = step.streetName.trim();
  if (!name) return null;
  if (!step.bogusName) return name;
  if (/^way \d+/i.test(name)) return null;
  return `the ${name.toLowerCase()}`;
}

const TURN_PHRASES: Record<string, string> = {
  DEPART: 'Start',
  LEFT: 'Turn left',
  RIGHT: 'Turn right',
  SLIGHTLY_LEFT: 'Bear left',
  SLIGHTLY_RIGHT: 'Bear right',
  HARD_LEFT: 'Turn sharp left',
  HARD_RIGHT: 'Turn sharp right',
  UTURN_LEFT: 'Turn back',
  UTURN_RIGHT: 'Turn back',
  CONTINUE: 'Continue',
  CIRCLE_CLOCKWISE: 'Go round the roundabout',
  CIRCLE_COUNTERCLOCKWISE: 'Go round the roundabout',
};

/** One walking step as a sentence: "Turn left onto the footbridge". */
export function describeStep(step: WalkStep): string {
  switch (step.relativeDirection) {
    case 'ELEVATOR': return 'Take the lift';
    case 'ENTER_STATION': return 'Enter the station';
    case 'EXIT_STATION': return 'Leave the station';
    case 'FOLLOW_SIGNS': return 'Follow the signs';
  }
  const turn = TURN_PHRASES[step.relativeDirection] ?? 'Continue';
  const street = describeStreet(step);
  if (!street) return turn;
  return `${turn} ${step.relativeDirection === 'DEPART' ? 'along' : 'onto'} ${street}`;
}

function pairingAllowanceSeconds(from: JourneyLeg, to: JourneyLeg): number {
  const pair = `${modeFamily(from)}-${modeFamily(to)}`;
  switch (pair) {
    case 'rail-rail': return 45;
    case 'rail-brt':
    case 'brt-rail': return 75;
    case 'brt-brt': return 45;
    case 'rail-bus':
    case 'bus-rail': return 120;
    case 'brt-bus':
    case 'bus-brt': return 90;
    case 'bus-bus': return 60;
    default: return 90;
  }
}

function layoutFor(
  from: JourneyLeg,
  to: JourneyLeg,
  transferDistanceMetres: number,
): InterchangeLayout {
  if (
    from.to.stopId &&
    to.from.stopId &&
    from.to.stopId === to.from.stopId
  ) {
    return 'same-stop';
  }
  if (transferDistanceMetres <= 120) return 'within-station';
  if (transferDistanceMetres <= 400) return 'connected-stops';
  return 'external-transfer';
}

function layoutAllowanceSeconds(layout: InterchangeLayout): number {
  switch (layout) {
    case 'same-stop': return 30;
    case 'within-station': return 60;
    case 'connected-stops': return 90;
    case 'external-transfer': return 120;
  }
}

function layoutLabel(layout: InterchangeLayout): string {
  switch (layout) {
    case 'same-stop': return 'same boarding location';
    case 'within-station': return 'within the same interchange area';
    case 'connected-stops': return 'between nearby connected stops';
    case 'external-transfer': return 'between separate transfer points';
  }
}

function itineraryLegs(itinerary: TransitPlanItinerary): JourneyLeg[] {
  return itinerary.legs.map((leg, index) => ({
    id: `leg-${index}`,
    ...leg,
    partOfInterchange: false,
  }));
}

/**
 * Deterministic Epic 4 interchange model.
 *
 * The estimate is derived from transfer walking distance, station-layout class and mode
 * pairing. The same inputs therefore always return the same value (AC 4.2.1).
 *
 * When OTP provides a connection window, the estimate is tested against that window.
 * Journeys whose transfer cannot fit are marked infeasible rather than presented as a
 * connection the rider can realistically make.
 */
export function modelJourney(
  itinerary: TransitPlanItinerary,
  journeyIndex: number,
  budgetMinutes: number,
): ModelledJourney {
  const legs = itineraryLegs(itinerary);
  const transitIndexes = legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => leg.transitLeg && leg.mode !== 'WALK')
    .map(({ index }) => index);

  const interchanges: InterchangeEstimate[] = [];

  for (let i = 0; i < transitIndexes.length - 1; i++) {
    const fromLegIndex = transitIndexes[i];
    const toLegIndex = transitIndexes[i + 1];
    const fromLeg = legs[fromLegIndex];
    const toLeg = legs[toLegIndex];
    const between = legs.slice(fromLegIndex + 1, toLegIndex);
    const walkingBetween = between.filter(leg => leg.mode === 'WALK');

    const routedDistance = walkingBetween.reduce(
      (total, leg) => total + leg.distanceMeters,
      0,
    );
    const geometricDistance = distanceMetres(fromLeg.to, toLeg.from);
    const transferDistance = routedDistance > 0 ? routedDistance : geometricDistance;

    const routedWalkSeconds = walkingBetween.reduce(
      (total, leg) => total + leg.durationSeconds,
      0,
    );
    const distanceWalkSeconds = transferDistance / WALK_SPEED_MS;
    const walkingSeconds = Math.max(routedWalkSeconds, distanceWalkSeconds);

    const layout = layoutFor(fromLeg, toLeg, transferDistance);
    const pairSeconds = pairingAllowanceSeconds(fromLeg, toLeg);
    const layoutSeconds = layoutAllowanceSeconds(layout);
    const estimateSeconds = roundUpTo30Seconds(
      walkingSeconds + pairSeconds + layoutSeconds,
    );

    const availableWindowSeconds =
      fromLeg.endTimeMs !== null && toLeg.startTimeMs !== null
        ? Math.max(0, (toLeg.startTimeMs - fromLeg.endTimeMs) / 1000)
        : null;

    const feasible =
      availableWindowSeconds === null || availableWindowSeconds >= estimateSeconds;

    const residualWaitingSeconds =
      availableWindowSeconds === null
        ? null
        : Math.max(0, availableWindowSeconds - estimateSeconds);

    for (let betweenIndex = fromLegIndex + 1; betweenIndex < toLegIndex; betweenIndex++) {
      if (legs[betweenIndex].mode === 'WALK') {
        legs[betweenIndex].partOfInterchange = true;
      }
    }

    interchanges.push({
      id: `transfer-${fromLegIndex}-${toLegIndex}`,
      fromLegIndex,
      toLegIndex,
      atName: fromLeg.to.name || toLeg.from.name || 'Interchange',
      fromModeLabel: displayModeLabel(fromLeg),
      toModeLabel: displayModeLabel(toLeg),
      distanceMeters: transferDistance,
      estimatedDurationSeconds: estimateSeconds,
      availableWindowSeconds,
      residualWaitingSeconds,
      layout,
      feasible,
      factors: [
        `${Math.round(transferDistance)} m transfer distance`,
        `${displayModeLabel(fromLeg)} → ${displayModeLabel(toLeg)} mode pairing`,
        layoutLabel(layout),
      ],
    });
  }

  return {
    id: `journey-${journeyIndex}`,
    totalDurationSeconds: itinerary.durationSeconds,
    startTimeMs: itinerary.startTimeMs,
    endTimeMs: itinerary.endTimeMs,
    walkTimeSeconds: itinerary.walkTimeSeconds,
    waitingTimeSeconds: itinerary.waitingTimeSeconds,
    transitTimeSeconds: itinerary.transitTimeSeconds,
    legs,
    interchanges,
    feasible: interchanges.every(interchange => interchange.feasible),
    withinBudget: itinerary.durationSeconds <= budgetMinutes * 60,
  };
}
