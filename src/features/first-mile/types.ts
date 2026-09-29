import type {
  RailLine,
  RailStop,
} from '@/shared/data/adapters/gtfsAdapter';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface WalkingRoute {
  distanceMeters: number;
  durationSeconds: number;

  /**
   * Real pedestrian route returned by OTP.
   * This is NOT a straight line.
   */
  geometry: GeoPoint[];
}

export interface FirstMileStopResult {
  stop: RailStop;
  lines: RailLine[];
  route: WalkingRoute;
}

/** A bus route calling at a first-mile bus stop, and the rail stations it passes. */
export interface FirstMileBusRoute {
  routeId: string;
  /** The number a rider looks for: "T801", "300". */
  name: string;
  /** Where it runs, as the feed describes it. */
  description: string;
  /** Rail stations the route passes, by name. Empty when it links to none. */
  railStations: string[];
}

export interface FirstMileBusStopResult {
  stop: {
    stopId: string;
    name: string;
    lat: number;
    lon: number;
  };
  routes: FirstMileBusRoute[];
  route: WalkingRoute;
}

export type FirstMileState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      stops: FirstMileStopResult[];
      /**
       * Bus stops within the walking window, one per route. Kept apart from `stops`,
       * which is rail stations only and is read as such by station reachability, the
       * live-vehicle filter and the Epic 4 bus-stop layer.
       */
      busStops: FirstMileBusStopResult[];
      unroutableCandidateCount: number;
    }
  | {
      status: 'failed';
      message: string;
    };