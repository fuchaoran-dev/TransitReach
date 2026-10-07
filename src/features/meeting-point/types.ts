import type { LatLng, Origin } from '@/features/reachability/types';

/**
 * The most people one room accepts.
 *
 * AC 6.3.1 leaves the supported group size open. Six is set by cost rather than by UX:
 * every participant needs two isochrones from the shared OTP engine, which has already been
 * measured stalling under repeated use (17.5 s against a normal 1.4 s).
 */
export const MAX_PARTICIPANTS = 6;

export interface MeetingRoom {
  /** The code carried in the share link, `?meet=<code>`. */
  code: string;
  timeBudget: number;
  expiresAt: string;
  /** Safe invalidation timestamp for shared room state. */
  updatedAt: string;
  /** Changes only when membership, an origin or the shared travel budget changes. */
  planningRevision: number;
  /** The shared agreement. Null means the room is still planning. */
  confirmedPlan: ConfirmedMeetingPlan | null;
  /** A member's suggestion is visible, but never changes the agreement by itself. */
  proposedArrivalTime: string | null;
}

export interface MeetingVenue {
  id: string;
  type: 'station' | 'cafe' | 'restaurant' | 'mall';
  name: string;
  kindLabel: string;
  lat: number;
  lon: number;
  address?: string;
  hours?: string;
}

export interface ConfirmedMeetingPlan {
  venue: MeetingVenue;
  /** ISO timestamp for the group's agreed arrival. */
  arrivalTime: string;
  /** Increases whenever the agreed place or time changes. */
  version: number;
}

/** Public invitation fields obtainable with the opaque room code before joining. */
export interface MeetingInvitation {
  code: string;
  confirmedPlan: ConfirmedMeetingPlan | null;
}

export type ArrivalStatus = 'Ready' | 'Check needed' | 'Not checked';

/** The only per-person information shared with other room members. */
export interface SharedMemberStatus {
  /** Opaque participant row id, used only as a stable list key. */
  id: string;
  displayName: string;
  arrivalStatus: ArrivalStatus;
  isSelf: boolean;
}

export interface Participant {
  id: string;
  /** The anonymous sign-in that owns this row. This type is returned only for the caller. */
  userId: string;
  nickname: string | null;
  /** Null until this participant has chosen a starting point. */
  at: LatLng | null;
  /**
   * How the point was chosen. The private room-state RPC returns it only to its owner.
   */
  source: Exclude<Origin['source'], 'device'> | null;
  /** The station or place name, when the point came from search. */
  label: string | null;
  /** 0–5, held for as long as this participant stays; see participantColours.ts. */
  colourSlot: number;
  arrivalStatus: ArrivalStatus;
  checkedPlanVersion: number | null;
}

/** A starting point as a participant sets it. */
export interface StartingPoint {
  at: LatLng;
  source: NonNullable<Participant['source']>;
  label: string | null;
}

/** The name shown for a participant: their nickname, or their place in join order. */
export function participantName(participant: Participant, index: number): string {
  return participant.nickname ?? `Person ${index + 1}`;
}

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export type RoomError = 'invalid_code' | 'not_found' | 'full' | 'unavailable';

export const ROOM_ERROR_MESSAGES: Record<RoomError, string> = {
  invalid_code: 'Room codes are 8 letters and numbers. Check the code and try again.',
  not_found: 'That room does not exist or is no longer available.',
  full: `That room is full. A room holds up to ${MAX_PARTICIPANTS} people.`,
  unavailable: 'Could not reach the room service. Try again.',
};
