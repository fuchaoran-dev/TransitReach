import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeReachability,
  DEPARTURE_TIME,
  RoutingTimeoutError,
  TRAVEL_MODE,
  type IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';
import type { LatLng } from '@/features/reachability/types';
import type { Participant } from '../types';

export type AreaState =
  | { status: 'computing' }
  | { status: 'ready'; regions: IsochroneRegion[]; walkingOnly: boolean }
  | { status: 'failed' }
  /** Exceeded the routing time limit; reported as that, not as a generic failure. */
  | { status: 'timedout'; limitMs: number };

type FinishedArea = Exclude<AreaState, { status: 'computing' }>;

interface Job {
  key: string;
  at: LatLng;
  budgetMinutes: number;
  /** How many automatic retries this job has already had. */
  attempt: number;
}

/**
 * Areas computed at once.
 *
 * Each area is two OTP requests (with transit, and walking only), and the shared engine is a
 * two-core instance that has been measured stalling under bursts — 17.5 s for one isochrone
 * against a normal 1.4 s. Six people arriving together would otherwise send it twelve at once.
 */
const MAX_CONCURRENT = 2;

/**
 * Delays before each automatic retry of an area that failed outright.
 *
 * The routing engine's host drops a share of new connections — 2 in 12 and 1 in 129 attempts in
 * two probes from one machine, each a connection that never opened while the next one did. One
 * dropped connection would otherwise block the whole group's answer until someone noticed and
 * tapped Retry on their own device. Only after these are used up is the person asked to retry.
 *
 * A timeout is not retried automatically: it has already waited the full limit, and repeating
 * it would add load to an engine that is struggling.
 */
const AUTO_RETRY_DELAYS_MS = [1500, 5000];

const areaKey = (at: LatLng, budgetMinutes: number) => `${at.lat},${at.lon},${budgetMinutes}`;

/**
 * Each participant's reachable area, at each of the budgets asked for.
 *
 * Every browser in the room computes every area itself; nothing large goes through the
 * database, and nobody waits on another person's device. Results are cached by point and
 * budget for the life of the page, so switching the budget back or a realtime reload never
 * recomputes what is already known. Work nobody needs any more — someone moved, left, or a
 * budget stopped being asked for — is cancelled instead of being left to occupy the engine.
 *
 * Queue order is budget first, then participant: the first budget is the one on screen, and
 * later ones are look-ahead. Within a budget, pass the viewer first — theirs is the area they
 * are waiting on.
 */
export function useParticipantAreas(participants: Participant[], budgets: number[]) {
  const [finished, setFinished] = useState<ReadonlyMap<string, FinishedArea>>(() => new Map());
  const finishedRef = useRef(new Map<string, FinishedArea>());
  const running = useRef(new Map<string, AbortController>());
  /** Jobs sitting out an automatic-retry delay, by key. */
  const waiting = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queue = useRef<Job[]>([]);

  const record = useCallback((key: string, area: FinishedArea | null) => {
    if (area) finishedRef.current.set(key, area);
    else finishedRef.current.delete(key);
    setFinished(new Map(finishedRef.current));
  }, []);

  const pump = useCallback(function pump() {
    while (running.current.size < MAX_CONCURRENT && queue.current.length > 0) {
      const job = queue.current.shift()!;
      const controller = new AbortController();
      running.current.set(job.key, controller);

      computeReachability(job.at, job.budgetMinutes, controller.signal, DEPARTURE_TIME, TRAVEL_MODE)
        .then(({ result, walkingOnly }) =>
          record(job.key, { status: 'ready', regions: result.regions, walkingOnly }),
        )
        .catch(error => {
          // A timeout also arrives as an abort of the inner request, so it is checked before
          // the cancelled case; a cancelled job records nothing.
          if (error instanceof RoutingTimeoutError) {
            record(job.key, { status: 'timedout', limitMs: error.limitMs });
            return;
          }
          if (controller.signal.aborted) return;

          const delay = AUTO_RETRY_DELAYS_MS[job.attempt];
          if (delay !== undefined) {
            waiting.current.set(
              job.key,
              setTimeout(() => {
                waiting.current.delete(job.key);
                queue.current.push({ ...job, attempt: job.attempt + 1 });
                pump();
              }, delay),
            );
            return;
          }
          console.error('Participant reachability failed', error);
          record(job.key, { status: 'failed' });
        })
        .finally(() => {
          if (running.current.get(job.key) === controller) running.current.delete(job.key);
          pump();
        });
    }
  }, [record]);

  // Compared as a string, so a caller building a fresh array each render does not re-run this.
  const budgetsKey = budgets.join(',');

  useEffect(() => {
    const needed = new Map<string, Job>();
    for (const budgetMinutes of budgetsKey.split(',').map(Number)) {
      for (const participant of participants) {
        if (!participant.at) continue;
        const key = areaKey(participant.at, budgetMinutes);
        if (!needed.has(key)) needed.set(key, { key, at: participant.at, budgetMinutes, attempt: 0 });
      }
    }

    queue.current = queue.current.filter(job => needed.has(job.key));
    for (const [key, controller] of running.current) {
      if (needed.has(key)) continue;
      controller.abort();
      running.current.delete(key);
    }
    for (const [key, timer] of waiting.current) {
      if (needed.has(key)) continue;
      clearTimeout(timer);
      waiting.current.delete(key);
    }
    for (const job of needed.values()) {
      const known =
        finishedRef.current.has(job.key) ||
        running.current.has(job.key) ||
        waiting.current.has(job.key) ||
        queue.current.some(queued => queued.key === job.key);
      if (!known) queue.current.push(job);
    }
    pump();
  }, [participants, budgetsKey, pump]);

  useEffect(() => {
    const jobs = running.current;
    const timers = waiting.current;
    return () => {
      for (const controller of jobs.values()) controller.abort();
      jobs.clear();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /** Null for a participant with no starting point yet. Still 'computing' while an automatic retry waits. */
  const areaFor = useCallback(
    (participant: Participant, budgetMinutes: number): AreaState | null => {
      if (!participant.at) return null;
      return finished.get(areaKey(participant.at, budgetMinutes)) ?? { status: 'computing' };
    },
    [finished],
  );

  /** Re-runs the same point and budget, with a fresh set of automatic retries; nobody re-enters anything. */
  const retry = useCallback(
    (participant: Participant, budgetMinutes: number) => {
      if (!participant.at) return;
      const key = areaKey(participant.at, budgetMinutes);
      record(key, null);
      const pending =
        running.current.has(key) || waiting.current.has(key) || queue.current.some(job => job.key === key);
      if (!pending) queue.current.push({ key, at: participant.at, budgetMinutes, attempt: 0 });
      pump();
    },
    [record, pump],
  );

  return { areaFor, retry };
}
