import { useState, useEffect } from 'react';

import {ChevronDown, Crosshair, Maximize2, Minimize2, X,} from 'lucide-react';import { Tooltip } from '@/shared/ui';
import {
  BaseMap,
  LocationSearch,
  TimeBudgetSelector,
  useReachability,
  type RailStop,
  type ReachabilityState,
} from '@/features/reachability';

import {
  formatCoord,
  STUDY_AREA_BUFFER_KM,
  BUDGET_COMPONENTS,
  BUDGET_ASSUMPTIONS,
} from '@/features/reachability/reachabilityService';

import { linesForStop } from '@/shared/data/adapters/gtfsAdapter';

// Epic3
import {
  FirstMileMapLayer,
  NearbyStopsPanel,
  LiveTransitMapLayer,
  LiveTransitStatus,
  StationReachabilityLayer,
  SelectedRailLineLayer,
  BusStopMapLayer,
  busStopsNearAccessibleStations,
  useFirstMile,
  useLiveTransit,
  useStationReachability
} from '@/features/first-mile';

import {MapAnalysisPanel,type MapAnalysisTab,} from './components/MapAnalysisPanel';


interface MapPageProps {
  initialLocation: RailStop | null;
  onToast: (message: string, icon?: string) => void;
}

export function MapPage({ initialLocation, onToast }: MapPageProps) {
  const [configOpen, setConfigOpen] = useState(true);
  const reach = useReachability(initialLocation, onToast);
  const [selectedRouteId,setSelectedRouteId] = useState<string | null>(null);
  const firstMile = useFirstMile(reach.origin?.at ?? null, reach.timeBudget,);
  const selectedStation =
    firstMile.state.status ===
      'ready' &&
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
  useEffect(() => {
    if (!selectedStation) {
      setSelectedRouteId(
        null,
      );

      return;
    }

    const currentlyValid =
      selectedStation.lines.some(
        line =>
          line.routeId ===
          selectedRouteId,
      );

    if (currentlyValid) {
      return;
    }

    /*
    * If there is only one line,
    * automatically show it when
    * the station is selected.
    */
    if (
      selectedStation
        .lines.length === 1
    ) {
      setSelectedRouteId(
        selectedStation
          .lines[0]
          .routeId,
      );

      return;
    }

    /*
    * Interchange station:
    * user must choose which line.
    */
    setSelectedRouteId(
      null,
    );
  }, [
    selectedStation,
    selectedRouteId,
  ]);

  const stationOrigin =
    selectedStation
      ? {
          lat:
            selectedStation
              .stop.lat,

          lon:
            selectedStation
              .stop.lon,
        }
      : null;

  const walkingMinutes =
  selectedStation
    ? Math.ceil(
        selectedStation.route.durationSeconds / 60,
      )
    : 0;

  const remainingBudget =
    Math.max(
      0,
      reach.timeBudget - walkingMinutes,
    );
  const stationReachability =
    useStationReachability(
      remainingBudget > 0
        ? stationOrigin
        : null,
      remainingBudget,
    );

  const accessibleStops =
  firstMile.state.status ===
  'ready'
    ? firstMile.state.stops
    : [];

  const liveTransit =
    useLiveTransit(
      accessibleStops,
      firstMile.state.status ===
        'ready',
    );
  const reachableRegions =
  reach.state.status ===
  'ready'
    ? reach.state.result.regions
    : [];

  const nearbyBusStops =
    busStopsNearAccessibleStations(
      accessibleStops,
      reachableRegions,
    );
  const [analysisTab, setAnalysisTab,] = useState<MapAnalysisTab>('first-mile');

  return (
    // top-16 rather than pt-16: an absolutely positioned child resolves inset-0 against
    // the padding box, so padding here would let the map slide under the navbar.
    <div className="fixed left-0 right-0 bottom-0 top-16 overflow-hidden">
      <div className="absolute inset-0">
        <BaseMap
          origin={reach.origin}
          regions={
            reach.state.status ===
            'ready'
              ? reach.state
                  .result.regions
              : null
          }
          onMapClick={
            reach.selectPoint
          }
        >
          {stationReachability.status ===
            'ready' && (
            <StationReachabilityLayer
              regions={
                stationReachability
                  .regions
              }
            />
          )}
          <SelectedRailLineLayer
            routeId={
              selectedRailLine
                ?.routeId ??
              null
            }
            color={
              selectedRailLine
                ?.color ??
              null
            }
          />
          {firstMile.state.status ===
            'ready' && (
            <FirstMileMapLayer
              stops={
                firstMile.state
                  .stops
              }
              selectedStopId={
                firstMile
                  .selectedStopId
              }
              onSelect={
                firstMile
                  .setSelectedStopId
              }
            />
          )}
          {nearbyBusStops.length >
            0 && (
            <BusStopMapLayer
              stops={
                nearbyBusStops
              }
            />
          )}
          {liveTransit.status !==
            'idle' && (
            <LiveTransitMapLayer
              vehicles={
                liveTransit.vehicles
              }
            />
          )}
        </BaseMap>
        <LiveTransitStatus
          state={liveTransit}
        />
      </div>

      <MapAnalysisPanel
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
        timeBudget={
          reach.timeBudget
        }
        selectedStopId={
          firstMile.selectedStopId
        }
        onSelectStop={
          firstMile.setSelectedStopId
        }
        onRetryReachability={
          reach.retry
        }
        activeTab={
          analysisTab
        }
        onTabChange={
          setAnalysisTab
        }
      />

      {/* The budget composition note makes the panel tall enough to overflow a short
          viewport, so it scrolls internally rather than running off the bottom — the
          note has to stay reachable to satisfy AC 1.2.3. */}
      <div className={`absolute top-4 left-4 sm:left-6 z-[500] max-h-[calc(100%-2rem)] transition-all duration-300 ease-out ${configOpen ? 'w-[340px] max-w-[calc(100vw-2rem)]' : 'w-12'}`}>
        <div className="glass p-4 max-h-[calc(100vh-6rem)] overflow-y-auto overflow-x-hidden scrollbar-thin">
          <div className="flex items-center justify-between mb-3">
            {configOpen && <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Starting Point</h2>}
            <Tooltip content={configOpen ? 'Collapse' : 'Expand'}>
              <button onClick={() => setConfigOpen(prev => !prev)} className="btn-icon ml-auto" style={{ width: 32, height: 32 }}>
                {configOpen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </Tooltip>
          </div>

          {configOpen && (
            <div className="space-y-4 fade-in">
              <LocationSearch
                onSelect={reach.selectStop}
                selected={reach.origin?.stop ?? null}
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
                    onClick={reach.clearOrigin}
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
                <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Time Budget</label>
                <TimeBudgetSelector value={reach.timeBudget} onChange={reach.changeTimeBudget} />
              </div>

              <BudgetCompositionNote />

              <div className="pt-2 border-t border-slate-200/70">
                <CoveredAreaNote />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * AC 1.1.2 — a map-selected point shows its coordinate to 5 decimal places. A stop shows
 * the exact feed name and the lines serving it. No walking distance, walking time or
 * nearest stop is produced here; those belong to the First-Mile Walking Access epic.
 */
function OriginReadout({ origin }: { origin: NonNullable<ReturnType<typeof useReachability>['origin']> }) {
  const label =
    origin.source === 'stop' ? 'Selected stop'
    : origin.source === 'device' ? 'Your location'
    : 'Selected point';

  return (
    <div className="glass-chip rounded-xl px-3 py-2.5">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      {origin.stop ? (
        <>
          <div className="text-sm font-semibold text-slate-800">{origin.stop.name}</div>
          <div className="text-xs text-slate-500">
            {linesForStop(origin.stop).map(line => line.longName).join(' · ')}
          </div>
        </>
      ) : (
        <div className="text-sm font-mono text-slate-700">{formatCoord(origin.at)}</div>
      )}
    </div>
  );
}

/**
 * AC 1.2.3 — what the travel time budget is spent on.
 *
 * Collapsed by default. The criterion is triggered by the user "viewing how the travel
 * time was arrived at", so putting it behind a labelled control is faithful to that and
 * keeps the panel readable — but everything it must disclose is still here, and no
 * component is dropped for being unmodelled.
 *
 * The wording is deliberately a rider's, not the project's: what counts against the
 * budget and what is missing from it, with no epic names or internal owners. Honesty
 * about the model is required; internal process vocabulary is not, and reads as an
 * unfinished note to anyone outside the team.
 */
function BudgetCompositionNote() {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-chip rounded-xl px-3 py-2.5">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide flex-1">
          How this travel time is calculated
        </span>
        <ChevronDown
          size={14}
          className="text-slate-400 shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 200ms ease-out' }}
        />
      </button>

      {open && (
        <div className="fade-in">
          <ul className="space-y-1.5 mt-2">
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

          <div className="mt-2 pt-2 border-t border-slate-200/70 space-y-1">
            {BUDGET_ASSUMPTIONS.map(assumption => (
              <div key={assumption.label} className="text-[11px] leading-snug">
                <span className="font-semibold text-slate-700">{assumption.label}:</span>{' '}
                <span className="text-slate-500">{assumption.status}</span>
              </div>
            ))}
          </div>
        </div>
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
    <p className="text-[11px] text-slate-500 leading-relaxed">
      <span className="font-semibold text-slate-600">Covered area</span> is the extent of the
      loaded rail network plus {STUDY_AREA_BUFFER_KM} km. This is provisional — the boundary
      depends on the bus feed, which is not yet loaded.
    </p>
  );
}
