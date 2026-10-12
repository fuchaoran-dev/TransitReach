import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { JourneyDetail, JourneyMapLayer } from '@/features/interchange';
import { BaseMap, LocationSearch } from '@/features/reachability';
import {
  formatCoord,
  hitFromOrigin,
  hitName,
  hitPosition,
  isInStudyArea,
  nearestAreaName,
  originFromHit,
} from '@/features/reachability/reachabilityService';
import type { Journey, Origin } from '@/features/reachability/types';
import {
  ItineraryTimeline,
  MAX_STOPS,
  MIN_STOPS,
  OrderComparison,
  OutingStopList,
  StopSearch,
  TripMapLayer,
  TripSummary,
  aroundTime,
  outingAsJourney,
  noPlanReasons,
  stopPoint,
  useTripPlan,
  type FinalDestination,
  type OutingDraft,
  type TripPlanProgress,
  type TripPlanRequest,
} from '@/features/trip-planner';
import type { WalkStep } from '@/shared/services/transitRoutingClient';
import type { ServiceLocation } from '@/shared/types/service';
import { loadRailFeedMetadata } from '@/shared/data/adapters/gtfsAdapter';
import { MapDaylight, addDays, malaysiaToday, periodForecast, useWeatherForecast } from './components/WeatherPlanning';

const OUTSIDE_AREA = 'That point is outside the area the transit data covers.';

/**
 * Where the 3D view's controls go once the plan panel is on screen. Their own positions
 * are the map's bottom-right corner and, on a narrow screen, its bottom edge — both under
 * the panel here. They move to the top of the map, below the folded inputs when narrow.
 */
const PLAN_OPEN_3D_CONTROLS = [
  '[&_.city-view-toggle]:right-auto [&_.city-view-toggle]:bottom-auto [&_.city-view-toggle]:left-1/2 [&_.city-view-toggle]:top-4 [&_.city-view-toggle]:-translate-x-1/2',
  'max-lg:[&_.city-view-toggle]:top-[84px] max-lg:[&_.city-focus-toolbar]:top-[84px] max-lg:[&_.city-focus-toolbar]:bottom-auto',
].join(' ');

const FINAL_OPTIONS: Array<{ kind: FinalDestination['kind']; label: string }> = [
  { kind: 'none', label: 'At the last stop' },
  { kind: 'origin', label: 'Back at the start' },
  { kind: 'place', label: 'Somewhere else' },
];

function progressLabel(progress: TripPlanProgress | null): string {
  if (!progress) return 'Comparing visit orders…';
  return progress.phase === 'estimating'
    ? `Estimating travel between places · ${progress.done} of ${progress.total}`
    : `Calculating the closest orders leg by leg · ${progress.done} of ${progress.total}`;
}

function originName(origin: Origin): string {
  return origin.place?.name ?? origin.stop?.name ?? origin.busStop?.name ??
    `Pinned point · ${nearestAreaName(origin.at) ?? formatCoord(origin.at)}`;
}

function malaysiaDateClock(instant: string): { date: string; clock: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, clock: `${value('hour')}:${value('minute')}` };
}

interface TripPlannerPageProps {
  /** The starting point and departure are the ones every other screen uses. */
  journey: Journey;
  draft: OutingDraft;
}

/**
 * Epic 2 — plan one outing with several stops.
 *
 * AC 2.1.1 — the starting point, departure, stops and finish are all on screen before
 * anything is calculated.
 */
export function TripPlannerPage({ journey, draft }: TripPlannerPageProps) {
  const { origin, onOriginChange, onDepartureChange } = journey;
  const departure = journey.departure ?? `${malaysiaToday()}T09:00`;
  const [finishBy, setFinishBy] = useState('');
  const forecast = useWeatherForecast();
  const departureMs = Date.parse(`${departure}:00+08:00`);
  const finishByMs = finishBy ? Date.parse(`${finishBy}:00+08:00`) : null;
  const finishByInvalid = finishByMs !== null && (!Number.isFinite(finishByMs) || finishByMs <= departureMs);
  const departureForecast = forecast.days.find(day => day.date === departure.slice(0, 10));
  const departureWeather = departureForecast ? periodForecast(departureForecast, departure.slice(11)) : null;
  const [notice, setNotice] = useState<string | null>(null);
  // "Somewhere else" is a choice before it is a place, so it is held here until one is picked.
  const [choosingFinalPlace, setChoosingFinalPlace] = useState(false);

  const [today, setToday] = useState(malaysiaToday);
  useEffect(() => {
    const timer = setInterval(() => setToday(malaysiaToday()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // The same window the Map page offers: the coming week, where the timetable covers it.
  const supportedDates = useMemo(() => {
    const feed = loadRailFeedMetadata().feeds[0];
    const iso = (value: string) => value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    return Array.from({ length: 7 }, (_, index) => addDays(today, index))
      .filter(date => feed && date >= iso(feed.serviceDateRange.start) && date <= iso(feed.serviceDateRange.end));
  }, [today]);

  const stopPoints = useMemo(() => draft.stops.map(stopPoint), [draft.stops]);
  const addedIds = useMemo(() => new Set(draft.stops.map(stop => stop.service.id)), [draft.stops]);
  // The next place is looked for around the stop added last; the start, before there is one.
  const searchFrom = useMemo(
    () => stopPoints[stopPoints.length - 1] ?? (origin ? { name: 'your start', ...origin.at } : null),
    [stopPoints, origin],
  );
  const finalKind = choosingFinalPlace ? 'place' : draft.final.kind;
  const finalPlace = draft.final.kind === 'place' ? draft.final.point : null;

  const chooseFinal = (kind: FinalDestination['kind']) => {
    setChoosingFinalPlace(kind === 'place');
    if (kind !== 'place') draft.setFinal({ kind });
  };

  const request = useMemo<TripPlanRequest | null>(() => {
    if (!origin || draft.stops.length < MIN_STOPS || !supportedDates.includes(departure.slice(0, 10)) || finishByInvalid) return null;
    if (choosingFinalPlace && !finalPlace) return null;
    const start = { id: 'origin', name: originName(origin), lat: origin.at.lat, lon: origin.at.lon };
    return {
      origin: start,
      departureTime: `${departure}:00+08:00`,
      stops: draft.stops,
      final: finalPlace ?? (draft.final.kind === 'origin' ? { ...start, id: 'final' } : null),
      limitMinutes: finishByMs === null ? null : (finishByMs - departureMs) / 60_000,
    };
  }, [origin, departure, supportedDates, draft.stops, draft.final, finalPlace, choosingFinalPlace, finishByInvalid, finishByMs, departureMs]);

  const trip = useTripPlan(request);
  const plan = trip.state.status === 'ready' ? trip.state.plan : null;
  const planVersion = trip.state.status === 'ready' ? trip.state.version : null;
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [openLegId, setOpenLegId] = useState<string | null>(null);
  const [inputsOpen, setInputsOpen] = useState(true);
  const [previewStop, setPreviewStop] = useState<ServiceLocation | null>(null);
  const preview = useMemo(
    () => previewStop && previewStop.lat !== undefined && previewStop.lon !== undefined
      ? { id: previewStop.id, name: previewStop.name, lat: previewStop.lat, lon: previewStop.lon }
      : null,
    [previewStop],
  );
  const [highlightedLegId, setHighlightedLegId] = useState<string | null>(null);
  const [focusedStep, setFocusedStep] = useState<WalkStep | null>(null);
  // A new plan starts on its shortest order, with no leg open.
  useEffect(() => {
    setSelectedOrderId(null);
    setOpenLegId(null);
  }, [planVersion]);
  useEffect(() => {
    setHighlightedLegId(null);
    setFocusedStep(null);
  }, [openLegId, selectedOrderId]);

  const order = plan?.orders.find(candidate => candidate.id === selectedOrderId) ?? plan?.orders[0] ?? null;
  const finishClock = order?.totals ? malaysiaDateClock(order.totals.finishTime) : null;
  const finishForecast = finishClock && forecast.days.find(day => day.date === finishClock.date);
  const finishWeather = finishForecast && finishClock ? periodForecast(finishForecast, finishClock.clock) : null;
  const openLeg = order?.legs.find(leg => leg.id === openLegId) ?? null;
  // The map follows the plan while it still describes the outing, and the draft otherwise.
  const shownOrder = plan !== null && !trip.outOfDate ? order : null;
  const mapStops = useMemo(
    () => shownOrder
      ? shownOrder.stopIds.flatMap(id => stopPoints.find(point => point.id === id) ?? [])
      : stopPoints,
    [shownOrder, stopPoints],
  );

  // The 3D view draws one journey. The whole outing is handed to it as one, each leg
  // under its own id, so the itinerary can pick a leg out; an opened leg replaces it and
  // the view moves in to that leg, then back out when it is closed.
  const outingJourney = useMemo(() => shownOrder && outingAsJourney(shownOrder), [shownOrder]);
  const sceneJourney = shownOrder && openLeg ? openLeg.journey : outingJourney;
  const waypoints = useMemo(() => [
    ...mapStops.map((stop, index) => ({ lat: stop.lat, lon: stop.lon, label: `${index + 1}. ${stop.name}` })),
    ...(finalPlace ? [{ lat: finalPlace.lat, lon: finalPlace.lon, label: `Finish: ${finalPlace.name}` }] : []),
    ...(preview ? [{ lat: preview.lat, lon: preview.lon, label: preview.name }] : []),
  ], [mapStops, finalPlace, preview]);

  const missing = [
    !origin && 'a starting point',
    draft.stops.length < MIN_STOPS && `${MIN_STOPS - draft.stops.length} more ${MIN_STOPS - draft.stops.length === 1 ? 'stop' : 'stops'}`,
    finalKind === 'place' && !finalPlace && 'a place to finish',
    finishByInvalid && 'a finish time after departure',
  ].filter((item): item is string => Boolean(item));

  return (
    // The light map throughout: routes and numbered stops are easier to pick out on it
    // than on the night style. `epic7-map` is the scope the 3D view's toolbar rules in
    // index.css are written under; without it "Back to map" sits on top of its neighbour.
    <MapDaylight.Provider value>
    <div className={`epic7-map map-daylight fixed left-0 right-0 top-16 bottom-0 overflow-hidden bg-[#080f18] ${trip.state.status !== 'idle' ? PLAN_OPEN_3D_CONTROLS : ''}`}>
      <div className="absolute inset-0">
        <BaseMap
          origin={origin}
          regions={null}
          journey={sceneJourney}
          highlightedLegId={highlightedLegId}
          focusedStep={focusedStep}
          waypoints={waypoints}
          onMapClick={at => {
            if (!isInStudyArea(at)) {
              setNotice(OUTSIDE_AREA);
              return;
            }
            setNotice(null);
            onOriginChange({ at, source: 'map' });
          }}
        >
          <TripMapLayer
            origin={origin?.at ?? null}
            stops={mapStops}
            final={finalPlace}
            legs={shownOrder && !openLeg ? shownOrder.legs : undefined}
            highlightedLegId={highlightedLegId}
            preview={preview}
            planPanelOpen={trip.state.status !== 'idle'}
          />
          {shownOrder && openLeg && (
            <JourneyMapLayer journey={openLeg.journey} highlightedLegId={highlightedLegId} focusedStep={focusedStep} />
          )}
        </BaseMap>
      </div>

      <aside
        aria-label="Outing"
        className="glass absolute left-2 right-2 top-2 z-[500] max-h-[48%] overflow-y-auto p-4 scrollbar-thin sm:left-4 sm:right-auto sm:top-4 sm:w-[360px] lg:bottom-4 lg:max-h-none"
      >
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Plan an outing</h1>
          {/* On a narrow screen the plan needs the room, so the inputs fold away under it. */}
          {trip.state.status !== 'idle' && (
            <button
              type="button"
              onClick={() => setInputsOpen(open => !open)}
              aria-expanded={inputsOpen}
              aria-controls="outing-inputs"
              className="btn-secondary text-xs lg:hidden"
            >
              {inputsOpen ? 'Hide' : 'Edit outing'}
            </button>
          )}
        </div>
        <div id="outing-inputs" className={inputsOpen ? undefined : 'hidden lg:block'}>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          Choose where you start, when you leave and the places you need to visit.
        </p>

        <section className="mt-4 space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Start</h2>
          <LocationSearch
            onSelect={hit => { setNotice(null); onOriginChange(originFromHit(hit)); }}
            selected={hitFromOrigin(origin)}
            compact
          />
          {origin && <p className="text-xs text-slate-500">Starting from {originName(origin)}</p>}
          {notice && <p role="alert" className="text-xs text-rose-500">{notice}</p>}
        </section>

        <section className="mt-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2" htmlFor="outing-departure">
            Leave · Malaysia time (UTC+8)
          </label>
          <input
            id="outing-departure"
            type="datetime-local"
            value={departure}
            disabled={!supportedDates.length || !onDepartureChange}
            min={`${supportedDates[0]}T00:00`}
            max={`${supportedDates[supportedDates.length - 1]}T23:59`}
            className="glass-input w-full px-3 py-2 text-sm"
            onChange={event => {
              const value = event.target.value;
              if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && supportedDates.includes(value.slice(0, 10)) && event.target.validity.valid) {
                onDepartureChange?.(value);
              }
            }}
          />
          {!supportedDates.length && <p role="alert" className="mt-1 text-xs text-rose-500">The loaded transit timetable does not support the coming week.</p>}
        </section>

        <section className="mt-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2" htmlFor="outing-finish-by">
            Finish by · Malaysia time (optional)
          </label>
          <input
            id="outing-finish-by"
            type="datetime-local"
            value={finishBy}
            min={departure}
            max={supportedDates.length ? `${addDays(supportedDates[supportedDates.length - 1], 1)}T23:59` : undefined}
            aria-invalid={finishByInvalid}
            aria-describedby={finishByInvalid ? 'outing-finish-error' : undefined}
            className="glass-input w-full px-3 py-2 text-sm"
            onChange={event => setFinishBy(event.target.value)}
          />
          {finishByInvalid && <p id="outing-finish-error" role="alert" className="mt-1 text-xs text-rose-500">Choose a finish time after departure.</p>}
          <p className="mt-1 text-xs text-slate-500">The limit includes travel, waiting and every visit.</p>
        </section>

        <section className="mt-4 rounded-xl border border-slate-200/70 bg-white/60 p-3" aria-label="Outing weather">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Weather at departure</h2>
          {departureWeather ? (
            <p className="mt-1 text-xs text-slate-700">{departureWeather.period}: {departureWeather.summary} · {departureForecast?.location}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500" role="status">{forecast.status === 'loading' ? 'Loading official forecast…' : 'Forecast unknown for this departure.'}</p>
          )}
          <p className="mt-1 text-[11px] text-slate-500">MET Malaysia regional outlook, not route-level rain. Weather is advisory and does not alter the route order. {forecast.retrievedAt && `Retrieved ${new Date(forecast.retrievedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })} MYT.`}</p>
          <a href="https://developer.data.gov.my/realtime-api/weather" target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-teal-700 underline">Official forecast source</a>
          {forecast.status === 'error' && <button type="button" onClick={forecast.retry} className="btn-secondary mt-2 text-xs">Retry forecast</button>}
        </section>

        <section className="mt-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Stops · in your order</h2>
            <span className="text-xs text-slate-500">{draft.stops.length} of {MAX_STOPS}</span>
          </div>
          <OutingStopList
            stops={draft.stops}
            onMove={draft.moveStop}
            onRemove={draft.removeStop}
            onVisitMinutesChange={draft.setVisitMinutes}
          />
          {draft.stops.length < MAX_STOPS ? (
            <StopSearch near={searchFrom} addedIds={addedIds} onAdd={draft.addStop} onPreview={setPreviewStop} />
          ) : (
            <p className="text-xs text-slate-500">An outing holds up to {MAX_STOPS} stops. Remove one to add another.</p>
          )}
        </section>

        <fieldset className="mt-4">
          <legend className="text-xs font-bold uppercase tracking-wide text-slate-500">Finish</legend>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Where the outing finishes">
            {FINAL_OPTIONS.map(option => (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={finalKind === option.kind}
                onClick={() => chooseFinal(option.kind)}
                className={`chip ${finalKind === option.kind ? 'chip-selected' : 'chip-unselected'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {finalKind === 'place' && (
            <div className="mt-2 space-y-2">
              {finalPlace && <p className="text-xs text-slate-500">Finishing at {finalPlace.name}</p>}
              <LocationSearch
                onSelect={hit => draft.setFinal({ kind: 'place', point: { id: 'final', name: hitName(hit), ...hitPosition(hit) } })}
                compact
              />
            </div>
          )}
        </fieldset>

        <p role="status" className="mt-4 text-xs text-slate-500">
          {missing.length > 0 ? `Still needed: ${missing.join(', ')}.` : 'This outing is ready to plan.'}
        </p>
        <button
          type="button"
          onClick={() => { setInputsOpen(false); trip.plan(); }}
          disabled={!request || trip.state.status === 'planning'}
          className="btn-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {plan ? 'Replan outing' : 'Plan outing'}
        </button>
        </div>
      </aside>

      {trip.state.status !== 'idle' && (
        <aside
          aria-label="Plan"
          className="glass absolute left-2 right-2 bottom-2 z-[500] max-h-[46%] overflow-y-auto p-4 scrollbar-thin lg:left-auto lg:right-4 lg:top-4 lg:bottom-4 lg:w-[380px] lg:max-h-none"
        >
          {trip.state.status === 'planning' && (
            <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 size={16} className="spinner text-teal-600" aria-hidden="true" />
              {progressLabel(trip.state.progress)}
            </p>
          )}

          {trip.state.status === 'failed' && (
            <div role="alert" className="outing-warning text-sm">
              <p>The outing could not be planned: {trip.state.message}</p>
              <button type="button" onClick={trip.plan} disabled={!request} className="btn-secondary mt-3 text-xs">Try again</button>
            </div>
          )}

          {plan && order && (
            <div className="space-y-4">
              {trip.outOfDate && (
                <div role="status" className="rounded-xl border border-amber-300/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  The outing has changed since this plan was calculated. The times below are for the earlier version.
                  <button type="button" onClick={trip.plan} disabled={!request} className="btn-secondary mt-2 block text-xs disabled:opacity-50">Replan outing</button>
                </div>
              )}

              {openLeg ? (
                <>
                <div>
                  <h2 className="text-sm font-bold">{openLeg.from.name} → {openLeg.to.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Leave {aroundTime(openLeg.journey.startTimeMs ?? openLeg.readyTime)} · arrive {aroundTime(openLeg.arrivalTime)}
                  </p>
                </div>
                <JourneyDetail
                  journey={openLeg.journey}
                  onBack={() => setOpenLegId(null)}
                  backLabel="Whole outing"
                  highlightedLegId={highlightedLegId}
                  onHighlightLeg={setHighlightedLegId}
                  focusedStep={focusedStep}
                  onFocusStep={setFocusedStep}
                />
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold">Your outing</h2>
                  {!plan.orders.some(candidate => candidate.feasible) && (
                    <div role="alert" className="outing-warning text-xs leading-relaxed">
                      <p className="text-sm font-bold">
                        {plan.ordersCalculated === plan.ordersConsidered
                          ? 'No order of these stops can be completed.'
                          : `None of the ${plan.ordersCalculated} closest orders can be completed.`}
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {noPlanReasons(plan).map(reason => <li key={reason}>{reason}</li>)}
                      </ul>
                      <p className="mt-2">
                        Change the departure time, a visit length or the stops, then replan. Everything you entered is still there.
                      </p>
                      <button type="button" onClick={() => setInputsOpen(true)} className="btn-secondary mt-2 text-xs lg:hidden">Edit outing</button>
                    </div>
                  )}
                  <OrderComparison plan={plan} selectedId={order.id} onSelect={setSelectedOrderId} />
                  {/* An order that cannot be completed has a timeline to explain it, not a result. */}
                  {order.feasible && order.totals && <TripSummary totals={order.totals} />}
                  {order.totals && (
                    <div className="rounded-xl border border-slate-200/70 bg-white/60 p-3 text-xs text-slate-700">
                      <h3 className="font-bold">Weather during this outing</h3>
                      <p className="mt-1">Departure: {departureWeather ? `${departureWeather.period} · ${departureWeather.summary}` : 'Forecast unknown'}</p>
                      <p className="mt-1">Finish: {finishWeather ? `${finishWeather.period} · ${finishWeather.summary}` : 'Forecast unknown'}</p>
                      <p className="mt-1 text-[11px] text-slate-500">MET Malaysia regional outlook; it does not predict rain on a specific route or change the order.</p>
                    </div>
                  )}
                  <ItineraryTimeline plan={plan} order={order} onOpenLeg={setOpenLegId} onHighlightLeg={setHighlightedLegId} />
                  <details className="planning-disclosure">
                    <summary>How these times are estimated</summary>
                    <p>
                      Journeys are modelled from published timetables and frequencies, with walking on
                      OpenStreetMap paths. Every time is an estimate, not a scheduled departure. Opening
                      hours come from OpenStreetMap and may be out of date; confirm with the place.
                      The planner compares orders by rules, not AI: it checks routed travel,
                      visit lengths, known opening hours and your finish-by time. For four or
                      five stops it estimates all orders, then recalculates the closest few
                      at each leg's actual modelled departure time.
                    </p>
                  </details>
                </>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
    </MapDaylight.Provider>
  );
}
