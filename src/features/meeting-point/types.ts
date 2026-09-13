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
}

export interface Participant {
  id: string;
  /** The anonymous sign-in that owns this row; only that device may edit it. */
  userId: string;
  nickname: string | null;
  /** Null until this participant has chosen a starting point. */
  at: LatLng | null;
  /**
   * How the point was chosen. Device location is excluded: a room shares the point with
   * everyone in it, so a GPS fix would be broadcast to other people.
   */
  source: Exclude<Origin['source'], 'device'> | null;
  /** The station or place name, when the point came from search. */
  label: string | null;
}
