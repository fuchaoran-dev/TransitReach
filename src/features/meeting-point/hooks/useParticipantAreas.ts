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
}

/**
 * Areas computed at once.
 *
 * Each area is two OTP requests (with transit, and walking only), and the shared engine is a
 * two-core instance that has been measured stalling under bursts — 17.5 s for one isochrone
 * against a normal 1.4 s. Six people arriving together would otherwise send it twelve at once.
 */
const MAX_CONCURRENT = 2;

const areaKey = (at: LatLng, budgetMinutes: number) => `${at.lat},${at.lon},${budgetMinutes}`;

/**
 * Each participant's reachable area at the room's budget.
 *
 * Every browser in the room computes every area itself; nothing large goes through the
 * database, and nobody waits on another person's device. Results are cached by point and
 * budget for the life of the page, so switching the budget back or a realtime reload never
 * recomputes what is already known. Work nobody needs any more — someone moved, left, or the
 * budget changed — is cancelled instead of being left to occupy the engine.
 *
 * `participants` is also the queue order: pass the viewer first, since that is the area they
 * are waiting on.
 */
export function useParticipantAreas(participants: Participant[], budgetMinutes: number) {
  const [finished, setFinished] = useState<ReadonlyMap<string, FinishedArea>>(() => new Map());
  const finishedRef = useRef(new Map<string, FinishedArea>());
  const running = useRef(new Map<string, AbortController>());
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
          } else if (!controller.signal.aborted) {
            console.error('Participant reachability failed', error);
            record(job.key, { status: 'failed' });
          }
        })
        .finally(() => {
          if (running.current.get(job.key) === controller) running.current.delete(job.key);
          pump();
        });
    }
  }, [record]);

  useEffect(() => {
    const needed = new Map<string, Job>();
    for (const participant of participants) {
      if (!participant.at) continue;
      const key = areaKey(participant.at, budgetMinutes);
      if (!needed.has(key)) needed.set(key, { key, at: participant.at, budgetMinutes });
    }

    queue.current = queue.current.filter(job => needed.has(job.key));
    for (const [key, controller] of running.current) {
      if (needed.has(key)) continue;
      controller.abort();
      running.current.delete(key);
    }
    for (const job of needed.values()) {
      const known =
        finishedRef.current.has(job.key) ||
        running.current.has(job.key) ||
        queue.current.some(queued => queued.key === job.key);
      if (!known) queue.current.push(job);
    }
    pump();
  }, [participants, budgetMinutes, pump]);

  useEffect(() => {
    const jobs = running.current;
    return () => {
      for (const controller of jobs.values()) controller.abort();
      jobs.clear();
    };
  }, []);

  /** Null for a participant with no starting point yet. */
  const areaFor = useCallback(
    (participant: Participant): AreaState | null => {
      if (!participant.at) return null;
      return finished.get(areaKey(participant.at, budgetMinutes)) ?? { status: 'computing' };
    },
    [finished, budgetMinutes],
  );

  /** Re-runs the same point and budget; nobody re-enters anything. */
  const retry = useCallback(
    (participant: Participant) => {
      if (!participant.at) return;
      const key = areaKey(participant.at, budgetMinutes);
      record(key, null);
      if (!running.current.has(key) && !queue.current.some(job => job.key === key)) {
        queue.current.push({ key, at: participant.at, budgetMinutes });
      }
      pump();
    },
    [budgetMinutes, record, pump],
  );

  return { areaFor, retry };
}
