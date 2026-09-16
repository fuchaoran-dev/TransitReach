import { WALK_SPEED_MS } from '@/shared/data/adapters/routingAdapter';
import type {
  InterchangeEstimate,
  InterchangeLayout,
  JourneyLeg,
  ModelledJourney,
} from './types';
import type { TransitPlanItinerary } from '@/shared/services/transitRoutingClient';

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
  const text = `${leg.mode} ${leg.routeShortName ?? ''} ${leg.routeLongName ?? ''}`.toUpperCase();
  if (text.includes('BRT')) return 'brt';
  if (leg.mode === 'BUS') return 'bus';
  if (['SUBWAY', 'TRAM', 'RAIL', 'TRAIN', 'MONORAIL'].includes(leg.mode)) return 'rail';
  return 'other';
}

export function displayModeLabel(leg: JourneyLeg): string {
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
