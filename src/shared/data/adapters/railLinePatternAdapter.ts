import linePatternsDocument from '../rail/line-patterns.json';

export interface RailLinePatternStop {
  stationId: string;
  platformStopId: string;
  sequence: number;
  arrivalOffsetSeconds: number;
  departureOffsetSeconds: number;
}

export interface RailLineDirectionPattern {
  directionId: number;
  tripHeadsign: string;
  stops: RailLinePatternStop[];
}

export interface RailLinePattern {
  routeId: string;
  directions: RailLineDirectionPattern[];
}

interface RailLinePatternsDocument {
  routes: RailLinePattern[];
}

const DOCUMENT = linePatternsDocument as RailLinePatternsDocument;
const PATTERNS_BY_ROUTE = new Map(
  DOCUMENT.routes.map(pattern => [pattern.routeId, pattern]),
);

/**
 * Returns the directional stop patterns for one GTFS route.
 *
 * These are build-time data derived from the official Prasarana GTFS stop_times
 * and trips tables. No network request is made in the browser.
 */
export function railLinePatternForRoute(
  routeId: string,
): RailLinePattern | null {
  return PATTERNS_BY_ROUTE.get(routeId) ?? null;
}
