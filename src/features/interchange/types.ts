import type { ServiceLocation } from '@/shared/types/service';

export interface JourneyPoint {
  name: string;
  stopId: string | null;
  lat: number;
  lon: number;
}

export interface JourneyLeg {
  id: string;
  mode: string;
  routeId: string | null;
  routeShortName: string | null;
  routeLongName: string | null;
  routeColor: string | null;
  durationSeconds: number;
  distanceMeters: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  from: JourneyPoint;
  to: JourneyPoint;
  geometry: Array<{ lat: number; lon: number }>;
  transitLeg: boolean;
  /** True when this walking leg is part of an estimated interchange explanation. */
  partOfInterchange: boolean;
}

export type InterchangeLayout =
  | 'same-stop'
  | 'within-station'
  | 'connected-stops'
  | 'external-transfer';

export interface InterchangeEstimate {
  id: string;
  fromLegIndex: number;
  toLegIndex: number;
  atName: string;
  fromModeLabel: string;
  toModeLabel: string;
  distanceMeters: number;
  estimatedDurationSeconds: number;
  availableWindowSeconds: number | null;
  residualWaitingSeconds: number | null;
  layout: InterchangeLayout;
  feasible: boolean;
  factors: string[];
}

export interface ModelledJourney {
  id: string;
  totalDurationSeconds: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  walkTimeSeconds: number;
  waitingTimeSeconds: number;
  transitTimeSeconds: number;
  legs: JourneyLeg[];
  interchanges: InterchangeEstimate[];
  feasible: boolean;
  withinBudget: boolean;
}

export type JourneyInspectionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface JourneyInspectionModel {
  status: JourneyInspectionStatus;
  error: string | null;
  destination: ServiceLocation | null;
  journeys: ModelledJourney[];
  rejectedJourneyCount: number;
  representativeJourneyId: string | null;
  selectedJourney: ModelledJourney | null;
  selectJourney: (journeyId: string) => void;
  clearSelection: () => void;
  retry: () => void;
}
