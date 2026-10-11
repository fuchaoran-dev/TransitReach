import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/features/reachability/types';
import type { ServiceLocation } from '@/shared/types/service';
import type { WeatherDay } from '@/pages/components/WeatherPlanning';
import { arrivalAvailability } from '@/features/essential-services/arrivalAvailability';
import { departureCandidates, evaluateDeparture, malaysiaInstant, mapLimited, rankDepartures, type DepartureOption, type PlanningPreference } from './planningService';

interface Inputs {
  origin: LatLng | null;
  service: ServiceLocation | null;
  budget: number;
  departure: string;
  dates: string[];
  weatherDays: WeatherDay[];
  weatherDistrictId: string;
  weatherDistrictName: string;
  weatherRetrievedAt: string | null;
  enabled: boolean;
  /** Deterministic clock for acceptance tests; production uses the actual clock. */
  now?: number;
}
type Status = 'idle' | 'checking' | 'ready' | 'cancelled' | 'error';
interface Result { key: string; status: Status; options: DepartureOption[]; progress: string; error?: string }

/** Selection-driven planning. A suggestion never mutates the shared journey. */
export function useDepartureRecommendation(input: Inputs) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [fromClock, setFromClock] = useState('18:00');
  const [toClock, setToClock] = useState('21:00');
  const [preference, setPreference] = useState<PlanningPreference>('avoid-rain');
  const [confirmedScope, setConfirmedScope] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const [result, setResult] = useState<Result>({ key: '', status: 'idle', options: [], progress: '' });
  const controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, { at: number; options: DepartureOption[] }>());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const now = input.now ?? clock;
  const selectedDay = input.departure.slice(0, 10);
  const fromDate = range?.from ?? selectedDay;
  const toDate = range?.to ?? selectedDay;
  const service = input.service;
  // Arrival estimates change while the service list refreshes. They are NOT inputs
  // to this independent routing check and must not cause a second calculation.
  const tripScope = `${input.origin?.lat},${input.origin?.lon}|${service?.id}|${service?.lat},${service?.lon}|${input.weatherDistrictId}`;
  useEffect(() => setConfirmedScope(null), [tripScope]);
  const weatherConfirmed = confirmedScope === tripScope;
  const weatherDays = weatherConfirmed ? input.weatherDays : [];
  const routeOnly = !weatherConfirmed || !weatherDays.length;
  const effectivePreference = preference === 'avoid-rain' && routeOnly ? 'less-walking' : preference;
  const candidates = departureCandidates(input.dates.filter(date => date >= fromDate && date <= toDate), fromClock, toClock, now);
  let blocked = '';
  if (!input.origin || !service) blocked = 'Select a service to see a suggested departure.';
  else if (service.lat == null || service.lon == null) blocked = 'Destination coordinates unavailable.';
  else if (fromDate > toDate || fromClock > toClock) blocked = 'End of the window must follow its start.';
  else if (!candidates.length) blocked = 'No future departures in this window. Choose later dates or times.';
  else {
    const hours = arrivalAvailability(service.hours, malaysiaInstant(candidates[0]), 0);
    if (hours.status === 'Unknown') blocked = `${hours.reason}. Cannot confirm a suitable arrival; check with the venue.`;
  }
  const queryKey = JSON.stringify([tripScope, service?.hours, input.budget, candidates, effectivePreference, weatherDays]);
  const requestKey = `${queryKey}|${revision}`;
  const latest = useRef({ input, weatherDays, candidates, effectivePreference, blocked, requestKey });
  latest.current = { input, weatherDays, candidates, effectivePreference, blocked, requestKey };

  useEffect(() => {
    const current = new AbortController(); controller.current = current;
    const snapshot = latest.current;
    if (!input.enabled || snapshot.blocked) return () => current.abort();
    const cached = cache.current.get(queryKey);
    if (cached && Date.now() - cached.at < 5 * 60_000) {
      setResult({ key: requestKey, status: 'ready', options: cached.options, progress: '' });
      return () => current.abort();
    }
    setResult({ key: requestKey, status: 'checking', options: [], progress: 'Checking departure times…' });
    // Debounce selection/constraint changes; at most two route requests at a time.
    const timer = setTimeout(() => {
      void mapLimited(snapshot.candidates, current.signal, time => evaluateDeparture(
        snapshot.input.origin!, snapshot.input.service!, time, snapshot.input.budget,
        snapshot.weatherDays, snapshot.effectivePreference, current.signal,
      ), (done, total) => {
        if (!current.signal.aborted) setResult({ key: requestKey, status: 'checking', options: [], progress: `${done}/${total} times checked` });
      }).then(options => {
        if (current.signal.aborted || latest.current.requestKey !== requestKey) return;
        // Do not cache upstream failures as a lasting no-result recommendation.
        if (options.some(option => option.availability === 'available')) {
          if (cache.current.size >= 30) cache.current.delete(cache.current.keys().next().value!);
          cache.current.set(queryKey, { at: Date.now(), options });
        }
        setResult({ key: requestKey, status: 'ready', options, progress: '' });
      }).catch(reason => {
        if (!current.signal.aborted) setResult({ key: requestKey, status: 'error', options: [], progress: '', error: reason instanceof Error ? reason.message : 'Route checks unavailable' });
      });
    }, 300);
    return () => { clearTimeout(timer); current.abort(); };
  }, [requestKey, queryKey, input.enabled, blocked]);

  const visible = input.enabled && result.key === requestKey && !blocked ? result : null;
  const options = visible?.options ?? [];
  const ranked = rankDepartures(options, effectivePreference).filter(option => Date.parse(malaysiaInstant(option.departure)) > now);
  return {
    status: blocked || !input.enabled ? 'idle' as const : visible?.status ?? 'checking' as const,
    blocked, error: visible?.error, progress: visible?.progress ?? '', options, ranked,
    recommended: ranked[0], fastest: rankDepartures(options, 'fastest')[0],
    dates: input.dates, fromDate, toDate, fromClock, toClock, preference, effectivePreference,
    routeOnly, weatherConfirmed, weatherDistrictName: input.weatherDistrictName,
    weatherRetrievedAt: input.weatherRetrievedAt, singleDay: fromDate === toDate,
    windowLabel: `${range || fromClock !== '18:00' || toClock !== '21:00' ? 'Your' : 'Default'} window · ${fromDate}${fromDate === toDate ? '' : ` – ${toDate}`} · ${fromClock}–${toClock} MYT`,
    setFromDate: (from: string) => setRange({ from, to: toDate < from ? from : toDate }),
    setToDate: (to: string) => setRange({ from: fromDate > to ? to : fromDate, to }),
    setFromClock, setToClock, setPreference,
    confirmWeather: (checked: boolean) => setConfirmedScope(checked ? tripScope : null),
    resetWindow: () => { setRange(null); setFromClock('18:00'); setToClock('21:00'); },
    expandSevenDays: () => { if (input.dates.length) setRange({ from: input.dates[0], to: input.dates[input.dates.length - 1] }); },
    cancel: () => { controller.current?.abort(); setResult({ key: requestKey, status: 'cancelled', options: [], progress: '' }); },
    retry: () => { cache.current.delete(queryKey); setRevision(value => value + 1); },
    apply: (option: DepartureOption, onApply: (departure: string) => void) => {
      if (ranked.includes(option) && latest.current.input.enabled && !controller.current?.signal.aborted && latest.current.requestKey === requestKey && Date.parse(malaysiaInstant(option.departure)) > (input.now ?? Date.now())) onApply(option.departure);
    },
  };
}

export type DepartureRecommendationModel = ReturnType<typeof useDepartureRecommendation>;
