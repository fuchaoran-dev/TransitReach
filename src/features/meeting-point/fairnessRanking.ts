import type { SurfaceState } from './hooks/useParticipantAreas';
import { minutesAt } from './travelTimeSurface';
import type { Participant } from './types';
import type { Venue } from './venueService';

export interface RankedPlace {
  venue: Venue;
  /** Each counted participant's travel time in whole minutes, rounded up, in participant order. */
  minutes: number[];
  /** The longest of those trips. */
  longest: number;
  /** Longest minus shortest. */
  gap: number;
}

export type RankingState =
  | { status: 'waiting'; waitingOn: Participant[] }
  /** Someone's travel times could not be worked out, so no fair order exists yet. */
  | { status: 'blocked'; failed: Participant[] }
  /** `untimed` places lie in the shared area but fall where a surface gives no time. */
  | { status: 'ready'; places: RankedPlace[]; untimed: number };

/**
 * Orders places by how fairly the trip there falls on the group.
 *
 * First by the longest trip anyone makes, then by the gap between the longest and shortest,
 * then by name so the order is stable. Leading with the longest trip means nobody is stuck
 * with a long journey; the gap then separates places that are equally quick for the slowest
 * person but lopsided for the rest. Ranking by the gap alone was rejected: it can prefer a
 * place where everyone travels 55 minutes over one where trips are 10 and 20.
 *
 * Times are rounded up, because rounding down would understate the journey. The order is a
 * stated rule about travel time, not a judgement of the place.
 */
export function rankPlaces(
  venues: Venue[],
  participants: Participant[],
  surfaceFor: (participant: Participant) => SurfaceState | null,
): RankingState {
  const states = participants.map(surfaceFor);
  const failed = participants.filter((_, i) => states[i]?.status === 'failed' || states[i]?.status === 'timedout');
  if (failed.length > 0) return { status: 'blocked', failed };
  const waitingOn = participants.filter((_, i) => states[i]?.status !== 'ready');
  if (waitingOn.length > 0) return { status: 'waiting', waitingOn };

  const surfaces = states.flatMap(state => (state?.status === 'ready' ? [state.surface] : []));
  const places: RankedPlace[] = [];
  let untimed = 0;

  for (const venue of venues) {
    const exact = surfaces.map(surface => minutesAt(surface, venue.lat, venue.lon));
    if (exact.some(value => value === null)) {
      untimed++;
      continue;
    }
    const minutes = (exact as number[]).map(value => Math.ceil(value));
    const longest = Math.max(...minutes);
    places.push({ venue, minutes, longest, gap: longest - Math.min(...minutes) });
  }

  places.sort((a, b) => a.longest - b.longest || a.gap - b.gap || a.venue.name.localeCompare(b.venue.name));
  return { status: 'ready', places, untimed };
}
