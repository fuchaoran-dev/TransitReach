import { VENUE_TYPES, type Venue, type VenueType } from '../venueService';

interface VenueFilterProps {
  /** Every venue inside the shared area, whether shown or not. */
  venues: Venue[];
  selected: ReadonlySet<VenueType>;
  onToggle: (type: VenueType) => void;
}

/**
 * Which kinds of place to show inside the shared area.
 *
 * Nothing is chosen on arrival. The shared area in central Kuala Lumpur can hold hundreds of
 * restaurants, and drawing them all answers a question nobody asked — the lesson of Epic 5's
 * AC 5.1.1. The first tap is the question ("where could we get coffee?") and the map answers
 * only that. Every chip carries its count, so a choice is never a guess at what it holds.
 *
 * Shown, not ranked: nothing here says best or recommended. Ranking by how fairly the journey
 * falls on each person is US 6.2, and ranking private businesses needs that basis to stand on.
 */
export function VenueFilter({ venues, selected, onToggle }: VenueFilterProps) {
  const counts = new Map<VenueType, number>();
  for (const venue of venues) counts.set(venue.type, (counts.get(venue.type) ?? 0) + 1);
  const shown = venues.filter(venue => selected.has(venue.type)).length;

  return (
    <div className="space-y-2">
      <div className="text-sm font-bold text-slate-900">Kinds of place in the shared area</div>
      <div role="group" aria-label="Kinds of place to show on the map" className="flex flex-wrap gap-1.5">
        {VENUE_TYPES.map(type => {
          const count = counts.get(type.id) ?? 0;
          const on = selected.has(type.id);
          return (
            <button
              key={type.id}
              type="button"
              aria-pressed={on}
              aria-label={`${type.label}: ${count} in the shared area`}
              disabled={count === 0}
              onClick={() => onToggle(type.id)}
              className={`chip whitespace-nowrap text-xs ${on ? 'chip-selected' : 'chip-unselected'} disabled:opacity-50 disabled:cursor-default`}
              style={{ padding: '4px 10px' }}
            >
              {type.label} <span className="tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        {selected.size === 0 ? 'Choose a kind of place to see it on the map.' : `${shown} shown. Tap one on the map for details.`}
      </p>
    </div>
  );
}
