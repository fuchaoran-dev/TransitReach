import { useState } from 'react';
import { ChevronDown, ChevronUp, ListOrdered } from 'lucide-react';
import type { RankedPlace, RankingState } from '../fairnessRanking';
import { participantColour } from '../participantColours';
import { joinNames, participantName, type Participant } from '../types';
import type { Venue, VenueType } from '../venueService';
import { VenueFilter } from './VenueFilter';

interface RankedPlacesProps {
  /** Everyone in the room, in list order — used for names and colours. */
  participants: Participant[];
  /** The people ranked for, in the order their times are listed. */
  counted: Participant[];
  myUserId: string | null;
  budgetMinutes: number;
  hasCommonGround: boolean;
  venuesInside: Venue[];
  venueTypes: ReadonlySet<VenueType>;
  onToggleVenueType: (type: VenueType) => void;
  ranking: RankingState | null;
  visibleCount: number;
  pageSize: number;
  onShowMore: () => void;
  selectedId: string | null;
  onSelect: (venueId: string | null) => void;
  onRetrySurface: (participant: Participant) => void;
}

/**
 * US 6.2 — places in the shared area, fairest first.
 *
 * A panel on the right of a wide screen; below the `lg` breakpoint, a sheet along the bottom
 * that opens on demand, so on a phone the map is not buried under two panels at once.
 *
 * The chips that choose which kinds of place are drawn also choose which are ranked: one control,
 * so the list and the map can never disagree about what is being shown.
 */
export function RankedPlaces(props: RankedPlacesProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { hasCommonGround, ranking, venuesInside, venueTypes, onToggleVenueType } = props;
  const count = ranking?.status === 'ready' ? ranking.places.length : 0;

  return (
    <section
      aria-label="Fairest places to meet"
      className="absolute z-[500] left-2 right-2 bottom-2 sm:left-4 sm:right-4 lg:left-auto lg:bottom-auto lg:top-4 lg:right-4 lg:w-[360px]"
    >
      <div className="glass flex flex-col max-h-[55vh] lg:max-h-[calc(100vh-6rem)]">
        <button
          type="button"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(open => !open)}
          className="lg:hidden flex items-center justify-between px-4 py-3 text-sm font-bold text-slate-900"
        >
          <span>Fairest places{count > 0 ? ` (${count})` : ''}</span>
          {sheetOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>

        <div className={`${sheetOpen ? 'block' : 'hidden'} lg:block overflow-y-auto overflow-x-hidden scrollbar-thin px-4 pb-4 lg:pt-4 space-y-4`}>
          <h2 className="hidden lg:flex items-center gap-2 text-sm font-bold text-slate-900">
            <ListOrdered size={16} className="text-slate-500" />
            Fairest places to meet
          </h2>

          {!hasCommonGround ? (
            <p className="text-xs text-slate-600">Places are ranked here once there's somewhere you can all reach.</p>
          ) : (
            <>
              <VenueFilter venues={venuesInside} selected={venueTypes} onToggle={onToggleVenueType} />
              {venueTypes.size > 0 && <RankingBody {...props} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function RankingBody({
  participants,
  counted,
  myUserId,
  budgetMinutes,
  ranking,
  visibleCount,
  pageSize,
  onShowMore,
  selectedId,
  onSelect,
  onRetrySurface,
}: RankedPlacesProps) {
  const nameOf = (participant: Participant) => participantName(participant, participants.indexOf(participant));

  if (!ranking) return null;

  if (ranking.status === 'waiting') {
    return (
      <p role="status" className="text-xs text-slate-600">
        Working out travel times… waiting on {joinNames(ranking.waitingOn.map(nameOf))}.
      </p>
    );
  }

  if (ranking.status === 'blocked') {
    return (
      <div className="text-xs space-y-1">
        <p className="text-rose-600">Couldn't work out travel times for {joinNames(ranking.failed.map(nameOf))}.</p>
        {ranking.failed.map(participant => (
          <button
            key={participant.id}
            type="button"
            onClick={() => onRetrySurface(participant)}
            className="mr-3 font-semibold text-teal-700 hover:underline"
          >
            Retry {nameOf(participant)}
          </button>
        ))}
      </div>
    );
  }

  const { places, untimed } = ranking;
  const mySlot = participants.find(participant => participant.userId === myUserId)?.colourSlot ?? null;

  if (places.length === 0) {
    return (
      <p className="text-xs text-slate-600">
        {untimed > 0 ? "None of these places could be timed — they fall where travel times aren't available." : 'No places of these kinds.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        Ordered by the longest trip anyone makes, then by how much trips differ. Nothing here is a recommendation.
      </p>

      <ol className="space-y-1.5">
        {places.slice(0, visibleCount).map((place, index) => (
          <PlaceRow
            key={place.venue.id}
            place={place}
            rank={index + 1}
            counted={counted}
            nameOf={nameOf}
            colourOf={participant => participantColour(participant, mySlot)}
            myUserId={myUserId}
            budgetMinutes={budgetMinutes}
            selected={place.venue.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ol>

      {visibleCount < places.length && (
        <button type="button" onClick={onShowMore} className="btn-secondary w-full text-xs py-2">
          Show {Math.min(pageSize, places.length - visibleCount)} more of {places.length}
        </button>
      )}

      {untimed > 0 && (
        <p className="text-[11px] text-slate-500">
          {untimed} {untimed === 1 ? 'place is' : 'places are'} left out: {untimed === 1 ? 'it falls' : 'they fall'} where
          travel times aren't available.
        </p>
      )}

      {/* The two measured quirks of the travel-time grid, stated beside the numbers they affect. */}
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Times are modelled from scheduled rail and BRT on a grid of about 200 m. Every trip reads at least about
        5 minutes, even to a place next door, and a place at the edge of the shared area can read a minute or two
        over {budgetMinutes} min.
      </p>
    </div>
  );
}

function PlaceRow({
  place,
  rank,
  counted,
  nameOf,
  colourOf,
  myUserId,
  budgetMinutes,
  selected,
  onSelect,
}: {
  place: RankedPlace;
  rank: number;
  counted: Participant[];
  nameOf: (participant: Participant) => string;
  colourOf: (participant: Participant) => string;
  myUserId: string | null;
  budgetMinutes: number;
  selected: boolean;
  onSelect: (venueId: string | null) => void;
}) {
  const { venue, minutes, longest, gap } = place;
  const scale = Math.max(budgetMinutes, longest);
  const percent = (value: number) => `${(value / scale) * 100}%`;

  return (
    <li className={`rounded-lg ${selected ? 'bg-slate-100 ring-1 ring-slate-300' : ''}`}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : venue.id)}
        className="w-full text-left px-2 py-2"
      >
        <span className="flex items-start gap-2">
          <span className="shrink-0 w-6 h-6 rounded-full bg-slate-800 text-white text-[11px] font-semibold flex items-center justify-center tabular-nums">
            {rank}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900 truncate">{venue.name}</span>
            <span className="block text-xs text-slate-500 truncate">{venue.kindLabel}</span>
          </span>
        </span>

        <span className="block pl-8 mt-1.5 space-y-0.5">
          {counted.map((participant, index) => (
            <span key={participant.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 min-w-0 text-slate-700">
                <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: colourOf(participant) }} />
                <span className="truncate">{nameOf(participant)}</span>
                {participant.userId === myUserId && <span className="font-semibold text-teal-700">You</span>}
              </span>
              <span className="tabular-nums font-medium text-slate-800">{minutes[index]} min</span>
            </span>
          ))}
        </span>

        {/* The fairness indicator: where the group's trips fall on 0–budget, shortest to longest. */}
        <span className="block pl-8 mt-1.5">
          <span aria-hidden="true" className="relative block h-1.5 rounded-full bg-slate-200">
            <span
              className="absolute top-0 h-1.5 rounded-full bg-slate-600"
              style={{ left: percent(longest - gap), width: `max(4px, ${percent(gap)})` }}
            />
          </span>
          <span className="block mt-1 text-[11px] text-slate-600">
            Longest trip {longest} min · trips differ by {gap} min
          </span>
        </span>
      </button>

      {selected && venue.type !== 'station' && (
        <div className="pl-10 pr-2 pb-2 text-xs text-slate-600 space-y-0.5">
          <div>{venue.address ?? 'Address not recorded'}</div>
          <div>{venue.hours ? `Opening hours (OpenStreetMap): ${venue.hours}` : 'Opening hours not recorded'}</div>
        </div>
      )}
    </li>
  );
}
