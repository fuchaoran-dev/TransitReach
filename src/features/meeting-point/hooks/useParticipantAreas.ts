import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeReachability,
  DEPARTURE_TIME,
  fetchTravelTimeSurface,
  RoutingTimeoutError,
  TRAVEL_MODE,
  type IsochroneRegion,
} from '@/shared/data/adapters/routingAdapter';
import type { LatLng } from '@/features/reachability/types';
import { decodeTravelTimeSurface, type TravelTimeSurface } from '../travelTimeSurface';
import type { Participant } from '../types';

export type AreaState =
  | { status: 'computing' }
  | { status: 'ready'; regions: IsochroneRegion[]; walkingOnly: boolean }
  | { status: 'failed' }
  /** Exceeded the routing time limit; reported as that, not as a generic failure. */
  | { status: 'timedout'; limitMs: number };

export type SurfaceState =
  | { status: 'computing' }
  | { status: 'ready'; surface: TravelTimeSurface }
  | { status: 'failed' }
  | { status: 'timedout'; limitMs: number };

type JobKind = 'area' | 'surface';
type FinishedArea = Exclude<AreaState, { status: 'computing' }>;
type FinishedSurface = Exclude<SurfaceState, { status: 'computing' }>;
type Finished = FinishedArea | FinishedSurface;

interface Job {
  key: string;
  kind: JobKind;
  at: LatLng;
  budgetMinutes: number;
  /** How many automatic retries this job has already had. */
  attempt: number;
}

/**
 * Jobs run at once.
 *
 * An area job is two OTP requests (with transit, and walking only); a surface job is one. The
 * shared engine is a two-core instance that has been measured stalling under bursts — 17.5 s for
 * one isochrone against a normal 1.4 s — so both kinds share this one limit rather than each
 * having its own.
 */
const MAX_CONCURRENT = 2;

/**
 * Delays before each automatic retry of a job that failed outright.
 *
 * The routing engine's host drops a share of new connections — 2 in 12 and 1 in 129 attempts in
 * two probes from one machine, each a connection that never opened while the next one did. One
 * dropped connection would otherwise block the whole group's answer until someone noticed and
 * tapped Retry on their own device. Only after these are used up is the person asked to retry.
 */
const AUTO_RETRY_DELAYS_MS = [1500, 5000];

/**
 * Delay before the single automatic retry of a job that timed out.
 *
 * A timeout was at first left to the person, on the reasoning that it meant an overloaded
 * engine that a retry would only load further. The evidence said otherwise: on 14 September
 * four requests hung on a connection that never opened (the dev proxy logged `connect
 * ETIMEDOUT`) and surfaced as 15 s timeouts, while the engine answered other requests in about
 * two seconds. A dropped connection that hangs, rather than failing fast, reaches the app as a
 * timeout. One retry recovers that case; a second would start to look like load.
 */
const TIMEOUT_RETRY_DELAY_MS = 1000;

const jobKey = (kind: JobKind, at: LatLng, budgetMinutes: number) =>
  `${kind}:${at.lat},${at.lon},${budgetMinutes}`;

function runJob(job: Job, signal: AbortSignal): Promise<Finished> {
  if (job.kind === 'area') {
    return computeReachability(job.at, job.budgetMinutes, signal, DEPARTURE_TIME, TRAVEL_MODE).then(
      ({ result, walkingOnly }): FinishedArea => ({ status: 'ready', regions: result.regions, walkingOnly }),
    );
  }
  return fetchTravelTimeSurface(job.at, job.budgetMinutes, signal).then(
    (buffer): FinishedSurface => ({ status: 'ready', surface: decodeTravelTimeSurface(buffer) }),
  );
}

/**
 * Each participant's reachable area at each of the budgets asked for, and — when a surface
 * budget is given — each participant's travel-time surface at it.
 *
 * Every browser in the room computes these itself; nothing large goes through the database, and
 * nobody waits on another person's device. Results are cached by kind, point and budget for the
 * life of the page, so switching the budget back or a realtime reload never recomputes what is
 * already known. Work nobody needs any more — someone moved, left, or a budget stopped being
 * asked for — is cancelled instead of being left to occupy the engine.
 *
 * Queue order is areas before surfaces, budget first, then participant: the first budget is the
 * one on screen, later ones are look-ahead, and surfaces only matter once areas have produced
 * common ground. Within a budget, pass the viewer first — theirs is the result they wait on.
 */
export function useParticipantAreas(participants: Participant[], budgets: number[], surfaceBudget: number | null) {
  const [finished, setFinished] = useState<ReadonlyMap<string, Finished>>(() => new Map());
  const finishedRef = useRef(new Map<string, Finished>());
  const running = useRef(new Map<string, AbortController>());
  /** Jobs sitting out an automatic-retry delay, by key. */
  const waiting = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queue = useRef<Job[]>([]);

  const record = useCallback((key: string, result: Finished | null) => {
    if (result) finishedRef.current.set(key, result);
    else finishedRef.current.delete(key);
    setFinished(new Map(finishedRef.current));
  }, []);

  const pump = useCallback(function pump() {
    while (running.current.size < MAX_CONCURRENT && queue.current.length > 0) {
      const job = queue.current.shift()!;
      const controller = new AbortController();
      running.current.set(job.key, controller);

      runJob(job, controller.signal)
        .then(result => record(job.key, result))
        .catch(error => {
          // A timeout also arrives as an abort of the inner request, so it is checked before
          // the cancelled case; a cancelled job records nothing.
          const timedOut = error instanceof RoutingTimeoutError;
          if (!timedOut && controller.signal.aborted) return;

          const delay = timedOut
            ? job.attempt === 0 ? TIMEOUT_RETRY_DELAY_MS : undefined
            : AUTO_RETRY_DELAYS_MS[job.attempt];
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
          if (timedOut) {
            record(job.key, { status: 'timedout', limitMs: (error as RoutingTimeoutError).limitMs });
            return;
          }
          console.error(
            job.kind === 'area' ? 'Participant reachability failed' : 'Participant travel-time surface failed',
            error,
          );
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
    const need = (kind: JobKind, budgetMinutes: number) => {
      for (const participant of participants) {
        if (!participant.at) continue;
        const key = jobKey(kind, participant.at, budgetMinutes);
        if (!needed.has(key)) needed.set(key, { key, kind, at: participant.at, budgetMinutes, attempt: 0 });
      }
    };
    for (const budgetMinutes of budgetsKey.split(',').map(Number)) need('area', budgetMinutes);
    if (surfaceBudget !== null) need('surface', surfaceBudget);

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
    // Keep waiting work in `needed` order: areas for the budget on screen, then look-ahead, then
    // surfaces. Without this, look-ahead queued for a budget the room has just left stayed ahead of
    // the areas it now asked for — on a slow engine that held a budget change up past 90 seconds.
    const order = new Map([...needed.keys()].map((key, index) => [key, index]));
    queue.current.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
    pump();
  }, [participants, budgetsKey, surfaceBudget, pump]);

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
      return (finished.get(jobKey('area', participant.at, budgetMinutes)) as FinishedArea | undefined) ?? {
        status: 'computing',
      };
    },
    [finished],
  );

  /** As `areaFor`, for travel-time surfaces. */
  const surfaceFor = useCallback(
    (participant: Participant, budgetMinutes: number): SurfaceState | null => {
      if (!participant.at) return null;
      return (finished.get(jobKey('surface', participant.at, budgetMinutes)) as FinishedSurface | undefined) ?? {
        status: 'computing',
      };
    },
    [finished],
  );

  /** Re-runs the same job with a fresh set of automatic retries; nobody re-enters anything. */
  const retryJob = useCallback(
    (kind: JobKind, participant: Participant, budgetMinutes: number) => {
      if (!participant.at) return;
      const key = jobKey(kind, participant.at, budgetMinutes);
      record(key, null);
      const pending =
        running.current.has(key) || waiting.current.has(key) || queue.current.some(job => job.key === key);
      if (!pending) queue.current.push({ key, kind, at: participant.at, budgetMinutes, attempt: 0 });
      pump();
    },
    [record, pump],
  );
  const retry = useCallback(
    (participant: Participant, budgetMinutes: number) => retryJob('area', participant, budgetMinutes),
    [retryJob],
  );
  const retrySurface = useCallback(
    (participant: Participant, budgetMinutes: number) => retryJob('surface', participant, budgetMinutes),
    [retryJob],
  );

  return { areaFor, surfaceFor, retry, retrySurface };
}
