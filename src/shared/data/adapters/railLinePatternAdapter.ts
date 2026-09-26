import { databaseData } from '../databaseData';

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

/**
 * Returns the directional stop patterns for one GTFS route.
 *
 * These are build-time data derived from the official Prasarana GTFS stop_times
 * and trips tables. No network request is made in the browser.
 */
export function railLinePatternForRoute(
  routeId: string,
): RailLinePattern | null {
  const patterns = databaseData().railPatterns as RailLinePattern[];
  return patterns.find(pattern => pattern.routeId === routeId) ?? null;
}
