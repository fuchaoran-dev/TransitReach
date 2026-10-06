import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEPARTURE_TIME } from '@/shared/data/adapters/routingAdapter';
import type { ServiceLocation } from '@/shared/types/service';
import type { WalkStep } from '@/shared/services/transitRoutingClient';
import { inspectJourneys } from '../journeyInspectionService';
import type {
  JourneyInspectionModel,
  JourneyInspectionStatus,
  ModelledJourney,
} from '../types';

interface JourneyState {
  status: JourneyInspectionStatus;
  error: string | null;
  journeys: ModelledJourney[];
  rejectedJourneyCount: number;
}

const INITIAL_STATE: JourneyState = {
  status: 'idle',
  error: null,
  journeys: [],
  rejectedJourneyCount: 0,
};

export function useJourneyInspection(
  origin: { lat: number; lon: number } | null,
  destination: ServiceLocation | null,
  budgetMinutes: number,
  enabled: boolean,
  departureTime = DEPARTURE_TIME,
): JourneyInspectionModel {
  const [state, setState] = useState<JourneyState>(INITIAL_STATE);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [highlightedJourneyId, setHighlightedJourneyId] = useState<string | null>(null);
  const [highlightedLegId, setHighlightedLegId] = useState<string | null>(null);
  const [focusedStep, setFocusedStep] = useState<WalkStep | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    setSelectedJourneyId(null);
    setHighlightedJourneyId(null);
    setHighlightedLegId(null);
    setFocusedStep(null);
  }, [origin?.lat, origin?.lon, destination?.id, destination?.lat, destination?.lon, departureTime, budgetMinutes, enabled, retryToken]);

  // Highlights belong to the view they were made in: opening or leaving a journey's
  // detail starts clean rather than carrying over a hover from the other view.
  useEffect(() => {
    setHighlightedLegId(null);
    setHighlightedJourneyId(null);
    setFocusedStep(null);
  }, [selectedJourneyId]);

  useEffect(() => {
    if (
      !enabled ||
      !origin ||
      !destination ||
      destination.lat === undefined ||
      destination.lon === undefined
    ) {
      setState(INITIAL_STATE);
      return;
    }

    const controller = new AbortController();
    setState({
      status: 'loading',
      error: null,
      journeys: [],
      rejectedJourneyCount: 0,
    });

    inspectJourneys(
      origin,
      { lat: destination.lat, lon: destination.lon },
      budgetMinutes,
      departureTime,
      controller.signal,
    )
      .then(result => {
        if (controller.signal.aborted) return;
        setState({
          status: 'ready',
          error: null,
          journeys: result.journeys,
          rejectedJourneyCount: result.rejectedJourneyCount,
        });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unable to inspect journeys.',
          journeys: [],
          rejectedJourneyCount: 0,
        });
      });

    return () => controller.abort();
  }, [
    enabled,
    origin?.lat,
    origin?.lon,
    destination?.id,
    destination?.lat,
    destination?.lon,
    budgetMinutes,
    retryToken,
    departureTime,
  ]);

  const selectedJourney = useMemo(
    () => state.journeys.find(journey => journey.id === selectedJourneyId) ?? null,
    [state.journeys, selectedJourneyId],
  );

  const retry = useCallback(() => {
    setRetryToken(value => value + 1);
  }, []);

  return {
    ...state,
    destination,
    representativeJourneyId: state.journeys[0]?.id ?? null,
    selectedJourney,
    selectJourney: setSelectedJourneyId,
    clearSelection: () => setSelectedJourneyId(null),
    highlightedJourneyId,
    highlightJourney: setHighlightedJourneyId,
    highlightedLegId,
    highlightLeg: setHighlightedLegId,
    focusedStep,
    focusStep: setFocusedStep,
    retry,
  };
}
