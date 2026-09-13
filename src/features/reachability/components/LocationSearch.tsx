import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Search, MapPin, Train, Building2, GraduationCap, Landmark, Plane, ShoppingBag, Stethoscope,
} from 'lucide-react';
import { loadRailStops, linesForStop } from '@/shared/data/adapters/gtfsAdapter';
import { loadPlaces, type PlaceKind } from '@/shared/data/adapters/osmAdapter';
import type { SearchHit } from '../reachabilityService';
import { searchLocations, hitName, MIN_QUERY_LENGTH } from '../reachabilityService';

/**
 * Station, stop and place search.
 *
 * AC 1.1.3 — this component performs no geocoding and issues no network request. It
 * searches two committed datasets: the transit feed's stations, and a named-place extract
 * built from OpenStreetMap at build time by `scripts/build-places.mjs`.
 *
 * A string that looks like a street address ("Jalan ...", a postcode, a unit number) is an
 * ordinary non-match, because addresses are not in either dataset. Do not add an address
 * lookup, a "did you mean" hint, or a geocoding fallback here — that would send every
 * query to a third party and break a criterion the team has already had to defend. If a
 * place is missing, re-run the build script and commit the result.
 */

const PLACEHOLDER = 'Search station, stop or place';
const NO_MATCH = 'No station, stop or place matches that name';
const HELPER = 'Search by name, or tap the map to choose a starting point.';

const PLACE_ICONS: Record<PlaceKind, typeof MapPin> = {
  city: Building2,
  town: Building2,
  suburb: MapPin,
  hospital: Stethoscope,
  university: GraduationCap,
  mall: ShoppingBag,
  attraction: Landmark,
  airport: Plane,
};

interface LocationSearchProps {
  onSelect: (hit: SearchHit) => void;
  selected?: SearchHit | null;
  compact?: boolean;
}

export function LocationSearch({ onSelect, selected, compact = false }: LocationSearchProps) {
  const [query, setQuery] = useState(selected ? hitName(selected) : '');
  const [focused, setFocused] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);

  // The starting point is shared across screens, so it can change without this field being
  // touched. Reflecting it means every screen names the location its numbers describe,
  // instead of showing an empty box beside results for somewhere the user cannot see.
  //
  // Clearing on null matters as much as setting on a name: an origin picked by tapping the
  // map has no name, and leaving the last station's name in the box would label the result
  // with a place it did not come from.
  const selectedName = selected ? hitName(selected) : null;
  useEffect(() => {
    setQuery(selectedName ?? '');
  }, [selectedName]);

  const stops = useMemo(() => loadRailStops(), []);
  const places = useMemo(() => loadPlaces(), []);
  const results = useMemo(
    () => searchLocations(query, stops, places),
    [query, stops, places],
  );

  // Below the minimum query length the field is inert: no results, no "no match".
  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  const handleSelect = (hit: SearchHit) => {
    onSelect(hit);
    // AC 1.1.1 — the exact name from the source data is written into the field.
    setQuery(hitName(hit));
    setFocused(false);
    setHighlightedIdx(-1);
  };

  return (
    <div className="relative">
      <div className={`glass-input flex items-center gap-2 px-3.5 py-3 ${focused ? 'ring-2 ring-teal-500/20' : ''} ${compact ? 'text-sm' : ''}`}>
        <Search size={compact ? 16 : 18} className={focused ? 'text-teal-600' : 'text-slate-400'} style={{ transition: 'color 200ms ease-out' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlightedIdx(-1); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightedIdx(prev => Math.min(prev + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightedIdx(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter' && highlightedIdx >= 0) {
              handleSelect(results[highlightedIdx]);
            }
          }}
          placeholder={PLACEHOLDER}
          className="flex-1 bg-transparent outline-none text-sm font-medium text-slate-700 placeholder:text-slate-400"
        />
        {selected && <MapPin size={16} className="text-teal-600" />}
      </div>

      {focused && (
        <div className="absolute top-full mt-2 left-0 right-0 glass-strong p-2 z-[1000] fade-slide-up max-h-64 overflow-y-auto scrollbar-thin">
          {results.map((hit, idx) => (
            <ResultRow
              key={hit.kind === 'stop' ? hit.stop.stopId : hit.place.placeId}
              hit={hit}
              query={query}
              highlighted={highlightedIdx === idx}
              onMouseEnter={() => setHighlightedIdx(idx)}
              onClick={() => handleSelect(hit)}
            />
          ))}

          {searching && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-slate-600">{NO_MATCH}</div>
          )}

          {results.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500">{HELPER}</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One result row.
 *
 * A station shows the lines serving it; a place shows what kind of thing it is. The
 * subtitle is what tells two same-named results apart — there are several malls called
 * "AEON" and a suburb and a station both called "Subang Jaya".
 */
function ResultRow({ hit, query, highlighted, onMouseEnter, onClick }: {
  hit: SearchHit;
  query: string;
  highlighted: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const isStop = hit.kind === 'stop';
  const Icon = isStop ? Train : PLACE_ICONS[hit.place.kind];
  const subtitle = isStop
    ? linesForStop(hit.stop).map(line => line.longName).join(' · ')
    : hit.place.kindLabel;

  return (
    <button
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        highlighted ? 'bg-teal-50' : 'hover:bg-slate-50'
      }`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${isStop ? 'text-blue-500' : 'text-slate-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800 truncate">
          {highlightName(hitName(hit), query)}
        </div>
        <div className="text-xs text-slate-500 truncate">{subtitle}</div>
      </div>
    </button>
  );
}

function highlightName(name: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return name;
  const idx = name.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return name;
  return (
    <>
      {name.slice(0, idx)}
      <span className="text-teal-700 font-bold">{name.slice(idx, idx + needle.length)}</span>
      {name.slice(idx + needle.length)}
    </>
  );
}
