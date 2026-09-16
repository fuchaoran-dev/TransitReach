import { routeJourneys } from '@/shared/services/transitRoutingClient';
import { modelJourney } from './interchangeService';
import type { ModelledJourney } from './types';

export interface JourneyInspectionResult {
  journeys: ModelledJourney[];
  rejectedJourneyCount: number;
}

export async function inspectJourneys(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  budgetMinutes: number,
  departureTime: string,
  signal?: AbortSignal,
): Promise<JourneyInspectionResult> {
  const raw = await routeJourneys(origin, destination, departureTime, signal);
  const modelled = raw.map((itinerary, index) =>
    modelJourney(itinerary, index, budgetMinutes),
  );

  const feasible = modelled
    .filter(journey => journey.feasible)
    .sort((a, b) =>
      a.totalDurationSeconds - b.totalDurationSeconds ||
      a.id.localeCompare(b.id),
    );

  return {
    journeys: feasible,
    rejectedJourneyCount: modelled.length - feasible.length,
  };
}
