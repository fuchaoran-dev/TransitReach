import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, Crosshair, Minimize2, X } from 'lucide-react';
import { Tooltip } from '@/shared/ui';
import {
  BaseMap,
  LocationSearch,
  TimeBudgetSelector,
  useReachability,
} from '@/features/reachability';

import {
  formatCoord,
  nearestAreaName,
  STUDY_AREA_BUFFER_KM,
  BUDGET_COMPONENTS,
  BUDGET_ASSUMPTIONS,
  hitFromOrigin,
} from '@/features/reachability/reachabilityService';
import type { Journey } from '@/features/reachability/types';
import { linesForStop, loadRailFeedMetadata } from '@/shared/data/adapters/gtfsAdapter';

// Epic3
import {
  FirstMileMapLayer,
  LiveTransitMapLayer,
  LiveTransitStatus,
  SelectedRailLineLayer,
  SelectedLineReachabilityLayer,
  BusStopMapLayer,
  busStopsNearAccessibleStations,
  mapBusStopById,
  useFirstMile,
  useLiveTransit,
  useSelectedLineReachability,
  DEFAULT_FIRST_MILE_THRESHOLD_MINUTES,
  type FirstMileStopResult,
  type BusStop,
} from '@/features/first-mile';
import {
  loadReliabilityServices,
  type ReliabilityService,
} from '@/features/transit-reliability';
import { originFromHit } from '@/features/reachability/reachabilityService';

import {MapAnalysisPanel,type MapAnalysisTab,} from './components/MapAnalysisPanel';
import { useMapServices } from './components/useMapServices';
import { JourneyLegend, JourneyMapLayer, JourneyPreviewLayer, useJourneyInspection } from '@/features/interchange';
import type { ServiceLocation } from '@/shared/types/service';
import { MapDaylight, malaysiaToday, addDays, periodForecast, forecastCode, useWeatherForecast, weatherKind, WeatherPlanningBar } from './components/WeatherPlanning';
import { compareCoverage, DepartureComparisonLayer, DepartureComparisonSummary } from './components/DepartureComparison';
import { WeatherAtmosphere } from './components/WeatherAtmosphere';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';

/** One shared empty array, so "no stops yet" keeps a stable identity between renders. */
const NO_STOPS: FirstMileStopResult[] = [];

interface MapPageProps {
  journey: Journey;
  onToast: (message: string, icon?: string) => void;
  /** Which analysis tab is open. Controlled, so the navigation can open one directly. */
  analysisTab: MapAnalysisTab;
  onAnalysisTabChange: (tab: MapAnalysisTab) => void;
}

export function MapPage({ journey, onToast, analysisTab, onAnalysisTabChange }: MapPageProps) {
  const [localDeparture, setLocalDeparture] = useState(() => `${malaysiaToday()}T09:00`);
  const departure = journey.departure ?? localDeparture;
  const [today, setToday] = useState(malaysiaToday);
  useEffect(() => {
    const timer = setInterval(() => setToday(malaysiaToday()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const setDeparture = (next: string | ((previous: string) => string)) => {
    const value = typeof next === 'function' ? next(departure) : next;
    if (journey.onDepartureChange) journey.onDepartureChange(value); else setLocalDeparture(value);
  };
  const supportedDates = useMemo(() => {
    const feed = loadRailFeedMetadata().feeds[0];
    const iso = (value: string) => value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    return Array.from({ length: 7 }, (_, index) => addDays(today, index)).filter(date => feed && date >= iso(feed.serviceDateRange.start) && date <= iso(feed.serviceDateRange.end));
  }, [today]);
  const [comparison, setComparison] = useState<{ departure: string; area: number; budget: number; regions: IsochroneRegion[]; weather: string } | null>(null);
  const forecast = useWeatherForecast();
  const selectedWeather = forecast.days.find(day => day.date === departure.slice(0, 10));
  const weatherPeriod = selectedWeather ? periodForecast(selectedWeather, departure.slice(11)) : null;
  const condition = weatherPeriod ? weatherKind(forecastCode(weatherPeriod.summary)) : 'neutral';
  const daylight = Number(departure.slice(11, 13)) >= 7 && Number(departure.slice(11, 13)) < 19;
  const departureTime = `${departure}:00+08:00`;
  const [configOpen, setConfigOpen] = useState(true);
  const originLabel = journey.origin?.place?.name ?? journey.origin?.stop?.name ?? journey.origin?.busStop?.name ?? 'Starting point';
  const departureLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(departureTime));
  useEffect(() => {
    if (journey.origin) setConfigOpen(false);
    else setConfigOpen(true);
  }, [journey.origin]);
  const [selectedBusStop, setSelectedBusStop] = useState<BusStop | null>(null);
  const [reliabilityServices, setReliabilityServices] = useState<ReliabilityService[]>([]);
  const [reliabilityLoading, setReliabilityLoading] = useState(true);
  const [reliabilityError, setReliabilityError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadReliabilityServices(controller.signal)
      .then(setReliabilityServices)
      .catch(reason => {
        if (!controller.signal.aborted) {
          setReliabilityError(reason instanceof Error ? reason.message : 'Reliability service unavailable');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setReliabilityLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (journey.origin?.busStop) setSelectedBusStop(journey.origin.busStop);
  }, [journey.origin?.busStop]);
const reach = useReachability({
  departureTime,
  origin: supportedDates.includes(departure.slice(0, 10)) ? journey.origin : null,
  onOriginChange: journey.onOriginChange,
  timeBudget: journey.timeBudget,
  onTimeBudgetChange: journey.onTimeBudgetChange,
  onToast,
});
  useEffect(() => setComparison(null), [journey.origin, journey.timeBudget]);
  const coverageComparison = useMemo(() => {
    if (!comparison || reach.state.status !== 'ready') return null;
    try { return compareCoverage(comparison.regions, reach.state.result.regions); } catch { return null; }
  }, [comparison, reach.state]);

const [selectedRouteId, setSelectedRouteId] =
  useState<string | null>(null);

const firstMile = useFirstMile(
  reach.origin?.at ?? null,
  DEFAULT_FIRST_MILE_THRESHOLD_MINUTES,
);

const accessibleStops = useMemo(
  () =>
    firstMile.state.status === 'ready'
      ? firstMile.state.stops
      : NO_STOPS,
  [firstMile.state],
);

const selectedStation =
  firstMile.state.status === 'ready' &&
  firstMile.selectedStopId
    ? firstMile.state.stops.find(
        result =>
          result.stop.stopId ===
          firstMile.selectedStopId,
      ) ?? null
    : null;

const selectedRailLine =
  selectedStation
    ? selectedStation.lines.find(
        line =>
          line.routeId ===
          selectedRouteId,
      ) ?? null
    : null;

/*
 * Reachability for an explicitly selected line. Unlike the old station-based
 * secondary isochrone, this calculation only allows the selected Rail/BRT line,
 * then adds a practical walking egress from downstream stations.
 */
const mainReachabilityRegions = useMemo(
  () =>
    reach.state.status === 'ready'
      ? reach.state.result.regions
      : [],
  [reach.state],
);

const selectedLineReachability =
  useSelectedLineReachability(
    selectedStation,
    selectedRailLine,
    journey.timeBudget,
    mainReachabilityRegions,
    departureTime,
  );

const handleSelectStop = (
  stopId: string | null,
) => {
  setSelectedRouteId(null);
  firstMile.setSelectedStopId(stopId);
};

/*
 * If useFirstMile clears the selected station
 * because the origin changes, clear the rail too.
 */
useEffect(() => {
  if (!selectedStation) {
    setSelectedRouteId(null);
  }
}, [selectedStation]);

  const liveTransit =
    useLiveTransit(
      accessibleStops,
      firstMile.state.status ===
        'ready',
    );
  const nearbyBusStops = useMemo(() => {
    const reachableRegions =
      reach.state.status === 'ready'
        ? reach.state.result.regions
        : [];

    return busStopsNearAccessibleStations(
      accessibleStops,
      reachableRegions,
    );
  }, [
    accessibleStops,
    reach.state,
  ]);
  const displayedBusStops = useMemo(() => {
    // First-mile's bus stops are the same Rapid KL stops this layer draws, so they join
    // it: close in they appear as the map's own bus stops, delay popup included, rather
    // than as a second marker on the same pole.
    const stops = new Map(nearbyBusStops.map(stop => [stop.stopId, stop]));
    if (firstMile.state.status === 'ready') {
      for (const result of firstMile.state.busStops) {
        const mapStop = mapBusStopById(result.stop.stopId);
        if (mapStop && !stops.has(mapStop.stopId)) stops.set(mapStop.stopId, mapStop);
      }
    }
    if (selectedBusStop && !stops.has(selectedBusStop.stopId)) {
      stops.set(selectedBusStop.stopId, selectedBusStop);
    }
    return [...stops.values()];
  }, [nearbyBusStops, selectedBusStop, firstMile.state]);

  const services = useMapServices(
    reach.origin?.at ?? null,
    journey.timeBudget,
    analysisTab === 'services' || analysisTab === 'transfers',
    departureTime,
  );

  const journeyInspection = useJourneyInspection(
    reach.origin?.at ?? null,
    services.selected,
    journey.timeBudget,
    analysisTab === 'transfers',
    departureTime,
  );

  /**
   * What the map shows of the journeys, if anything. 'detail' is one opened journey;
   * 'preview' is the list, every journey drawn faintly with the pointed-at one in full.
   * Either way the map is about the journeys, so the other layers step aside.
   */
  const journeyView: 'detail' | 'preview' | null =
    journeyInspection.selectedJourney !== null
      ? 'detail'
      : analysisTab === 'transfers' &&
          journeyInspection.status === 'ready' &&
          journeyInspection.journeys.length > 0
        ? 'preview'
        : null;
  const inspectingJourney = journeyView !== null;

  const handleServiceSelect = (service: ServiceLocation) => {
    // Selecting a service keeps the user in the Services tab. The map focuses the
    // selected service and the detail card below provides the explicit Journey action.
    services.select(service);
    onAnalysisTabChange('services');
  };

  const handleJourneyForService = (service: ServiceLocation) => {
    services.select(service);
    onAnalysisTabChange('transfers');
  };

  return (
    // top-16 rather than pt-16: an absolutely positioned child resolves inset-0 against
    // the padding box, so padding here would let the map slide under the navbar.
    <MapDaylight.Provider value={daylight}>
    <div className={`epic7-map weather-${condition} ${daylight ? 'map-daylight' : 'map-night'} fixed left-0 right-0 bottom-0 top-16 overflow-hidden`}>
      <WeatherPlanningBar forecast={forecast} clock={departure.slice(11)} supportedDates={supportedDates} date={departure.slice(0, 10)} onDateChange={date => setDeparture(previous => `${date}T${previous.slice(11)}`)} />
      <WeatherAtmosphere />
      <div className="absolute inset-0">
          <BaseMap
            journey={journeyInspection.selectedJourney ?? journeyInspection.journeys.find(option => option.id === journeyInspection.highlightedJourneyId) ?? (analysisTab === 'transfers' ? journeyInspection.journeys[0] : null)}
            highlightedLegId={journeyInspection.highlightedLegId}
            focusedStep={journeyInspection.focusedStep}
            origin={reach.origin}
            coverage={inspectingJourney ? null : coverageComparison}
            regions={
              inspectingJourney || coverageComparison
                ? null
                : reach.state.status === 'ready'
                  ? reach.state.result.regions
                  : null
            }
            onMapClick={point => {
              setSelectedBusStop(null);
              reach.selectPoint(point);
            }}
            services={inspectingJourney ? [] : services.displayed}
            selectedServiceId={
              services.selected?.id ?? null
            }
            selectedService={services.selected}
            onServiceSelect={handleServiceSelect}
          >
            {!inspectingJourney && coverageComparison && <DepartureComparisonLayer coverage={coverageComparison} />}
            {journeyView === 'detail' && services.selected ? (
              <JourneyMapLayer
                journey={journeyInspection.selectedJourney!}
                destination={services.selected}
                highlightedLegId={journeyInspection.highlightedLegId}
                focusedStep={journeyInspection.focusedStep}
              />
            ) : journeyView === 'preview' && services.selected ? (
              <JourneyPreviewLayer
                journeys={journeyInspection.journeys}
                destination={services.selected}
                highlightedJourneyId={journeyInspection.highlightedJourneyId}
                onHighlight={journeyInspection.highlightJourney}
                onSelect={journeyInspection.selectJourney}
              />
            ) : (
              <>
                {selectedLineReachability.status === 'ready' &&
                  selectedLineReachability.regions.length > 0 && (
                    <SelectedLineReachabilityLayer
                      regions={selectedLineReachability.regions}
                      color={selectedRailLine?.color ?? null}
                    />
                  )}

                <SelectedRailLineLayer
                  routeId={selectedRailLine?.routeId ?? null}
                  color={selectedRailLine?.color ?? null}
                />

                {firstMile.state.status === 'ready' && (
                  <FirstMileMapLayer
                    stops={firstMile.state.stops}
                    busStops={firstMile.state.busStops}
                    selectedStopId={firstMile.selectedStopId}
                    onSelect={handleSelectStop}
                  />
                )}

                {displayedBusStops.length > 0 && (
                  <BusStopMapLayer
                    stops={displayedBusStops}
                    selectedStopId={selectedBusStop?.stopId ?? null}
                    onSelect={setSelectedBusStop}
                    reliabilityServices={reliabilityServices}
                    reliabilityLoading={reliabilityLoading}
                    reliabilityError={reliabilityError}
                  />
                )}

                {liveTransit.status !== 'idle' && (
                  <LiveTransitMapLayer
                    vehicles={liveTransit.vehicles}
                  />
                )}
              </>
            )}
          </BaseMap>
        {!inspectingJourney && (
          <div className="map-live-status">
          <LiveTransitStatus
            state={liveTransit}
          />
          </div>
        )}
        {inspectingJourney && (
          <details className="map-legend-disclosure absolute left-4 bottom-6 z-[550] glass"><summary>Route legend</summary><JourneyLegend /></details>
        )}
      </div>

      <MapAnalysisPanel
        departureTime={departureTime}
        reachState={reach.state}

        firstMileState={
          firstMile.state
        }

        selectedRouteId={
          selectedRouteId
        }

        onSelectRoute={
          setSelectedRouteId
        }

        walkThresholdMinutes={
          DEFAULT_FIRST_MILE_THRESHOLD_MINUTES
        }

        selectedStopId={
          firstMile.selectedStopId
        }

        onSelectStop={
          handleSelectStop
        }

        onRetryReachability={
          reach.retry
        }

        services={services}

        journeys={journeyInspection}

        onServiceSelect={handleServiceSelect}

        onJourneyForService={handleJourneyForService}

        hasOrigin={
          Boolean(reach.origin)
        }

        activeTab={
          analysisTab
        }

        onTabChange={
          onAnalysisTabChange
        }
      />

      {/* The budget composition note makes the panel tall enough to overflow a short
          viewport, so it scrolls internally rather than running off the bottom — the
          note has to stay reachable to satisfy AC 1.2.3. */}
      <div data-expanded={configOpen} className="map-config-panel absolute top-4 left-4 sm:left-6 z-[500] w-[340px] max-w-[calc(100vw-2rem)] max-h-[calc(100%-2rem)] transition-all duration-300 ease-out">
        {/* Collapsed, the panel is 48px wide. p-4 would leave 16px of content box for a
            32px button, pushing it off-centre and out of the rounded corner; p-2 leaves
            exactly 32px. The header margin goes too, since nothing follows it. */}
        <div className={`glass max-h-[calc(100vh-6rem)] overflow-y-auto overflow-x-hidden scrollbar-thin ${configOpen ? 'p-4' : 'p-2'}`}>
          <div className={`flex items-center ${configOpen ? 'justify-between mb-3' : 'justify-center'}`}>
            {configOpen ? <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Starting Point</h2> : <div className="map-origin-summary"><strong title={originLabel}>{originLabel}</strong><span>{departureLabel} · {journey.timeBudget} min</span></div>}
            <Tooltip content={configOpen ? 'Collapse' : 'Expand'}>
              {/* The tooltip is visual only, so the button needs its own name — without
                  one a screen reader announces nothing but "button". */}
              <button
                onClick={() => setConfigOpen(prev => !prev)}
                aria-label={configOpen ? 'Collapse starting point panel' : 'Expand starting point panel'}
                aria-expanded={configOpen}
                className={`${configOpen ? 'btn-icon' : 'btn-secondary text-xs'} shrink-0`}
                style={configOpen ? { width: 32, height: 32 } : undefined}
              >
                {configOpen ? <Minimize2 size={16} /> : 'Edit'}
              </button>
            </Tooltip>
          </div>

          {configOpen && (
            <div className="space-y-4 fade-in">
              <LocationSearch
                onSelect={hit => {
                  if (hit.kind === 'stop') {
                    setSelectedBusStop(null);
                    reach.selectStop(hit.stop);
                  } else if (hit.kind === 'place') {
                    setSelectedBusStop(null);
                    reach.selectPlace(hit.place);
                  }
                  else {
                    setSelectedBusStop(hit.busStop);
                    journey.onOriginChange(originFromHit(hit));
                  }
                }}
                selected={hitFromOrigin(reach.origin)}
                compact
              />

              <div className="flex items-center gap-2">
                {/* AC 1.1.4 — the permission is requested on this tap and nowhere else. */}
                <button
                  onClick={reach.requestDeviceLocation}
                  className="btn-secondary inline-flex items-center gap-2 text-xs py-2 px-3"
                >
                  <Crosshair size={14} />
                  Use my location
                </button>
                {reach.origin && (
                  <button
                  onClick={() => {
                    setSelectedBusStop(null);
                    reach.clearOrigin();
                  }}
                    className="btn-secondary inline-flex items-center gap-1.5 text-xs py-2 px-3"
                  >
                    <X size={14} />
                    Clear
                  </button>
                )}
              </div>

              {reach.origin && <OriginReadout origin={reach.origin} />}

              {!reach.origin && (
                <p className="text-xs text-slate-500 leading-relaxed">
                  Search by station or stop name, or tap the map to choose a starting point.
                </p>
              )}

              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <label className="text-xs font-semibold text-slate-500">Time Budget</label>
                  <BudgetCompositionHelp />
                </div>
                <TimeBudgetSelector value={reach.timeBudget} onChange={reach.changeTimeBudget} />
              </div>

              <div className="pt-2 border-t border-slate-200/70">
                <label className="block text-xs font-semibold text-slate-500 mb-2" htmlFor="departure-time">Departure · Malaysia time (UTC+8)</label>
                <input id="departure-time" type="datetime-local" value={departure} disabled={!supportedDates.length} min={`${supportedDates[0]}T00:00`} max={`${supportedDates[supportedDates.length - 1]}T23:59`} className="input w-full" onChange={event => { if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(event.target.value) && supportedDates.includes(event.target.value.slice(0, 10)) && event.target.validity.valid) setDeparture(event.target.value); }} />
                {!supportedDates.length && <p role="alert">The loaded transit timetable does not support the coming week.</p>}
                <div className="departure-presets" aria-label="Departure time presets">{['09:00', '13:00', '18:00', '20:00'].map(clock => <button key={clock} disabled={!supportedDates.includes(departure.slice(0, 10))} aria-pressed={departure.slice(11) === clock} onClick={() => setDeparture(previous => `${previous.slice(0, 10)}T${clock}`)}>{clock}</button>)}</div>
                <p className="weather-context-chip">{weatherPeriod ? `${weatherPeriod.period} · ${condition === 'sunny' ? 'No rain forecast' : condition === 'storm' ? 'Thunderstorms' : condition === 'rainy' ? 'Rain expected' : 'Cloudy'}` : 'Weather unknown'}</p>
                <details className="planning-disclosure"><summary>Forecast & routing notes</summary><p>Scheduled GTFS / OSM estimates, not live arrivals. {weatherPeriod?.summary} · MET Malaysia, Kuala Lumpur district. Regional outlook only; check conditions before leaving.</p></details>
                {reach.state.status === 'ready' && <details className="departure-comparison planning-disclosure"><summary>Compare departure times</summary>
                  <button className="btn-secondary text-xs" onClick={() => { if (reach.state.status === 'ready') setComparison({ departure, area: reach.state.result.areaKm2, budget: reach.state.budgetMinutes, regions: reach.state.result.regions, weather: weatherPeriod ? `${weatherPeriod.period}: ${weatherPeriod.summary}` : 'Weather unknown' }); }}>Use this departure as baseline</button>
                  {comparison && <p role="status" className="text-xs text-slate-500 mt-2">Baseline {comparison.departure.replace('T', ' ')} · {comparison.budget} min: {comparison.area.toFixed(1)} km².<br />Current area: {(reach.state.result.areaKm2 - comparison.area).toFixed(1)} km² change. Same origin and travel budget.</p>}
                  {comparison && <><p className="text-xs text-slate-500 mt-2">Baseline weather: {comparison.weather}. More area does not necessarily mean less walking or more open destinations.</p><button className="btn-secondary text-xs mt-2" onClick={() => setComparison(null)}>Clear comparison</button></>}
                  {coverageComparison && <DepartureComparisonSummary coverage={coverageComparison} />}
                </details>}
              </div>
              <div className="pt-2 border-t border-slate-200/70">
                <CoveredAreaNote />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </MapDaylight.Provider>
  );
}

/**
 * AC 1.1.2 — a map-selected point shows its coordinate to 5 decimal places. A stop shows
 * the exact feed name and the lines serving it. No walking distance, walking time or
 * nearest stop is produced here; those belong to the First-Mile Walking Access epic.
 */
function OriginReadout({ origin }: { origin: NonNullable<ReturnType<typeof useReachability>['origin']> }) {
  const label =
    origin.source === 'stop' ? 'Selected rail station'
    : origin.source === 'bus-stop' ? 'Selected bus stop'
    : origin.source === 'place' ? 'Selected place'
    : origin.source === 'device' ? 'Your location'
    : 'Selected point';
  const areaName = useMemo(
    () => (origin.stop || origin.busStop || origin.place ? null : nearestAreaName(origin.at)),
    [origin],
  );

  return (
    <div className="glass-chip rounded-xl px-3 py-2.5">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      {origin.busStop ? (
        <>
          <div className="text-sm font-semibold text-slate-800">{origin.busStop.name}</div>
          <div className="text-xs text-slate-500">Rapid KL bus stop · click its map marker for AI delay</div>
        </>
      ) : origin.stop ? (
        <>
          <div className="text-sm font-semibold text-slate-800">{origin.stop.name}</div>
          <div className="text-xs text-slate-500">
            {linesForStop(origin.stop).map(line => line.longName).join(' · ')}
          </div>
        </>
      ) : origin.place ? (
        <>
          <div className="text-sm font-semibold text-slate-800">{origin.place.name}</div>
          {/* The coordinate is still shown: a place is a single point standing for
              something with area, and the reachable area is computed from that point. */}
          <div className="text-xs text-slate-500">
            {origin.place.kindLabel} · <span className="font-mono">{formatCoord(origin.at)}</span>
          </div>
        </>
      ) : (
        <>
          {areaName && <div className="text-sm font-semibold text-slate-800">Near {areaName}</div>}
          <div className={areaName ? 'text-xs font-mono text-slate-500' : 'text-sm font-mono text-slate-700'}>
            {formatCoord(origin.at)}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * AC 1.2.3 — what the travel time budget is spent on.
 *
 * A help control beside the Time Budget label, not a dropdown. This is reference
 * information about a value the user has already chosen, not a second choice to make, so
 * a disclosure that occupies permanent panel space overstates it. The criterion is
 * triggered by the user "viewing how the travel time was arrived at", which this
 * satisfies exactly as the previous disclosure did — everything it must state is still
 * here, and no component is dropped for being unmodelled.
 *
 * Deliberately mirrors DataBasisHelp in MapAnalysisPanel: same icon, same trigger
 * behaviour (hover on desktop, focus for keyboard, click for touch), same panel styling,
 * so the two read as one system.
 *
 * The one difference is `fixed` rather than `absolute` positioning. The configuration
 * panel is an `overflow-y-auto overflow-x-hidden` scroll container, so an absolutely
 * positioned child would be clipped at its edges instead of overflowing them. Anchoring
 * to the trigger's viewport rect escapes the clip, and keeps the panel on screen on a
 * narrow viewport where there is no room to its right.
 *
 * The wording is deliberately a rider's, not the project's: what counts against the
 * budget and what is missing from it, with no epic names or internal owners.
 */
const PANEL_WIDTH = 300;
const PANEL_GAP = 10;
const PANEL_MARGIN = 8;
/** Enough of the panel to be worth opening; below this it is shifted up instead. */
const PANEL_MIN_VISIBLE = 220;
/**
 * Grace period before a hover-opened panel closes.
 *
 * The panel is portaled to document.body, so it is not a DOM descendant of the trigger:
 * leaving the trigger fires mouseleave even when the pointer is on its way to the panel,
 * and there is a deliberate gap between the two. Without this delay the panel disappears
 * from under the pointer and can never be reached to read or scroll.
 */
const HOVER_CLOSE_DELAY_MS = 180;

function BudgetCompositionHelp() {
  // Open is derived from three independent inputs rather than being a single flag that
  // each handler sets. With one flag, a mouse user who hovers (opening it) and then
  // clicks would have the click *toggle it shut* — the pointer enters before the click
  // lands, so the two fight each other. Deriving it means a click can only ever pin the
  // panel open, and hover, focus and pin cannot contradict one another.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  /** Escape hides the panel while the pointer or focus is still on the trigger. */
  const [dismissed, setDismissed] = useState(false);

  const open = !dismissed && (hovered || focused || pinned);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();

    // documentElement.clientWidth, not window.innerWidth: innerWidth includes the
    // scrollbar gutter, so clamping against it leaves the panel hanging over the edge on
    // a narrow viewport.
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;

    // Prefer clear of the configuration panel, to the right of the trigger. On a narrow
    // viewport there is no such room, so clamp inside the right edge instead.
    let left = rect.right + PANEL_GAP;
    if (left + PANEL_WIDTH > viewportW - PANEL_MARGIN) {
      left = Math.max(PANEL_MARGIN, viewportW - PANEL_WIDTH - PANEL_MARGIN);
    }

    const top = Math.max(
      PANEL_MARGIN,
      Math.min(rect.top, viewportH - PANEL_MARGIN - PANEL_MIN_VISIBLE),
    );
    setPos({ top, left, maxHeight: viewportH - top - PANEL_MARGIN });
  }, []);

  /**
   * Corrects the placement against the panel's real rendered box.
   *
   * The first pass positions from the trigger and an assumed panel width. This one
   * measures what actually rendered and nudges it back inside the viewport if anything —
   * a wider-than-expected panel, a scrollbar, a mid-animation layout — put it over an
   * edge. It converges in one step: after the nudge the box is inside, so the guard below
   * stops it re-running.
   */
  useLayoutEffect(() => {
    if (!open || !pos) return;
    const panel = panelRef.current;
    if (!panel) return;

    const box = panel.getBoundingClientRect();
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;

    let dx = 0;
    let dy = 0;
    if (box.right > viewportW - PANEL_MARGIN) dx = viewportW - PANEL_MARGIN - box.right;
    if (box.left + dx < PANEL_MARGIN) dx = PANEL_MARGIN - box.left;
    if (box.bottom > viewportH - PANEL_MARGIN) dy = viewportH - PANEL_MARGIN - box.bottom;
    if (box.top + dy < PANEL_MARGIN) dy = PANEL_MARGIN - box.top;

    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setPos(current => current && { ...current, left: current.left + dx, top: current.top + dy });
    }
  }, [open, pos]);

  // Position before paint, so the panel never appears at a stale location first.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    // Capture phase: the configuration panel scrolls internally, and that scroll does not
    // bubble. Without this the panel would detach from its trigger.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Hover intent. `pointerEnter` cancels any pending close, so crossing the gap between
  // the trigger and the panel keeps it up instead of dismissing it mid-travel.
  const closeTimer = useRef<number | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const pointerEnter = useCallback(() => {
    cancelClose();
    setHovered(true);
    setDismissed(false);
  }, [cancelClose]);
  const pointerLeave = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setHovered(false);
      setPinned(false);
      setDismissed(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={pointerEnter}
      onMouseLeave={pointerLeave}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="How this travel time is calculated"
        aria-expanded={open}
        // Pins the panel open. On a touch device there is no hover, so this is the only
        // way in; with a mouse it keeps the panel up after the pointer moves away.
        onClick={() => { setPinned(value => !value); setDismissed(false); }}
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onBlur={() => { setFocused(false); setPinned(false); setDismissed(false); }}
        className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-teal-600 transition"
      >
        <CircleHelp size={14} />
      </button>

      {/*
        Rendered through a portal into document.body, and this is load-bearing rather than
        tidiness.

        The configuration panel carries `.glass`, whose `backdrop-filter` makes it a
        containing block for `position: fixed` descendants. Rendered in place, the panel
        would therefore position against that box instead of the viewport, and then be
        clipped by its `overflow-y-auto overflow-x-hidden` — the content is there, but cut
        off and unreadable. A portal escapes both the containing block and the clip, so
        `fixed` means what it says and the placement maths below is against the viewport.
      */}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="tooltip"
          // The panel is outside the trigger's wrapper in the DOM now, so it has to keep
          // itself open while the pointer is over it.
          onMouseEnter={pointerEnter}
          onMouseLeave={pointerLeave}
          className="fixed z-[1000] rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur-xl p-3.5 overflow-y-auto scrollbar-thin"
          style={{
            top: pos.top,
            left: pos.left,
            maxHeight: pos.maxHeight,
            // Never wider than the viewport allows, so a 320px phone still fits it.
            width: `min(${PANEL_WIDTH}px, calc(100vw - ${PANEL_MARGIN * 2}px))`,
          }}
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-2.5">
            How this travel time is calculated
          </div>

          <ul className="space-y-1.5">
            {BUDGET_COMPONENTS.map(component => (
              <li key={component.label} className="text-[11px] leading-snug">
                <span className="font-semibold text-slate-700">{component.label}</span>
                {component.estimate && (
                  <span className="ml-1.5 px-1 py-px rounded bg-amber-100 text-amber-800 font-semibold text-[10px] uppercase tracking-wide">
                    Not counted
                  </span>
                )}
                <div className="text-slate-500">{component.status}</div>
              </li>
            ))}
          </ul>

          <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
            {BUDGET_ASSUMPTIONS.map(assumption => (
              <div key={assumption.label} className="text-[11px] leading-snug">
                <span className="font-semibold text-slate-700">{assumption.label}:</span>{' '}
                <span className="text-slate-500">{assumption.status}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * What "covered area" means — the bound a map click is rejected against.
 *
 * The study-area boundary is not yet agreed: it depends on the extent of the bus feed,
 * which is not loaded. Rather than invent a boundary, it is derived from the rail network
 * actually loaded, and that basis is stated here so the reader can see what the limit is.
 *
 * Lives inside the configuration panel rather than floating over the map. As a separate
 * bottom-left box it collided with the panel above it once the travel-time disclosure was
 * expanded — two independently positioned overlays sharing one column will always be one
 * content change away from overlapping. Keeping it in the panel's flow removes the class
 * of bug rather than re-tuning heights.
 */
function CoveredAreaNote() {
  return (
    <details className="planning-disclosure"><summary>Coverage details</summary><p className="text-[11px] text-slate-500 leading-relaxed">
      <span className="font-semibold text-slate-600">Covered area</span> is the extent of the
      loaded rail network plus {STUDY_AREA_BUFFER_KM} km. This is provisional — the boundary
      depends on the bus feed, which is not yet loaded.
    </p></details>
  );
}
