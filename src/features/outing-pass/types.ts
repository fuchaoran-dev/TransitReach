import type { ConfirmedMeetingPlan } from '@/features/meeting-point/types';
import type { TransitPlanLeg, WalkStep } from '@/shared/services/transitRoutingClient';

export const PASS_SCHEMA_VERSION = 1 as const;

export type PersonalPassStatus = 'Ready' | 'Check needed' | 'Not checked';

export type UnsupportedEvidenceReason =
  | 'not-applicable'
  | 'missing-route-or-stop'
  | 'unknown-service'
  | 'model-not-available'
  | 'insufficient-comparable-historical-data'
  | 'service-unavailable'
  | 'hours-missing'
  | 'hours-conditional'
  | 'hours-invalid'
  | 'closing-time-unavailable'
  | 'forecast-unavailable'
  | 'outside-forecast-window';

export interface CheckedDelayEvidence {
  status: 'checked';
  seconds: number;
  confidence: string;
  sampleCount: number;
  source: string;
  modelVersion: string;
  disclaimer: string;
}

export interface NotCheckedEvidence {
  status: 'not-checked';
  reason: UnsupportedEvidenceReason;
  label: 'Not checked' | 'Hours unknown' | 'Weather unknown';
}

export type DelayEvidence = CheckedDelayEvidence | NotCheckedEvidence;

export interface CheckedMargin {
  status: 'checked';
  marginSeconds: number;
  closesAt: string;
  source: string;
}

export interface AlwaysOpenMargin {
  status: 'always-open';
  label: 'Open 24 hours';
  source: string;
}

export type ClosingMargin = CheckedMargin | AlwaysOpenMargin | NotCheckedEvidence;

export interface CheckedWeatherEvidence {
  status: 'checked';
  period: 'Morning' | 'Afternoon' | 'Night';
  summary: string;
  source: 'MET Malaysia via data.gov.my';
  sourceUrl: string;
  location: string;
  retrievedAt: string;
  walkingSecondsInPeriod: number;
}

export type WeatherEvidence = CheckedWeatherEvidence | NotCheckedEvidence;

export interface CheckedPassLeg extends TransitPlanLeg {
  id: string;
  estimatedStartTime: string | null;
  estimatedEndTime: string | null;
  cumulativeDelaySeconds: number;
  /** Only bus legs have applicable delay evidence. */
  delay: DelayEvidence | null;
}

export interface ConnectionCheck {
  id: string;
  atName: string;
  fromLegIndex: number;
  toLegIndex: number;
  estimatedArrivalTime: string | null;
  estimatedDepartureTime: string | null;
  spareSeconds: number | null;
  status: 'checked' | 'not-checked';
}

export interface WalkingDirections {
  totalSeconds: number;
  totalDistanceMeters: number;
  directions: Array<WalkStep & { legId: string }>;
}

export type WeakPointKind = 'connection' | 'arrival' | 'closing' | 'unchecked-delay';

export interface PassWeakPoint {
  kind: WeakPointKind;
  label: string;
  marginSeconds: number | null;
  legId?: string;
  connectionId?: string;
}

/** Canonical Epic 8 pass. MD8-2 can add another wrapper around the same structure later. */
export interface PersonalPass {
  schemaVersion: typeof PASS_SCHEMA_VERSION;
  kind: 'group-outing';
  id: string;
  roomCode: string;
  /** Kept in device storage only and never encoded in the room QR or group projection. */
  memberId: string;
  planVersion: number;
  checkedAt: string;
  routeTargetTime: string;
  meeting: ConfirmedMeetingPlan;
  selectedJourneyId: string;
  leaveTime: string;
  estimatedArrivalTime: string;
  arrivalMarginSeconds: number;
  status: PersonalPassStatus;
  legs: CheckedPassLeg[];
  connections: ConnectionCheck[];
  walking: WalkingDirections;
  weather: WeatherEvidence[];
  closingMargin: ClosingMargin;
  weakPoint: PassWeakPoint;
}

export interface JourneyOptionSummary {
  id: string;
  leaveTime: string;
  estimatedArrivalTime: string;
  durationSeconds: number;
  walkingSeconds: number;
  transferCount: number;
  status: PersonalPassStatus;
  selected: boolean;
}

export interface StoredPassSummary {
  id: string;
  roomCode: string;
  planVersion: number;
  meetingName: string;
  meetingTime: string;
  leaveTime: string;
  checkedAt: string;
  status: PersonalPassStatus;
  outdated: boolean;
}

export type PersonalPassState =
  | { status: 'idle'; reason: 'missing-origin' | 'unconfirmed' }
  | { status: 'checking'; previous: PersonalPass | null }
  | { status: 'failed'; message: string; previous: PersonalPass | null }
  | { status: 'ready'; pass: PersonalPass; options: JourneyOptionSummary[] };
