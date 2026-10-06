import { useEffect, useMemo, useState } from 'react';
import { useRealEssentialServices } from '@/features/essential-services';
import { CATEGORY_META } from '@/shared/data';
import { DEPARTURE_TIME, TRAVEL_MODE } from '@/shared/data/adapters/routingAdapter';
import type { LatLng } from '@/features/reachability/types';
import type { ServiceCategory, ServiceLocation } from '@/shared/types/service';
import { arrivalAvailability } from '../../features/essential-services/arrivalAvailability';

/**
 * Nothing is selected before the user chooses.
 *
 * Everything-on drew 1,700 dots over central Kuala Lumpur and asked the reader to find
 * the seven hospitals among them. Turning "Food & Meals" off helped and did not fix it:
 * the map was still answering a question nobody had asked. Starting empty makes the first
 * tap the question — "where can I get to a pharmacy" — and the map answers only that.
 *
 * The cost is that an empty map needs to say why it is empty; MapServicesContent renders
 * a prompt whenever there is neither a category nor a search behind it.
 */
const DEFAULT_CATEGORIES: ServiceCategory[] = [];

/**
 * A service matches on its name or on what kind of thing it is.
 *
 * Name-only matching was close to useless — nobody knows their nearest clinic's name, and
 * that is what made the box look irrelevant. Matching the category label too turns it into
 * the fastest route to "show me pharmacies", which is the question people actually arrive
 * with. `query` is already lower-cased and trimmed by the caller.
 */
function matchesQuery(service: ServiceLocation, query: string): boolean {
  return service.name.toLowerCase().includes(query) ||
    CATEGORY_META[service.category].label.toLowerCase().includes(query);
}

export interface MapServicesModel {
  status: ReturnType<typeof useRealEssentialServices>['status'];
  error: string | null;
  /** Everything reachable, before the category and name filters. */
  reachableCount: number;
  /** What the map draws and the list shows. */
  displayed: ServiceLocation[];
  counts: Partial<Record<ServiceCategory, number>>;
  categories: Set<ServiceCategory>;
  toggleCategory: (category: ServiceCategory) => void;
  search: string;
  setSearch: (value: string) => void;
  /**
   * True when the user has neither picked a category nor typed anything, so nothing is
   * drawn. Distinct from "the filters matched nothing": one needs a prompt, the other
   * needs an explanation, and telling a first-time visitor to "try a longer travel time"
   * when they simply have not chosen yet is the wrong answer to the wrong question.
   */
  awaitingChoice: boolean;
  selected: ServiceLocation | null;
  select: (service: ServiceLocation) => void;
  clearSelection: () => void;
  detailsOpen: boolean;
  showDetails: () => void;
  hideDetails: () => void;
}

/**
 * Essential-services coverage for the map panel.
 *
 * `enabled` gates the whole thing: passing a null origin leaves the underlying hook idle,
 * so no isochrone and none of the follow-up travel-time requests are issued while the user
 * is looking at another tab. Without that gate, opening the map would compute a full
 * service coverage nobody asked for, against a two-core routing engine.
 */
export function useMapServices(
  origin: LatLng | null,
  budgetMinutes: number,
  enabled: boolean,
  departureTime = DEPARTURE_TIME,
): MapServicesModel {
  const [categories, setCategories] = useState<Set<ServiceCategory>>(
    () => new Set(DEFAULT_CATEGORIES),
  );
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<ServiceLocation | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  useEffect(() => {
    setSelectedId(null);
    setSelectedLocation(null);
    setDetailsOpen(true);
  }, [origin?.lat, origin?.lon]);

  const data = useRealEssentialServices(
    enabled ? origin : null,
    budgetMinutes,
    TRAVEL_MODE,
    departureTime,
  );

  const counts = useMemo(
    () => data.services.reduce<Partial<Record<ServiceCategory, number>>>((totals, service) => {
      totals[service.category] = (totals[service.category] ?? 0) + 1;
      return totals;
    }, {}),
    [data.services],
  );

  const query = search.toLowerCase().trim();
  const awaitingChoice = categories.size === 0 && query === '';

  /*
   * Two filters, and an empty chip set means "no category constraint" rather than "no
   * categories".
   *
   * That reading is what makes the search usable from a cold start. Nothing is selected
   * by default now, so intersecting the query with the chips would return nothing for
   * every search until the user had already found what they were searching for. The
   * awaitingChoice case above is what keeps "no constraint" from meaning "draw all 1,700".
   *
   *   chips  search   shown
   *   none   empty    nothing — the prompt
   *   none   active   everything matching, any category
   *   some   empty    those categories
   *   some   active   the intersection
   */
  const displayed = useMemo(() => {
    if (awaitingChoice) return [];
    return data.services.filter(service =>
      (categories.size === 0 || categories.has(service.category)) &&
      (query === '' || matchesQuery(service, query)),
    );
  }, [data.services, categories, query, awaitingChoice]);

  // Keep the chosen map focus when a new date temporarily clears routing results.
  // Do not retain the old departure's travel/arrival estimates.
  const selected = useMemo(() => data.services.find(service => service.id === selectedId) ??
    (selectedLocation?.id === selectedId ? {
      ...selectedLocation,
      estimatedTravelTime: data.travelTimes?.[selectedLocation.id],
      arrivalAvailability: arrivalAvailability(selectedLocation.hours, departureTime, data.travelTimes?.[selectedLocation.id]),
    } : null), [data.services, data.travelTimes, selectedId, selectedLocation, departureTime]);

  // Only the chosen place needs an itinerary estimate. Recalculate after a departure
  // change, without launching dozens of requests for unselected list entries.
  const { estimateFor, status } = data;
  useEffect(() => {
    if (enabled && status === 'ready' && selected && selected.estimatedTravelTime === undefined) {
      void estimateFor(selected);
    }
  }, [enabled, status, estimateFor, selected]);

  return {
    status: data.status,
    error: data.error,
    reachableCount: data.services.length,
    displayed,
    counts,
    categories,
    toggleCategory: category => setCategories(previous => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    }),
    search,
    setSearch,
    awaitingChoice,
    selected,
    detailsOpen,
    showDetails: () => setDetailsOpen(true),
    hideDetails: () => setDetailsOpen(false),
    clearSelection: () => {
      setSelectedId(null);
      setSelectedLocation(null);
    },
    select: service => {
      setDetailsOpen(true);
      setSelectedId(service.id);
      setSelectedLocation(service);
    },
  };
}
