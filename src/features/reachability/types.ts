import type { RailStop } from '@/shared/data/adapters/gtfsAdapter';
import type { OsmPlace } from '@/shared/data/adapters/osmAdapter';

/**
 * A real-world position. Distinct from the prototype's MapPoint {x, y}, which is a
 * pixel coordinate on the abstract SVG canvas the other pages still use.
 */
export interface LatLng {
  lat: number;
  lon: number;
}

/** How the user set the starting point. */
export type OriginSource = 'stop' | 'place' | 'map' | 'device';

/**
 * The starting point of a reachability query. Exactly one exists at a time
 * (AC 1.1.2) — selecting another moves it rather than adding a second.
 */
export interface Origin {
  at: LatLng;
  source: OriginSource;
  /** Present only when source === 'stop'. */
  stop?: RailStop;
  /** Present only when source === 'place'. */
  place?: OsmPlace;
}

/**
 * The choices a user makes once and carries through the app: where they are starting from,
 * and how long they are willing to travel.
 *
 * Held by App and passed to every screen that shows a result, so no screen can quietly
 * describe a different place from the one on screen next door.
 *
 * Travel mode was a third choice here and is not any more. Every journey is now computed
 * as walking plus transit, which is what a rider without a car is actually doing; offering
 * "walking only" and "transit only" as settings asked the user to pick a modelling
 * assumption rather than describe a trip.
 */
export interface Journey {
  origin: Origin | null;
  onOriginChange: (origin: Origin | null) => void;
  timeBudget: number;
  onTimeBudgetChange: (minutes: number) => void;
}

export type { RailStop, OsmPlace };
