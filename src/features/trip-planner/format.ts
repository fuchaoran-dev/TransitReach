import { legTitle } from '@/features/interchange/interchangeService';
import type { ModelledJourney } from '@/features/interchange/types';
import { passTime } from '@/features/outing-pass/components/passPresentation';
import type { InfeasibleReason, TripPlan } from './types';

/**
 * Every clock time in the planner goes through here. Rail times are generated from
 * published frequencies and bus times from a timetable, so none of them is a departure
 * anyone has promised: "around" is part of the figure, not decoration.
 */
export function aroundTime(value: string | number): string {
  return `around ${passTime(value)}`;
}

export function durationLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** "Walk → LRT Kelana Jaya Line → Walk", without the walking inside an interchange. */
export function journeyModes(journey: ModelledJourney): string {
  const labels: string[] = [];
  for (const leg of journey.legs) {
    if (leg.partOfInterchange) continue;
    const label = legTitle(leg);
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels.join(' → ');
}

/**
 * AC 2.4.3 — why no order works, said once per cause instead of once per order: a place
 * that is closed whenever it would be reached, or a pair of places with no journey.
 */
export function noPlanReasons(plan: TripPlan): string[] {
  const hours = new Map(plan.request.stops.map(stop => [stop.service.id, stop.service.hours]));
  const closed = new Map<string, { name: string; arrivals: number[] }>();
  const unrouted = new Set<string>();
  let earliestLateFinish: number | null = null;
  for (const order of plan.orders) {
    for (const reason of order.reasons) {
      if (reason.kind === 'no-route') {
        unrouted.add(`No journey was found from ${reason.fromName} to ${reason.toName} at the time it would be travelled.`);
      } else if (reason.kind === 'deadline') {
        const finish = Date.parse(reason.finishTime);
        earliestLateFinish = Math.min(earliestLateFinish ?? finish, finish);
      } else {
        const entry = closed.get(reason.stopId) ?? { name: reason.stopName, arrivals: [] };
        entry.arrivals.push(Date.parse(reason.arrivalTime));
        closed.set(reason.stopId, entry);
      }
    }
  }
  return [
    ...[...closed].map(([id, { name, arrivals }]) => {
      const earliest = Math.min(...arrivals);
      const latest = Math.max(...arrivals);
      const when = latest - earliest < 60_000
        ? aroundTime(earliest)
        : `between ${passTime(earliest)} and ${passTime(latest)}`;
      return `${name} is closed at its estimated arrival, ${when}. Its listed hours are ${hours.get(id)}.`;
    }),
    ...unrouted,
    ...(earliestLateFinish !== null && plan.request.limitMinutes !== null
      ? [`The earliest calculated finish is ${aroundTime(earliestLateFinish)}, after your finish-by time. Leave earlier, shorten a visit or change the stops.`]
      : []),
  ];
}

export function reasonLabel(reason: InfeasibleReason): string {
  if (reason.kind === 'no-route') return `No journey was found from ${reason.fromName} to ${reason.toName}.`;
  if (reason.kind === 'deadline') return `Finishes ${aroundTime(reason.finishTime)}, after your ${aroundTime(reason.deadlineTime)} limit.`;
  return `${reason.stopName} is closed at the estimated arrival, ${aroundTime(reason.arrivalTime)}.`;
}
