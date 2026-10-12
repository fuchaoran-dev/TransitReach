import type { ArrivalAvailability } from '@/features/essential-services/arrivalAvailability';
import type { ModelledJourney } from '@/features/interchange/types';
import type { ServiceLocation } from '@/shared/types/service';

/** AC 2.1.1 — an outing is at least two places; one place is an ordinary journey. */
export const MIN_STOPS = 2;

/**
 * Five stops is 120 visit orders. Beyond that the pair estimates alone cost more requests
 * than the hosted journey engine has handled reliably in one burst.
 */
export const MAX_STOPS = 5;

/** AC 2.1.4 — the duration a stop starts with until the user sets their own. */
export const DEFAULT_VISIT_MINUTES = 30;

/** How many of the best-estimated orders are calculated with time-dependent legs. */
export const EXACT_ORDER_LIMIT = 3;

/** A place a leg starts or ends at. `id` is stable for the life of the outing. */
export interface TripPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** A service that can be routed to: the source data occasionally lacks coordinates. */
export type LocatedService = ServiceLocation & { lat: number; lon: number };

export interface OutingStop {
  service: LocatedService;
  visitMinutes: number;
}

/** AC 2.1.2 — where the outing ends: at the last stop, back at the start, or elsewhere. */
export type FinalDestination =
  | { kind: 'none' }
  | { kind: 'origin' }
  | { kind: 'place'; point: TripPoint };

export interface TripPlanRequest {
  origin: TripPoint;
  /** An instant, e.g. `2026-10-10T09:00:00+08:00`. */
  departureTime: string;
  /** In the order the user arranged them. */
  stops: OutingStop[];
  /** AC 2.1.2 — where the outing ends, when that is not the last stop. */
  final: TripPoint | null;
  /** AC 2.4.2 — minutes from departure until the requested finish time, visits included. */
  limitMinutes: number | null;
}

export type InfeasibleReason =
  | { kind: 'no-route'; fromName: string; toName: string }
  | { kind: 'closed'; stopId: string; stopName: string; arrivalTime: string }
  | { kind: 'deadline'; finishTime: string; deadlineTime: string };

/**
 * One journey between two consecutive points of the outing.
 *
 * `id` is stable for a given pair of points, so the plan check (MD8-2) can refer to a leg
 * across recalculations. Every time is an estimate from the modelled journey, never a
 * scheduled departure.
 */
export interface PlannedLeg {
  id: string;
  from: TripPoint;
  to: TripPoint;
  /** When the traveller is ready to leave `from`: the previous arrival plus the visit. */
  readyTime: string;
  arrivalTime: string;
  journey: ModelledJourney;
}

export interface PlannedVisit {
  stopId: string;
  arrivalTime: string;
  departureTime: string;
  visitMinutes: number;
  /** AC 2.3.4 — `Unknown` when the place has no reliable hours; never assumed open. */
  availability: ArrivalAvailability;
  /** Set when the place is open on arrival but closes before the visit would end. */
  closesBeforeVisitEndsMinutes: number | null;
}

export interface TripTotals {
  finishTime: string;
  /** From the requested departure to the end of the last leg or visit. */
  elapsedSeconds: number;
  walkSeconds: number;
  transfers: number;
}

export interface PlannedOrder {
  id: string;
  stopIds: string[];
  /** True for the order the user arranged, which is always calculated. */
  isUserOrder: boolean;
  legs: PlannedLeg[];
  visits: PlannedVisit[];
  /** AC 2.2.3 — false when a leg has no route or a place is closed on arrival. */
  feasible: boolean;
  reasons: InfeasibleReason[];
  /** Null when a leg had no route, so the outing has no end to measure. */
  totals: TripTotals | null;
  /** AC 2.4.2 — seconds beyond the limit; 0 when within it; null when no limit applies. */
  overLimitSeconds: number | null;
}

export interface TripPlan {
  request: TripPlanRequest;
  /** Calculated orders: feasible ones first, shortest total time first. */
  orders: PlannedOrder[];
  /** Every possible order of the stops. */
  ordersConsidered: number;
  /** Orders whose legs were each calculated at their own departure time. */
  ordersCalculated: number;
  calculatedAt: string;
}

export interface TripPlanProgress {
  phase: 'estimating' | 'calculating';
  done: number;
  total: number;
}
