import { arrivalAvailability } from '@/features/essential-services/arrivalAvailability';
import type { ModelledJourney } from '@/features/interchange/types';
import { evaluateClosingMargin } from '@/features/outing-pass/passCheckService';
import type {
  InfeasibleReason,
  OutingStop,
  PlannedLeg,
  PlannedOrder,
  PlannedVisit,
  TripPlanRequest,
  TripPoint,
} from './types';

const MINUTE_MS = 60_000;

export function stopPoint(stop: OutingStop): TripPoint {
  const { id, name, lat, lon } = stop.service;
  return { id, name, lat, lon };
}

export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]),
  );
}

/** A leg as the timeline needs it; `detail` is whatever the caller wants carried along. */
export interface ChainLeg<D> {
  from: TripPoint;
  to: TripPoint;
  readyMs: number;
  arriveMs: number;
  detail: D;
}

export interface Chain<D> {
  stops: OutingStop[];
  legs: ChainLeg<D>[];
  visits: PlannedVisit[];
  reasons: InfeasibleReason[];
  /** Null when a leg had no route. */
  finishMs: number | null;
}

/** Null means the engine returned no journey for that pair at that time. */
export type LegProvider<D> = (
  from: TripPoint,
  to: TripPoint,
  readyMs: number,
) => Promise<{ arriveMs: number; detail: D } | null>;

function visitFor(stop: OutingStop, readyMs: number, arriveMs: number): PlannedVisit {
  const arrivalTime = new Date(arriveMs).toISOString();
  const availability = arrivalAvailability(
    stop.service.hours,
    new Date(readyMs).toISOString(),
    (arriveMs - readyMs) / MINUTE_MS,
  );
  const closing = availability.status === 'Open'
    ? evaluateClosingMargin(stop.service.hours, arrivalTime)
    : null;
  const shortfall = closing?.status === 'checked'
    ? stop.visitMinutes - closing.marginSeconds / 60
    : 0;
  return {
    stopId: stop.service.id,
    arrivalTime,
    departureTime: new Date(arriveMs + stop.visitMinutes * MINUTE_MS).toISOString(),
    visitMinutes: stop.visitMinutes,
    availability,
    closesBeforeVisitEndsMinutes: shortfall > 0 ? Math.ceil(shortfall) : null,
  };
}

/**
 * Lays one visit order out in time.
 *
 * AC 2.2.2 — each leg is asked for at the previous arrival plus the visit, so a later leg
 * sees the service pattern of the hour it would really be travelled in.
 *
 * AC 2.2.3 — a place that is closed at its estimated arrival makes the order infeasible,
 * but the timeline continues so the user can still see when the outing would have ended.
 * A leg with no route ends it: nothing after that point can be timed.
 */
export async function evaluateChain<D>(
  request: Pick<TripPlanRequest, 'origin' | 'departureTime' | 'final' | 'limitMinutes'>,
  stops: OutingStop[],
  legFor: LegProvider<D>,
): Promise<Chain<D>> {
  const chain: Chain<D> = { stops, legs: [], visits: [], reasons: [], finishMs: null };
  let from = request.origin;
  let readyMs = Date.parse(request.departureTime);

  for (const stop of stops) {
    const to = stopPoint(stop);
    const leg = await legFor(from, to, readyMs);
    if (!leg) {
      chain.reasons.push({ kind: 'no-route', fromName: from.name, toName: to.name });
      return chain;
    }
    chain.legs.push({ from, to, readyMs, arriveMs: leg.arriveMs, detail: leg.detail });
    const visit = visitFor(stop, readyMs, leg.arriveMs);
    chain.visits.push(visit);
    if (visit.availability.status === 'Closed' || visit.availability.status === 'Closing before arrival') {
      chain.reasons.push({ kind: 'closed', stopId: to.id, stopName: to.name, arrivalTime: visit.arrivalTime });
    }
    from = to;
    readyMs = leg.arriveMs + stop.visitMinutes * MINUTE_MS;
  }

  if (request.final) {
    const leg = await legFor(from, request.final, readyMs);
    if (!leg) {
      chain.reasons.push({ kind: 'no-route', fromName: from.name, toName: request.final.name });
      return chain;
    }
    chain.legs.push({ from, to: request.final, readyMs, arriveMs: leg.arriveMs, detail: leg.detail });
    readyMs = leg.arriveMs;
  }

  chain.finishMs = readyMs;
  if (request.limitMinutes !== null) {
    const deadlineMs = Date.parse(request.departureTime) + request.limitMinutes * MINUTE_MS;
    if (readyMs > deadlineMs) {
      chain.reasons.push({
        kind: 'deadline',
        finishTime: new Date(readyMs).toISOString(),
        deadlineTime: new Date(deadlineMs).toISOString(),
      });
    }
  }
  return chain;
}

export function orderId(stops: OutingStop[]): string {
  return stops.map(stop => stop.service.id).join('>');
}

/**
 * Feasible orders first, earliest finish first. Orders with a closed stop follow, then
 * those with a missing route. Every order leaves at the same time, so the earliest finish
 * is the shortest total time. The id breaks ties, so the same inputs give the same order.
 */
export function compareChains<D>(a: Chain<D>, b: Chain<D>): number {
  const rank = (chain: Chain<D>) => chain.reasons.length === 0 ? 0 : chain.finishMs !== null ? 1 : 2;
  return rank(a) - rank(b) ||
    (a.finishMs ?? 0) - (b.finishMs ?? 0) ||
    orderId(a.stops).localeCompare(orderId(b.stops));
}

/**
 * The orders worth calculating exactly: the best `limit` by estimate, and always the one
 * the user arranged — it is their plan, so it is measured rather than guessed at.
 */
export function selectForExact<D>(estimates: Chain<D>[], userOrderId: string, limit: number): OutingStop[][] {
  const ranked = [...estimates].sort(compareChains);
  const chosen = ranked.slice(0, limit);
  const user = ranked.find(chain => orderId(chain.stops) === userOrderId);
  if (user && !chosen.includes(user)) chosen.push(user);
  return chosen.map(chain => chain.stops);
}

/** AC 2.4.2 — seconds beyond the whole-outing limit; 0 within it; null with no limit. */
export function overLimitSeconds(elapsedSeconds: number, limitMinutes: number | null): number | null {
  return limitMinutes === null ? null : Math.max(0, elapsedSeconds - limitMinutes * 60);
}

export function toPlannedOrder(
  chain: Chain<ModelledJourney>,
  request: TripPlanRequest,
): PlannedOrder {
  const id = orderId(chain.stops);
  const legs: PlannedLeg[] = chain.legs.map(leg => ({
    id: `leg:${leg.from.id}>${leg.to.id}`,
    from: leg.from,
    to: leg.to,
    readyTime: new Date(leg.readyMs).toISOString(),
    arrivalTime: new Date(leg.arriveMs).toISOString(),
    journey: leg.detail,
  }));
  const elapsedSeconds = chain.finishMs === null
    ? null
    : Math.round((chain.finishMs - Date.parse(request.departureTime)) / 1000);
  return {
    id,
    stopIds: chain.stops.map(stop => stop.service.id),
    isUserOrder: id === orderId(request.stops),
    legs,
    visits: chain.visits,
    feasible: chain.reasons.length === 0,
    reasons: chain.reasons,
    totals: chain.finishMs === null || elapsedSeconds === null ? null : {
      finishTime: new Date(chain.finishMs).toISOString(),
      elapsedSeconds,
      walkSeconds: legs.reduce((total, leg) => total + leg.journey.walkTimeSeconds, 0),
      transfers: legs.reduce((total, leg) => total + leg.journey.interchanges.length, 0),
    },
    overLimitSeconds: elapsedSeconds === null ? null : overLimitSeconds(elapsedSeconds, request.limitMinutes),
  };
}
