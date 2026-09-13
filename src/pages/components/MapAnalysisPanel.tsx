import { useState } from 'react';

import {
  CircleHelp,
  Footprints,
  Loader2,
  RotateCw,
} from 'lucide-react';

import type {
  ReachabilityState,
} from '@/features/reachability';

import {
  NearbyStopsPanel,
  type FirstMileState,
} from '@/features/first-mile';

import {
  getDataBasis,
} from '@/features/reachability/reachabilityService';

import { MapServicesContent } from './MapServicesContent';
import type { MapServicesModel } from './useMapServices';

export type MapAnalysisTab =
  | 'first-mile'
  | 'services'
  | 'transfers';

interface MapAnalysisPanelProps {
  reachState: ReachabilityState;
  firstMileState: FirstMileState;

  /*
   * First-mile walking limit.
   * This is separate from the total journey budget.
   */
  walkThresholdMinutes: number;

  selectedRouteId: string | null;

  onSelectRoute: (
    routeId: string | null,
  ) => void;

  selectedStopId: string | null;

  onSelectStop: (
    stopId: string | null,
  ) => void;

  onRetryReachability: () => void;

  services: MapServicesModel;
  hasOrigin: boolean;

  activeTab: MapAnalysisTab;

  onTabChange: (
    tab: MapAnalysisTab,
  ) => void;
}

/**
 * Right-side analysis panel shared by map-based accessibility features.
 *
 * The panel keeps the headline reachability result visible while allowing
 * feature-specific details to be switched through tabs. First-mile and Services
 * are implemented; Transfers is a placeholder for a later feature.
 *
 * ResultPanel and DataBasisNote previously lived directly inside MapPage.
 * Their responsibilities now live here so MapPage remains responsible for page
 * composition rather than individual result-card presentation.
 *
 * There is no Reachability tab. It restated the headline directly above it, and
 * putting a result behind a tab implied it was one view among several rather than
 * the thing every other tab is measured against. Its three obligations were not
 * dropped with it — they were moved into the headline, where they are visible
 * without a click: the modelled-boundary caveat (AC 1.3.1), the walking-only
 * finding (AC 1.2.4), and the retry control for a failure or timeout (AC 1.3.2).
 */
export function MapAnalysisPanel({
  reachState,
  firstMileState,
  walkThresholdMinutes,
  selectedStopId,
  onSelectStop,
  onRetryReachability,
  services,
  hasOrigin,
  activeTab,
  onTabChange,
  selectedRouteId,
  onSelectRoute
}: MapAnalysisPanelProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [walkingNoteDismissedFor, setWalkingNoteDismissedFor] =
    useState<number | null>(null);

  // The panel stays mounted with no starting point chosen. Hiding it left a first-time
  // visitor looking at a bare map with nothing telling them what to do, and made the
  // Services tab unreachable from the navigation until an origin happened to exist.
  // Every tab below renders its own idle state.

  return (
    <div className="absolute top-4 right-4 sm:right-6 z-[500] w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="glass overflow-visible">

        {/* =====================================================
            HEADLINE RESULT

            AC 1.3.2 requires computing, failure and valid-result
            states to be visually distinct and never confused with
            one another.

            AC 1.2.4's walking-only outcome is a valid finding,
            not an error state.
            ===================================================== */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">

              {reachState.status === 'idle' && (
                <div className="py-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    No starting point yet
                  </div>
                  <div className="text-sm text-slate-600 mt-0.5">
                    Search or tap the map to begin
                  </div>
                </div>
              )}

              {reachState.status === 'computing' && (
                <div className="flex items-center gap-2 py-2">
                  <Loader2
                    size={16}
                    className="spinner text-teal-600 shrink-0"
                  />

                  <div>
                    <div className="text-sm font-semibold text-slate-700">
                      Computing reachable area
                    </div>

                    <div className="text-[11px] text-slate-500">
                      {reachState.budgetMinutes} min travel budget
                    </div>
                  </div>
                </div>
              )}

              {reachState.status === 'failed' && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                    Reachability unavailable
                  </div>

                  <div className="text-sm font-semibold text-slate-800 mt-1">
                    Could not compute the reachable area.
                  </div>

                  {/* AC 1.3.2 — re-runs the same settings without the user re-entering
                      anything. It lived in the Reachability tab, which meant a failure
                      could be read here while the way to recover from it was a click
                      away. */}
                  <RetryButton onClick={onRetryReachability} />
                </div>
              )}

              {/*
                AC 1.3.2 — a timeout reads distinctly from a failure:
                it names the limit that was exceeded rather than implying
                that the computation itself was invalid.
              */}
              {reachState.status === 'timedout' && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                    Calculation timed out
                  </div>

                  <div className="text-sm font-semibold text-slate-800 mt-1">
                    {reachState.budgetMinutes} min reachability
                    was not completed.
                  </div>

                  <div className="text-[11px] text-slate-500 mt-1">
                    Timed out after{' '}
                    {Math.round(reachState.limitMs / 1000)} seconds.
                  </div>

                  <RetryButton onClick={onRetryReachability} />
                </div>
              )}

              {reachState.status === 'ready' && (
                <>
                  {/*
                    AC 1.2.2 — this label comes from the state the area
                    was computed with, rather than directly from the selector,
                    so the displayed result and its budget cannot disagree.
                  */}
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Reachable within {reachState.budgetMinutes} min
                  </div>

                  <div
                    className="text-3xl font-bold text-slate-900 mt-0.5"
                    style={{
                      fontFamily:
                        "'Plus Jakarta Sans', sans-serif",
                    }}
                  >
                    {reachState.result.areaKm2.toFixed(1)}

                    <span className="text-sm font-semibold text-slate-400 ml-1">
                      km²
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {reachState.result.regions.length === 1
                      ? 'one continuous area'
                      : `${reachState.result.regions.length} separate areas`}
                  </div>

                  {/*
                    AC 1.3.1 — the displayed boundary is modelled rather than a
                    surveyed or exact accessibility boundary. Permanently beside
                    the figure it qualifies, rather than behind a tab: a number
                    read without its caveat is the failure this criterion exists
                    to prevent.
                  */}
                  <p className="text-[11px] text-slate-500 leading-snug mt-1.5">
                    A modelled boundary, not a precise line. A point just outside
                    it is not meaningfully less reachable than one just inside.
                  </p>
                </>
              )}
            </div>

            {/*
              AC 1.3.3 — the data basis accompanies the displayed
              reachability result.

              Previously this information was rendered as a separate
              DataBasisNote card. It now lives behind this help control
              to reduce map clutter while keeping the same information
              available to the user.

              Desktop: hover
              Keyboard: focus
              Mobile: click
            */}
            {reachState.status === 'ready' && (
              <DataBasisHelp
                open={helpOpen}
                onOpenChange={setHelpOpen}
              />
            )}
          </div>

          {/*
            AC 1.2.4 — walking-only is a valid finding rather than an error, so it
            keeps neutral styling and no error wording. Dismissal is remembered per
            budget: choosing a different budget is a new question, and the answer to
            it deserves to be stated again.
          */}
          {reachState.status === 'ready' &&
            reachState.walkingOnly &&
            walkingNoteDismissedFor !== reachState.budgetMinutes && (
              <div className="rounded-xl bg-slate-50 p-3 mt-3 flex items-start gap-2">
                <Footprints
                  size={14}
                  className="text-slate-500 shrink-0 mt-0.5"
                />

                <p className="text-[11px] text-slate-600 leading-snug flex-1">
                  No public transport can be boarded from this point within{' '}
                  {reachState.budgetMinutes} min. The displayed area is walking only.
                </p>

                <button
                  type="button"
                  onClick={() =>
                    setWalkingNoteDismissedFor(reachState.budgetMinutes)
                  }
                  aria-label="Dismiss walking-only note"
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              </div>
            )}
        </div>

        {/* =====================================================
            ANALYSIS TABS
            ===================================================== */}
        <div className="border-t border-slate-200/70 px-3 pt-2">
          <div className="grid grid-cols-3 gap-1 bg-slate-100/70 rounded-xl p-1">

            <AnalysisTabButton
              label="First-mile"
              active={activeTab === 'first-mile'}
              onClick={() =>
                onTabChange('first-mile')
              }
            />

            <AnalysisTabButton
              label="Services"
              active={activeTab === 'services'}
              onClick={() =>
                onTabChange('services')
              }
            />

            <AnalysisTabButton
              label="Transfers"
              active={false}
              disabled
              soon
              onClick={() => {}}
            />
          </div>
        </div>

        {/* =====================================================
            ACTIVE TAB CONTENT
            ===================================================== */}
        <div className="p-4 max-h-[55vh] overflow-y-auto scrollbar-thin">
          {activeTab === 'first-mile' && (
            <NearbyStopsPanel
              state={firstMileState}
              thresholdMinutes={walkThresholdMinutes}
              selectedStopId={selectedStopId}
              onSelectStop={onSelectStop}
              selectedRouteId={
              selectedRouteId
            }

            onSelectRoute={
              onSelectRoute
            }
            />
          )}

          {activeTab === 'services' && (
            <MapServicesContent
              model={services}
              hasOrigin={hasOrigin}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * AC 1.3.3 — what the displayed result was computed from.
 *
 * Every value is read from the feed metadata rather than written by hand,
 * so this information cannot silently drift from the data the routing
 * engine was actually built on.
 *
 * OpenStreetMap attribution required by the same criterion remains
 * permanently visible through Leaflet's attribution control on the map.
 *
 * This replaces the former DataBasisNote component in MapPage.
 */
function DataBasisHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const basis = getDataBasis();

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() =>
        onOpenChange(true)
      }
      onMouseLeave={() =>
        onOpenChange(false)
      }
    >
      <button
        type="button"
        aria-label="What this result is computed from"
        aria-expanded={open}
        onClick={() =>
          onOpenChange(!open)
        }
        onFocus={() =>
          onOpenChange(true)
        }
        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition"
      >
        <CircleHelp size={17} />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[1000] w-[300px] rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur-xl p-3.5">

          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-2.5">
            What this is computed from
          </div>

          <div className="space-y-2 text-[11px] leading-relaxed">

            <div>
              <div className="font-semibold text-slate-700">
                {basis.feedName}
              </div>

              <div className="text-slate-500">
                {basis.lineCount} rail lines · service{' '}
                {basis.serviceStart} to{' '}
                {basis.serviceEnd}
              </div>
            </div>

            <div className="text-slate-600">
              <span className="font-semibold capitalize">
                {basis.dayType}
              </span>{' '}
              service · departing {basis.dayLabel}

              {basis.activeCalendars.length > 0 && (
                <span className="text-slate-400">
                  {' '}
                  (calendar{' '}
                  {basis.activeCalendars.join(', ')})
                </span>
              )}
            </div>

            <div className="text-slate-600">
              Walking routes use the OpenStreetMap
              pedestrian network.
            </div>

            <div className="text-slate-600">
              {basis.modesNotLoaded}
            </div>

            <div className="border-t border-slate-100 pt-2 text-slate-500">
              {basis.realtimeNote}
            </div>

            {basis.expiredCalendars.length > 0 && (
              <div className="text-slate-500">
                <span className="font-semibold text-slate-600">
                  Expired service excluded:
                </span>{' '}
                {basis.expiredCalendars
                  .map(
                    calendar =>
                      `${calendar.serviceId} (ended ${calendar.endDate})`,
                  )
                  .join(' · ')}
              </div>
            )}

            <div className="text-slate-400">
              <span className="font-semibold">
                Feed licence:
              </span>{' '}
              {basis.licence ??
                basis.licenceStatus}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** AC 1.3.2 — re-runs the same settings; the user re-enters nothing. */
function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-secondary inline-flex items-center gap-1.5 text-xs py-1.5 px-2.5 mt-2"
    >
      <RotateCw size={13} />
      Retry
    </button>
  );
}

function AnalysisTabButton({
  label,
  active,
  disabled = false,
  soon = false,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  soon?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
        active
          ? 'bg-white text-teal-700 shadow-sm'
          : disabled
            ? 'text-slate-400 cursor-not-allowed'
            : 'text-slate-600 hover:text-slate-800 hover:bg-white/60'
      }`}
    >
      {label}

      {soon && (
        <span className="ml-1 text-[8px] font-bold uppercase tracking-wide text-slate-400">
          Soon
        </span>
      )}
    </button>
  );
}