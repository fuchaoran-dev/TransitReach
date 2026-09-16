import { useCallback, useEffect, useMemo, useState } from 'react';
import { TIME_BUDGET_OPTIONS } from '@/features/reachability';
import { intersectAreas, type OverlapPolygon } from '../overlapService';
import type { Participant } from '../types';
import { useParticipantAreas, type AreaState, type SurfaceState } from './useParticipantAreas';

/** Where the group stands on "is there somewhere we can all reach?" at one budget. */
export type Outcome =
  /** Fewer than two people have a starting point, so there is nothing to compare. */
  | { status: 'too-few' }
  | { status: 'pending'; waitingOn: Participant[] }
  /** Someone's area failed, so no honest answer is possible until it is retried. */
  | { status: 'blocked'; failed: Participant[] }
  | { status: 'error' }
  | { status: 'found'; polygons: OverlapPolygon[] }
  | { status: 'none' };

/** Only offered when the budget on screen finds no common ground. */
export type Suggestion =
  | { status: 'checking' }
  | { status: 'found'; budgetMinutes: number }
  /** Nothing even at the longest budget offered. */
  | { status: 'none-within-max'; maxMinutes: number }
  | { status: 'unavailable' };

type AreaLookup = (participant: Participant, budgetMinutes: number) => AreaState | null;

const MAX_BUDGET = TIME_BUDGET_OPTIONS[TIME_BUDGET_OPTIONS.length - 1];

function outcomeAt(located: Participant[], budgetMinutes: number, areaFor: AreaLookup): Outcome {
  if (located.length < 2) return { status: 'too-few' };

  const areas = located.map(participant => areaFor(participant, budgetMinutes));
  const failed = located.filter((_, i) => areas[i]?.status === 'failed' || areas[i]?.status === 'timedout');
  if (failed.length > 0) return { status: 'blocked', failed };
  const waitingOn = located.filter((_, i) => areas[i]?.status === 'computing');
  if (waitingOn.length > 0) return { status: 'pending', waitingOn };

  const regions = areas.flatMap(area => (area?.status === 'ready' ? [area.regions] : []));
  try {
    const polygons = intersectAreas(regions);
    return polygons.length > 0 ? { status: 'found', polygons } : { status: 'none' };
  } catch (error) {
    console.error('Could not intersect reachable areas', error);
    return { status: 'error' };
  }
}

/**
 * The ground everyone with a starting point can reach within the room's budget, and — when
 * there is none — the shortest longer budget at which there would be.
 *
 * Longer budgets are checked one step at a time, and only while each still finds nothing, so a
 * group that already has common ground costs the routing engine nothing extra. The suggestion
 * is worked out before anyone asks for it: by the time "Use 45 min" is tapped, those areas are
 * already cached and the new budget draws at once.
 *
 * Travel-time surfaces, which rank places inside the common ground, are requested only once
 * there is common ground to rank — one per person at the budget on screen.
 *
 * People without a starting point are left out of the comparison rather than blocking it, and
 * the caller names them, so a result for three people is never read as a result for four.
 */
export function useCommonGround(participants: Participant[], budgetMinutes: number) {
  const located = useMemo(() => participants.filter(participant => participant.at), [participants]);

  const [probes, setProbes] = useState<number[]>([]);
  const budgets = useMemo(
    () => [budgetMinutes, ...probes.filter(probe => probe > budgetMinutes)],
    [budgetMinutes, probes],
  );
  const [surfaceBudget, setSurfaceBudget] = useState<number | null>(null);
  const areas = useParticipantAreas(participants, budgets, surfaceBudget);

  const { outcome, suggestion, wantedProbes } = useMemo(() => {
    const current = outcomeAt(located, budgetMinutes, areas.areaFor);
    if (current.status !== 'none') return { outcome: current, suggestion: null, wantedProbes: [] as number[] };

    const wanted: number[] = [];
    let next: Suggestion = { status: 'none-within-max', maxMinutes: MAX_BUDGET };
    for (const option of TIME_BUDGET_OPTIONS.filter(option => option > budgetMinutes)) {
      wanted.push(option);
      const probe = outcomeAt(located, option, areas.areaFor);
      if (probe.status === 'none') continue;
      next = probe.status === 'found' ? { status: 'found', budgetMinutes: option }
        : probe.status === 'pending' ? { status: 'checking' }
        : { status: 'unavailable' };
      break;
    }
    return { outcome: current, suggestion: next, wantedProbes: wanted };
  }, [located, budgetMinutes, areas.areaFor]);

  // A budget the look-ahead reaches is requested on the next render; this is what grows it.
  const wantedKey = wantedProbes.join(',');
  useEffect(() => {
    setProbes(current =>
      current.join(',') === wantedKey ? current : wantedKey ? wantedKey.split(',').map(Number) : [],
    );
  }, [wantedKey]);

  // Surfaces follow the common ground: requested once it exists, and no longer asked for — so
  // cancelled if still running — when it goes.
  const wantedSurfaceBudget = outcome.status === 'found' ? budgetMinutes : null;
  useEffect(() => {
    setSurfaceBudget(wantedSurfaceBudget);
  }, [wantedSurfaceBudget]);

  const areaFor = useCallback(
    (participant: Participant) => areas.areaFor(participant, budgetMinutes),
    [areas, budgetMinutes],
  );
  const surfaceFor = useCallback(
    (participant: Participant): SurfaceState | null => areas.surfaceFor(participant, budgetMinutes),
    [areas, budgetMinutes],
  );
  const retry = useCallback(
    (participant: Participant) => areas.retry(participant, budgetMinutes),
    [areas, budgetMinutes],
  );
  const retrySurface = useCallback(
    (participant: Participant) => areas.retrySurface(participant, budgetMinutes),
    [areas, budgetMinutes],
  );
  /** Retries whichever look-ahead areas failed. */
  const retrySuggestion = useCallback(() => {
    for (const option of wantedProbes) {
      for (const participant of located) {
        const area = areas.areaFor(participant, option);
        if (area?.status === 'failed' || area?.status === 'timedout') areas.retry(participant, option);
      }
    }
  }, [areas, located, wantedProbes]);

  return {
    areaFor,
    surfaceFor,
    retry,
    retrySurface,
    retrySuggestion,
    outcome,
    suggestion,
    counted: located,
    notCounted: participants.filter(participant => !participant.at),
  };
}
