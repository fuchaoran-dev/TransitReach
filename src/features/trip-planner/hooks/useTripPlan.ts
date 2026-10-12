import { useCallback, useEffect, useRef, useState } from 'react';
import { planTrip } from '../tripPlanService';
import type { TripPlan, TripPlanProgress, TripPlanRequest } from '../types';

export type TripPlanState =
  | { status: 'idle' }
  | { status: 'planning'; progress: TripPlanProgress | null }
  | { status: 'failed'; message: string }
  /** `version` rises with each calculated plan, so the plan check (MD8-2) can tell them apart. */
  | { status: 'ready'; plan: TripPlan; version: number };

export interface TripPlanController {
  state: TripPlanState;
  /** True when the outing on screen is no longer the one the shown plan was calculated for. */
  outOfDate: boolean;
  /** Calculates a plan for the current request. The only thing that calls the engine. */
  plan: () => void;
}

/** Everything that changes the journeys; names and other display fields are left out. */
function requestKey(request: TripPlanRequest | null): string | null {
  return request && JSON.stringify([
    request.origin.lat,
    request.origin.lon,
    request.departureTime,
    request.stops.map(stop => [stop.service.id, stop.visitMinutes]),
    request.final && [request.final.lat, request.final.lon],
    request.limitMinutes,
  ]);
}

/**
 * AC 2.1.3, 2.4.1 — a plan is calculated only on request. Editing the outing afterwards
 * leaves the shown plan in place, marked out of date, until the user asks again; it is
 * never recalculated behind their back and never passed off as current.
 */
export function useTripPlan(request: TripPlanRequest | null): TripPlanController {
  const [state, setState] = useState<TripPlanState>({ status: 'idle' });
  const [plannedKey, setPlannedKey] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);

  useEffect(() => () => controller.current?.abort(), []);

  const plan = useCallback(() => {
    if (!request) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: 'planning', progress: null });
    planTrip(request, current.signal, progress => {
      if (!current.signal.aborted) setState({ status: 'planning', progress });
    }).then(result => {
      if (current.signal.aborted) return;
      setPlannedKey(requestKey(request));
      setState({ status: 'ready', plan: result, version: ++version.current });
    }).catch(error => {
      if (current.signal.aborted) return;
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : 'The outing could not be planned.',
      });
    });
  }, [request]);

  return {
    state,
    outOfDate: state.status === 'ready' && requestKey(request) !== plannedKey,
    plan,
  };
}
