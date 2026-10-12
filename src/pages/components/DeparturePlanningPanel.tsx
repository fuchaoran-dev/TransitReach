import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_META, CATEGORY_ORDER } from '@/shared/data';
import { loadEssentialServices } from '@/shared/data/adapters/essentialServicesAdapter';
import { deduplicateServices } from '@/features/essential-services/serviceDataRules';
import { ServiceFilters } from '@/features/essential-services';
import type { LatLng } from '@/features/reachability/types';
import type { ServiceLocation } from '@/shared/types/service';
import type { MapServicesModel } from './useMapServices';
import {
  compareServices, matchesService, serviceSnapshot, type ComparisonScope, type ServiceSnapshot,
} from '@/features/time-planning/planningService';

export interface DeparturePlanningProps {
  origin: LatLng | null;
  budget: number;
  departure: string;
  dates: string[];
  model: MapServicesModel;
  onApply: (departure: string) => void;
  onBaseline: (snapshot: ServiceSnapshot | null) => void;
  onSelect: (service: ServiceLocation) => void;
}

const departureCaption = (value: string) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur',
}).format(new Date(`${value}:00+08:00`));

export function DeparturePlanningPanel({ origin, budget, departure, dates, model, onApply, onBaseline, onSelect }: DeparturePlanningProps) {
  const [baseline, setBaseline] = useState(departure);
  const [scope, setScope] = useState<ComparisonScope>('reachable');
  const [pair, setPair] = useState<[ServiceSnapshot, ServiceSnapshot] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const labels = useMemo(() => Object.fromEntries(CATEGORY_ORDER.map(category => [category, CATEGORY_META[category].label])) as Record<ServiceLocation['category'], string>, []);
  const allServices = useMemo(() => deduplicateServices(loadEssentialServices()), []);
  const categoryKey = [...model.categories].sort().join(',');
  const filtered = useMemo(() => model.awaitingChoice ? [] : allServices.filter(service => matchesService(service, model.categories, model.search, labels)), [allServices, model.categories, model.search, model.awaitingChoice, labels]);
  const dateKey = dates.join(',');
  const context = `${origin?.lat},${origin?.lon}|${budget}|${categoryKey}|${model.search}|${dateKey}`;
  const compareKey = `${context}|${baseline}|${departure}`;
  const [pairKey, setPairKey] = useState('');

  useEffect(() => {
    controller.current?.abort();
    setBusy(false); setError(''); setProgress('');
    setPair(null); setExpanded(null);
    onBaseline(null);
  }, [context, onBaseline]);
  useEffect(() => {
    controller.current?.abort(); setBusy(false); setError(''); setProgress('');
  }, [compareKey]);
  useEffect(() => () => controller.current?.abort(), []);

  const visiblePair = pairKey === compareKey ? pair : null;
  const changes = visiblePair ? compareServices(visiblePair[0], visiblePair[1], scope) : [];

  const start = () => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(''); setProgress('Starting checks…');
    return current;
  };
  const cancel = () => { controller.current?.abort(); setBusy(false); setProgress(''); };

  const compare = async () => {
    if (!origin || !filtered.length || !dates.includes(baseline.slice(0, 10)) || !dates.includes(departure.slice(0, 10))) return;
    const current = start();
    setPair(null); onBaseline(null);
    try {
      const a = await serviceSnapshot(origin, budget, baseline, filtered, current.signal, (done, total) => setProgress(`Baseline: ${done}/${total} services`));
      const b = baseline === departure ? a : await serviceSnapshot(origin, budget, departure, filtered, current.signal, (done, total) => setProgress(`Selected time: ${done}/${total} services`));
      if (current.signal.aborted) return;
      setPair([a, b]); setPairKey(compareKey); onBaseline(a);
    } catch (reason) {
      if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : 'Comparison unavailable');
    } finally { if (!current.signal.aborted) { setBusy(false); setProgress(''); } }
  };

  return <div className="departure-planner">
    <input className="input" aria-label="Filter services for time comparison" placeholder="Service or category…" value={model.search} onChange={event => model.setSearch(event.target.value)} />
    <ServiceFilters selected={model.categories} onToggle={model.toggleCategory} counts={model.counts} compact />
    {model.awaitingChoice && <p>Choose categories or search before comparing.</p>}
    <section aria-label="Compare service availability">
      <h3>Compare departures</h3>
      <div className="planning-fields">
        <label>Baseline · MYT<input type="datetime-local" value={baseline} min={`${dates[0]}T00:00`} max={`${dates[dates.length - 1]}T23:59`} onChange={event => { if (event.target.value) setBaseline(event.target.value); }} /></label>
        <label>Selected · MYT<input type="datetime-local" value={departure} min={`${dates[0]}T00:00`} max={`${dates[dates.length - 1]}T23:59`} onChange={event => { if (event.target.value && dates.includes(event.target.value.slice(0, 10))) onApply(event.target.value); }} /></label>
      </div>
      <div className="planning-actions"><button className="btn-secondary" disabled={Boolean(busy) || !origin || !filtered.length || !dates.includes(baseline.slice(0, 10)) || !dates.includes(departure.slice(0, 10))} onClick={() => void compare()}>Compare times</button><button className="planning-link" disabled={Boolean(busy)} onClick={() => { setBaseline(departure); onBaseline(null); }}>Use current as baseline</button></div>
      {!dates.length && <p role="alert">No dates overlap the next seven days and the loaded transit timetable.</p>}
      {visiblePair && <>
        <p className="comparison-caption"><span>{departureCaption(baseline)}</span> → <span>{departureCaption(departure)}</span></p>
        <div className="planning-switch" role="group" aria-label="Service comparison basis"><button aria-pressed={scope === 'reachable'} onClick={() => { setScope('reachable'); setExpanded(null); }}>In reach</button><button aria-pressed={scope === 'available'} onClick={() => { setScope('available'); setExpanded(null); }}>Open at arrival</button></div>
        <p>{scope === 'reachable' ? 'Geographic reach, not a guarantee of opening.' : 'Scheduled route within budget and estimated opening hours.'} Same origin, {budget} min budget and filters.</p>
        <div className="service-delta-list">{CATEGORY_ORDER.filter(category => changes.some(change => change.service.category === category)).map(category => {
          const rows = changes.filter(change => change.service.category === category);
          const gained = rows.filter(row => row.kind === 'gained'); const lost = rows.filter(row => row.kind === 'lost'); const unknown = rows.filter(row => row.kind === 'unknown');
          const selectedRows = rows.filter(row => `${category}:${row.kind}` === expanded);
          return <div className="service-delta-row" key={category}>
            <div className="service-delta-heading"><strong>{CATEGORY_META[category].label}</strong><span className="delta-total" title="Selected time count">{rows.filter(row => row.current).length}</span>
              {gained.length > 0 && <button className="delta-badge delta-gained" aria-expanded={expanded === `${category}:gained`} aria-label={`${gained.length} newly ${scope === 'reachable' ? 'reachable' : 'available'} ${CATEGORY_META[category].label}`} onClick={() => setExpanded(expanded === `${category}:gained` ? null : `${category}:gained`)}>+{gained.length}</button>}
              {lost.length > 0 && <button className="delta-badge delta-lost" aria-expanded={expanded === `${category}:lost`} aria-label={`${lost.length} no longer ${scope === 'reachable' ? 'reachable' : 'available'} ${CATEGORY_META[category].label}`} onClick={() => setExpanded(expanded === `${category}:lost` ? null : `${category}:lost`)}>−{lost.length}</button>}
              {!gained.length && !lost.length && <button className="delta-badge" onClick={() => setExpanded(expanded === `${category}:both` ? null : `${category}:both`)}>No change</button>}
              {unknown.length > 0 && <button className="delta-badge delta-unknown" onClick={() => setExpanded(expanded === `${category}:unknown` ? null : `${category}:unknown`)}>? {unknown.length}</button>}
            </div>
            {selectedRows.length > 0 && <ul className="delta-details">{selectedRows.map(row => <li key={row.service.id}><button onClick={() => onSelect(row.service)}>{row.service.name} ↗</button><small>{scope === 'reachable' ? row.kind === 'gained' ? 'Newly inside the modelled reachable area' : row.kind === 'lost' ? 'Outside the selected time’s reachable area' : 'Within reach at both times' : row.kind === 'lost' ? row.after?.reason : row.kind === 'unknown' ? `Baseline: ${row.before?.reason}; selected: ${row.after?.reason}` : row.after?.reason}</small></li>)}</ul>}
          </div>;
        })}</div>
        {!changes.length && <p>No services match these filters.</p>}
        <details className="planning-disclosure"><summary>Map colours & data limits</summary><p>Orange: baseline only · purple: selected only · teal: both. Colours describe geographic coverage. Unknown opening or route checks never count as confirmed open. Opening hours are OSM estimates; confirm with the venue. No weather-based travel delays are invented.</p></details>
      </>}
    </section>

    {busy && <div role="status" className="planning-progress">{progress}<button className="planning-link" onClick={cancel}>Cancel</button></div>}
    {error && <p role="alert" className="planning-error">{error} Try again.</p>}
  </div>;
}
