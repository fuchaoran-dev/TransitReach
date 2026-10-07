import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConfirmedMeetingPlan, StartingPoint } from '@/features/meeting-point/types';
import { checkPersonalPlan, earlierRouteTarget } from '../passCheckService';
import { loadStoredPass, savePersonalPass } from '../passStorage';
import type { JourneyOptionSummary, PersonalPass, PersonalPassState } from '../types';

export interface UsePersonalPassInput {
  roomCode: string;
  memberId: string;
  plan: ConfirmedMeetingPlan | null;
  origin: StartingPoint | null;
}

export interface PersonalPassController {
  state: PersonalPassState;
  recheck: () => void;
  selectJourney: (journeyId: string) => void;
  chooseAnotherJourney: () => void;
  leaveEarlier: (minutes?: number) => void;
}

interface ReadyOptions {
  passes: PersonalPass[];
  summaries: JourneyOptionSummary[];
  selectedId: string;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'The personal journey could not be checked.';
}

export function usePersonalPass(input: UsePersonalPassInput): PersonalPassController {
  const { roomCode, memberId, plan, origin } = input;
  const planVersion = plan?.version;
  const arrivalTime = plan?.arrivalTime;
  const venueId = plan?.venue.id;
  const venueType = plan?.venue.type;
  const venueName = plan?.venue.name;
  const venueKindLabel = plan?.venue.kindLabel;
  const venueLat = plan?.venue.lat;
  const venueLon = plan?.venue.lon;
  const venueAddress = plan?.venue.address;
  const venueHours = plan?.venue.hours;
  const stablePlan = useMemo<ConfirmedMeetingPlan | null>(() => {
    if (
      planVersion === undefined || !arrivalTime || !venueId || !venueType || !venueName ||
      !venueKindLabel || venueLat === undefined || venueLon === undefined
    ) return null;
    return {
      version: planVersion,
      arrivalTime,
      venue: {
        id: venueId,
        type: venueType,
        name: venueName,
        kindLabel: venueKindLabel,
        lat: venueLat,
        lon: venueLon,
        address: venueAddress,
        hours: venueHours,
      },
    };
  }, [
    planVersion,
    arrivalTime,
    venueId,
    venueType,
    venueName,
    venueKindLabel,
    venueLat,
    venueLon,
    venueAddress,
    venueHours,
  ]);
  const originLat = origin?.at.lat;
  const originLon = origin?.at.lon;
  const stableOrigin = useMemo(
    () => originLat === undefined || originLon === undefined ? null : { lat: originLat, lon: originLon },
    [originLat, originLon],
  );
  const previous = useMemo(
    () => {
      if (!stablePlan) return null;
      try {
        return loadStoredPass(roomCode, memberId, stablePlan.version);
      } catch {
        return null;
      }
    },
    [roomCode, memberId, stablePlan],
  );
  const [state, setState] = useState<PersonalPassState>(() =>
    !stablePlan
      ? { status: 'idle', reason: 'unconfirmed' }
      : !stableOrigin
        ? { status: 'idle', reason: 'missing-origin' }
        : { status: 'checking', previous },
  );
  const [options, setOptions] = useState<ReadyOptions | null>(null);
  const [retry, setRetry] = useState(0);
  const [routeTargetTime, setRouteTargetTime] = useState<string | null>(null);
  const [preferredJourneyIndex, setPreferredJourneyIndex] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    setRouteTargetTime(null);
    setPreferredJourneyIndex(0);
  }, [planVersion, arrivalTime]);

  useEffect(() => {
    if (!stablePlan) {
      setOptions(null);
      setState({ status: 'idle', reason: 'unconfirmed' });
      return;
    }
    if (!stableOrigin) {
      setOptions(null);
      setState({ status: 'idle', reason: 'missing-origin' });
      return;
    }

    const controller = new AbortController();
    const currentId = ++requestId.current;
    let saved: PersonalPass | null;
    try {
      saved = loadStoredPass(roomCode, memberId, stablePlan.version);
    } catch (error) {
      setOptions(null);
      setState({ status: 'failed', message: messageFor(error), previous: null });
      return;
    }
    setState({ status: 'checking', previous: saved });
    void checkPersonalPlan({
      roomCode,
      memberId,
      plan: stablePlan,
      origin: stableOrigin,
      routeTargetTime: routeTargetTime ?? undefined,
    }, controller.signal).then(result => {
      if (controller.signal.aborted || currentId !== requestId.current) return;
      const selected = result.passes[Math.min(preferredJourneyIndex, result.passes.length - 1)];
      savePersonalPass(selected);
      const summaries = result.summaries.map(summary => ({
        ...summary,
        selected: summary.id === selected.selectedJourneyId,
      }));
      const ready = {
        passes: result.passes,
        summaries,
        selectedId: selected.selectedJourneyId,
      };
      setOptions(ready);
      setState({ status: 'ready', pass: selected, options: summaries });
    }).catch(error => {
      if (controller.signal.aborted || currentId !== requestId.current) return;
      setOptions(null);
      setState({ status: 'failed', message: messageFor(error), previous: saved });
    });
    return () => controller.abort();
  }, [
    roomCode,
    memberId,
    stablePlan,
    stableOrigin,
    routeTargetTime,
    preferredJourneyIndex,
    retry,
  ]);

  const selectJourney = useCallback((journeyId: string) => {
    if (!options) return;
    const index = options.passes.findIndex(candidate => candidate.selectedJourneyId === journeyId);
    if (index < 0) return;
    // Route and evidence are deliberately fetched again. Selecting a replacement journey
    // is a new check, rather than a claim based on the option preview's older evidence.
    setPreferredJourneyIndex(index);
    setRetry(value => value + 1);
  }, [options]);

  const chooseAnotherJourney = useCallback(() => {
    if (!options || options.passes.length < 2) return;
    const current = options.passes.findIndex(pass => pass.selectedJourneyId === options.selectedId);
    const next = options.passes[(current + 1) % options.passes.length];
    selectJourney(next.selectedJourneyId);
  }, [options, selectJourney]);

  return {
    state,
    recheck: useCallback(() => setRetry(value => value + 1), []),
    selectJourney,
    chooseAnotherJourney,
    leaveEarlier: useCallback((minutes = 15) => {
      if (!arrivalTime) return;
      setRouteTargetTime(earlierRouteTarget(arrivalTime, minutes));
    }, [arrivalTime]),
  };
}
