import {
  AlertTriangle,
  BusFront,
  Footprints,
  Loader2,
  Train,
} from 'lucide-react';

import type {
  FirstMileBusStopResult,
  FirstMileState,
} from '../types';

import {
  displayModeForLine,
  formatLineFrequency,
} from '@/shared/data/adapters/gtfsAdapter';

interface NearbyStopsPanelProps {
  state:
    FirstMileState;

  thresholdMinutes:
    number;

  selectedStopId:
    string | null;

  onSelectStop: (
    stopId:
      string | null,
  ) => void;

  selectedRouteId:
    string | null;

  onSelectRoute: (
    routeId:
      string | null,
  ) => void;
}

function formatDistance(
  metres: number,
): string {
  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  }

  return `${(metres / 1000).toFixed(1)} km`;
}

/** At most this many rail stations are named per bus route; the rest are counted. */
const RAIL_STATIONS_SHOWN = 2;

function railSummary(stations: string[]): string {
  const named = stations.slice(0, RAIL_STATIONS_SHOWN).join(', ');
  const more = stations.length - RAIL_STATIONS_SHOWN;
  return more > 0 ? `${named} +${more} more` : named;
}

/**
 * US 3.1 — bus stops in the walking window.
 *
 * For most of the Klang Valley the nearest boardable service is a bus, so a first mile
 * of stations alone told most riders there was nothing nearby. Each stop is shown with
 * the routes that make it worth walking to, and for each route the rail stations it
 * passes: a feeder bus matters because it is the way to the train. Stops are the nearest
 * that between them cover every distinct route, so a street lined with stops for the same
 * bus shows once.
 */
function BusStopsSection({
  busStops,
  thresholdMinutes,
  selectedStopId,
  onSelectStop,
  afterStations,
}: {
  busStops: FirstMileBusStopResult[];
  thresholdMinutes: number;
  selectedStopId: string | null;
  onSelectStop: (stopId: string | null) => void;
  afterStations: boolean;
}) {
  return (
    <div className={`space-y-2 ${afterStations ? 'pt-2 border-t border-slate-200/70' : ''}`}>
      <div className="text-xs text-slate-500 leading-snug">
        {busStops.length} bus stop{busStops.length === 1 ? '' : 's'} within a{' '}
        {thresholdMinutes} min walk, one for each bus route in reach, nearest first.
      </div>

      {busStops.map(result => {
        const selected = selectedStopId === result.stop.stopId;
        return (
          <button
            key={result.stop.stopId}
            type="button"
            onClick={() => onSelectStop(selected ? null : result.stop.stopId)}
            className={`w-full text-left rounded-xl border p-3 transition ${
              selected ? 'border-teal-400 bg-teal-50/80' : 'border-slate-200 bg-white/70 hover:bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-1.5">
                <BusFront size={14} className="text-slate-500 shrink-0 mt-0.5" />
                <div className="font-semibold text-sm text-slate-800">{result.stop.name}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-slate-800">
                  {Math.ceil(result.route.durationSeconds / 60)} min
                </div>
                <div className="text-[11px] text-slate-500">
                  {formatDistance(result.route.distanceMeters)}
                </div>
              </div>
            </div>

            <ul className="mt-2 space-y-1">
              {result.routes.map(route => (
                <li key={route.routeId} className="rounded-lg bg-white/60 px-2 py-1.5">
                  <div className="text-[11px] text-slate-700">
                    <span className="font-bold">{route.name}</span>
                    {route.description && <span className="text-slate-500"> · {route.description}</span>}
                  </div>
                  {route.railStations.length > 0 && (
                    <div className="text-[10px] text-teal-700 mt-0.5">
                      Connects to rail at {railSummary(route.railStations)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </button>
        );
      })}

      <p className="text-[10px] text-slate-400 leading-snug">
        Rapid KL and MRT feeder bus routes from the published timetables. Walking times use the
        same pedestrian routing as stations.
      </p>
    </div>
  );
}

export function NearbyStopsPanel({
  state,
  thresholdMinutes,
  selectedStopId,
  onSelectStop,
  selectedRouteId,
  onSelectRoute,
}: NearbyStopsPanelProps) {
  if (state.status === 'idle') {
    return (
      <div className="py-4 text-sm text-slate-500">
        Select a starting point to view first-mile walking access.
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* First-mile heading */}
      <div className="flex items-start gap-2">
        <Footprints
          size={17}
          className="text-teal-600 shrink-0 mt-0.5"
        />

        <div>
          <h3 className="text-sm font-bold text-slate-800">
            First-mile walking access
          </h3>

          <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
            Walking routes use the OpenStreetMap pedestrian network.
          </p>
        </div>
      </div>

      {/*
        The walking window is the first mile's own limit.

        It used to track the travel-time budget, which meant a 45-minute journey was
        read as a willingness to walk 45 minutes to a station. Saying what each number
        governs is the point of this box: one is the walk, the other is the trip.
      */}
      <div className="rounded-xl bg-teal-50 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-teal-700 mb-0.5">
          Walking window
        </div>

        <p className="text-[11px] text-teal-800 leading-snug">
          Stations and bus stops within a{' '}
          <span className="font-bold">
            {thresholdMinutes} min
          </span>{' '}
          walk. Your travel-time budget covers the whole journey, not this walk.
        </p>
      </div>

      {/* Loading */}
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-600">
          <Loader2
            size={16}
            className="spinner text-teal-600"
          />

          Routing walking access to nearby stations and bus stops…
        </div>
      )}

      {/* Failed */}
      {state.status === 'failed' && (
        <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 rounded-xl p-3">
          <AlertTriangle
            size={16}
            className="shrink-0 mt-0.5"
          />

          {state.message}
        </div>
      )}

      {/* No nearby station */}
      {state.status === 'ready' &&
        state.stops.length === 0 &&
        state.busStops.length === 0 && (
          <div className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">
            No usable public transport stop was found within a{' '}
            {thresholdMinutes}-minute walking route.
          </div>
        )}

      {/* Stops */}
      {state.status === 'ready' &&
        state.stops.length > 0 && (
          <>
            <div className="text-xs text-slate-500 leading-snug">
              {state.stops.length}{' '}
              station
              {state.stops.length === 1 ? '' : 's'}{' '}
              within a {thresholdMinutes} min walk, nearest first.
              Select a station to view its route.
            </div>

            <div className="space-y-2">
              {state.stops.map(
                result => {
                  const selected =
                    selectedStopId ===
                    result.stop.stopId;

                  return (
                    <div
                      key={
                        result.stop.stopId
                      }
                      className={`w-full rounded-xl border transition ${
                        selected
                          ? 'border-teal-400 bg-teal-50/80'
                          : 'border-slate-200 bg-white/70'
                      }`}
                    >
                      {/* Station selection */}
                      <button
                        type="button"
                        onClick={() =>
                          onSelectStop(
                            selected
                              ? null
                              : result
                                  .stop
                                  .stopId,
                          )
                        }
                        className="
                          w-full
                          text-left
                          p-3
                          pb-2
                        "
                      >
                        <div
                          className="
                            flex
                            items-start
                            justify-between
                            gap-3
                          "
                        >
                          <div
                            className="
                              min-w-0
                            "
                          >
                            <div
                              className="
                                font-semibold
                                text-sm
                                text-slate-800
                              "
                            >
                              {
                                result
                                  .stop
                                  .name
                              }
                            </div>
                          </div>

                          <div
                            className="
                              text-right
                              shrink-0
                            "
                          >
                            <div
                              className="
                                text-sm
                                font-bold
                                text-slate-800
                              "
                            >
                              {Math.ceil(
                                result
                                  .route
                                  .durationSeconds /
                                  60,
                              )}{' '}
                              min
                            </div>

                            <div
                              className="
                                text-[11px]
                                text-slate-500
                              "
                            >
                              {formatDistance(
                                result
                                  .route
                                  .distanceMeters,
                              )}
                            </div>
                          </div>
                        </div>
                      </button>

                      {/* Rail line choices */}
                      <div
                        className="
                          px-3
                          pb-3
                          space-y-1.5
                        "
                      >
                        {result.lines.map(
                          line => {
                            const routeSelected =
                              selected &&
                              selectedRouteId ===
                                line.routeId;

                            return (
                              <button
                                key={
                                  line.routeId
                                }
                                type="button"
                                onClick={() => {
                                  /*
                                  * Selecting a line
                                  * also selects its
                                  * station.
                                  */
                                  if (!selected) {
                                    onSelectStop(
                                      result
                                        .stop
                                        .stopId,
                                    );
                                  }

                                  onSelectRoute(
                                    routeSelected
                                      ? null
                                      : line
                                          .routeId,
                                  );
                                }}
                                className={`w-full flex items-start gap-2 rounded-lg px-2 py-2 text-left transition ${
                                  routeSelected
                                    ? 'bg-white ring-2 ring-teal-400'
                                    : 'bg-white/60 hover:bg-white'
                                }`}
                              >
                                <Train
                                  size={13}
                                  className="
                                    text-teal-600
                                    shrink-0
                                    mt-0.5
                                  "
                                />

                                <div
                                  className="
                                    min-w-0
                                  "
                                >
                                  <div
                                    className="
                                      text-[11px]
                                      font-semibold
                                      text-slate-700
                                    "
                                  >
                                    {
                                      line.longName
                                    }
                                  </div>

                                  <div
                                    className="
                                      text-[10px]
                                      text-slate-500
                                      mt-0.5
                                    "
                                  >
                                    {displayModeForLine(
                                      line,
                                    )}

                                    {' · '}

                                    {formatLineFrequency(
                                      line,
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>

            {/* AC 3.2.2 — ordering is not ranking, and the distinction is stated
                rather than assumed: nothing here is marked best, fastest or
                recommended, and walking effort and service quality stay separate. */}
            <p className="text-[10px] text-slate-400 leading-snug">
              Frequencies are published GTFS headways, not live
              arrival predictions. Ordered by walking distance —
              no stop is ranked or recommended over another.
            </p>
          </>
        )}

      {state.status === 'ready' &&
        state.busStops.length > 0 && (
          <BusStopsSection
            busStops={state.busStops}
            thresholdMinutes={thresholdMinutes}
            selectedStopId={selectedStopId}
            onSelectStop={onSelectStop}
            afterStations={state.stops.length > 0}
          />
        )}
    </div>
  );
}