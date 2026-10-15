import type { RankedPlace } from './fairnessRanking';
import type { MeetingSelection, SharedMemberStatus, StartingPoint } from './types';

export const SHARED_MEMBER_COLOURS = ['#2dd4bf', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185'];
interface Waypoint { lat: number; lon: number; label: string; colour: string }

/** Merge only exactly coincident labels; never move participant or venue coordinates. */
export function meetingMapWaypoints(members: SharedMemberStatus[], places: RankedPlace[] = [], selections: MeetingSelection[] = [], draft: StartingPoint | null = null): Waypoint[] {
  const points = new Map<string, Waypoint>();
  const add = (point: Waypoint, highlight = false) => {
    const key = `${point.lat}:${point.lon}`;
    const previous = points.get(key);
    points.set(key, previous ? { ...point, colour: highlight ? point.colour : previous.colour, label: `${previous.label} · ${point.label}` } : point);
  };
  for (const member of members) if (member.at) add({ ...member.at,
    label: `${member.displayName}${member.isSelf ? ' (you)' : ''}`, colour: SHARED_MEMBER_COLOURS[(member.colourSlot ?? 0) % SHARED_MEMBER_COLOURS.length] });
  places.forEach((place, index) => {
    const people = selections.filter(selection => selection.venue.id === place.venue.id && selection.venue.type === place.venue.type);
    add({ lat: place.venue.lat, lon: place.venue.lon, label: `${place.rank ?? index + 1}. ${place.venue.name}${people.length ? ` · Proposed: ${people.map(person => person.displayName).join(', ')}` : ''}`, colour: people.length ? '#fbbf24' : '#ffffff' }, people.length > 0);
  });
  if (draft) add({ ...draft.at, label: 'Preview · not shared', colour: '#fbbf24' }, true);
  return [...points.values()];
}
