import {
  ArrowRight,
  BusFront,
  Footprints,
  Loader2,
  RefreshCw,
  RotateCcw,
  TrainFront,
} from 'lucide-react';
import type { ServiceLocation } from '@/shared/types/service';
import { busRouteDescription, describeStep, legTitle } from '../interchangeService';
import { BusLegDelayEstimate } from '@/features/transit-reliability';
import { useEngineRoutesBuses } from '@/shared/hooks/useEngineRoutesBuses';
import type { WalkStep } from '@/shared/services/transitRoutingClient';
import type {
  JourneyInspectionModel,
  JourneyLeg,
  ModelledJourney,
} from '../types';

interface Props {
  model: JourneyInspectionModel;
  service: ServiceLocation | null;
  onChooseService: () => void;
}

function minutes(seconds: number): string {
  return `${Math.max(1, Math.ceil(seconds / 60))} min`;
}

function distance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

function transitLabel(leg: JourneyLeg): string {
  return legTitle(leg);
}

function JourneyModeIcon({ leg }: { leg: JourneyLeg }) {
  if (leg.mode === 'WALK') return <Footprints size={14} />;
  if (leg.mode === 'BUS') return <BusFront size={14} />;
  return <TrainFront size={14} />;
}

function journeySummary(journey: ModelledJourney): string[] {
  const labels: string[] = [];
  for (const leg of journey.legs) {
    if (leg.partOfInterchange) continue;
    const label = leg.mode === 'WALK' ? 'Walk' : transitLabel(leg);
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels;
}

function JourneyCard({
  journey,
  representative,
  selected,
  onSelect,
  onHighlight,
}: {
  journey: ModelledJourney;
  representative: boolean;
  selected: boolean;
  onSelect: () => void;
  /** Called with true while the card is hovered or focused, false when it no longer is. */
  onHighlight: (on: boolean) => void;
}) {
  const summary = journeySummary(journey);
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHighlight(true)}
      onMouseLeave={() => onHighlight(false)}
      onFocus={() => onHighlight(true)}
      onBlur={() => onHighlight(false)}
      className={`w-full text-left rounded-xl border p-3 transition ${
        selected
          ? 'border-teal-400 bg-teal-50/70 ring-1 ring-teal-300'
          : 'border-slate-200 bg-white/70 hover:border-teal-300 hover:bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-800">
              Modelled journey
            </span>
            {representative && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                Representative
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
            {summary.map((label, index) => (
              <span key={`${label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ArrowRight size={10} />}
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold text-slate-900">
            {minutes(journey.totalDurationSeconds)}
          </div>
          <div className="text-[10px] text-slate-400">
            {journey.interchanges.length === 0
              ? 'no interchange'
              : `${journey.interchanges.length} interchange${journey.interchanges.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>
      {!journey.withinBudget && (
        <div className="mt-2 text-[10px] text-amber-700">
          This exact journey is slightly outside the selected time budget.
        </div>
      )}
    </button>
  );
}

/**
 * Turn-by-turn directions for one walking leg, collapsed by default so the journey's
 * overall shape reads first. Clicking a step moves the map to it, which is the quickest
 * way to see which side of a road, or which footbridge, the route actually takes.
 */
function WalkingDirections({
  steps,
  focusedStep,
  onFocusStep,
}: {
  steps: WalkStep[];
  focusedStep: WalkStep | null;
  onFocusStep: (step: WalkStep) => void;
}) {
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer text-[11px] font-semibold text-teal-700 select-none">
        Walking directions · {steps.length} steps
      </summary>
      <ol className="mt-1.5 space-y-0.5">
        {steps.map((step, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => onFocusStep(step)}
              className={`w-full text-left flex items-baseline gap-2 rounded px-1.5 py-1 text-[11px] transition ${
                step === focusedStep ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="text-slate-400 w-4 shrink-0 text-right">{index + 1}</span>
              <span className="flex-1">{describeStep(step)}</span>
              {step.distanceMeters >= 1 && (
                <span className="text-slate-400 shrink-0">{distance(step.distanceMeters)}</span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

function JourneyDetail({
  journey,
  onBack,
  highlightedLegId,
  onHighlightLeg,
  focusedStep,
  onFocusStep,
}: {
  journey: ModelledJourney;
  onBack: () => void;
  highlightedLegId: string | null;
  onHighlightLeg: (legId: string | null) => void;
  focusedStep: WalkStep | null;
  onFocusStep: (step: WalkStep) => void;
}) {
  const interchangeAfter = new Map(
    journey.interchanges.map(interchange => [interchange.fromLegIndex, interchange]),
  );

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-teal-700">
            Journey inspection
          </div>
          <div className="text-xl font-bold text-slate-900 mt-0.5">
            {minutes(journey.totalDurationSeconds)} total
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary inline-flex items-center gap-1 text-[11px] py-1.5 px-2"
        >
          <RotateCcw size={12} />
          All journeys
        </button>
      </div>

      <div className="space-y-2">
        {journey.legs.map((leg, index) => {
          if (leg.partOfInterchange) return null;
          const interchange = interchangeAfter.get(index);
          return (
            <div key={leg.id} className="space-y-2">
              <div
                className={`rounded-lg bg-white/80 border p-2.5 transition ${
                  leg.id === highlightedLegId ? 'border-teal-400 ring-1 ring-teal-300' : 'border-slate-100'
                }`}
                // Hovering a step picks out its leg on the map, so the list and the drawn
                // route can be read against each other.
                onMouseEnter={() => onHighlightLeg(leg.id)}
                onMouseLeave={() => onHighlightLeg(null)}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <JourneyModeIcon leg={leg} />
                  {leg.mode === 'WALK' ? 'Walk' : transitLabel(leg)}
                  <span className="ml-auto text-xs text-slate-500">
                    {minutes(leg.durationSeconds)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500 leading-snug">
                  {busRouteDescription(leg) && (
                    <span className="block text-slate-600">{busRouteDescription(leg)}</span>
                  )}
                  {leg.from.name} → {leg.to.name}
                  {leg.distanceMeters > 0 && ` · ${distance(leg.distanceMeters)}`}
                </div>
                {leg.mode === 'WALK' && leg.steps.length > 1 && (
                  <WalkingDirections
                    steps={leg.steps}
                    focusedStep={focusedStep}
                    onFocusStep={onFocusStep}
                  />
                )}
                {leg.mode === 'BUS' && (
                  <>
                    {/* The bus feeds contain impossible hops, which scripts/fix-bus-timetable.mjs
                        slows to a 40 km/h cap before the graph is built. The time is therefore
                        partly ours, and the rider should know that. */}
                    <p className="mt-1 text-[10px] text-slate-500 leading-snug">
                      Ride time from the published timetable, slowed where it implied more than
                      40 km/h between stops.
                    </p>
                    <BusLegDelayEstimate
                      routeId={leg.routeId}
                      boardingStopId={leg.from.stopId}
                      departureMs={leg.startTimeMs}
                    />
                  </>
                )}
              </div>

              {interchange && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-amber-800">
                      Estimated interchange
                    </div>
                    <div className="text-xs font-bold text-amber-800">
                      {minutes(interchange.estimatedDurationSeconds)}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-amber-800/80">
                    {interchange.atName} · {interchange.fromModeLabel} → {interchange.toModeLabel}
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[10px] text-amber-900/70">
                    {interchange.factors.map(factor => (
                      <li key={factor}>• {factor}</li>
                    ))}
                  </ul>
                  {interchange.availableWindowSeconds !== null && (
                    <div className="mt-1.5 text-[10px] text-amber-900/70">
                      Connection window: {minutes(interchange.availableWindowSeconds)}
                      {interchange.residualWaitingSeconds !== null && interchange.residualWaitingSeconds > 0
                        ? ` · about ${minutes(interchange.residualWaitingSeconds)} schedule margin after the estimate`
                        : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg bg-white/70 p-2.5 text-[10px] leading-relaxed text-slate-500">
        This is a modelled journey used to explain the accessibility result. Walking directions follow
        OpenStreetMap's paths, so a footbridge or crossing that is not mapped there cannot be used.
        Transfer times are estimates derived from transfer distance, interchange layout and mode pairing.
      </div>
    </div>
  );
}

export function JourneyOptionsPanel({ model, service, onChooseService }: Props) {
  const routesBuses = useEngineRoutesBuses();

  if (!service) {
    return (
      <div className="py-4 text-sm text-slate-500">
        Choose an essential service first, then inspect the modelled journeys to it.
        <button type="button" onClick={onChooseService} className="btn-secondary block mt-3 text-xs">
          Choose a service
        </button>
      </div>
    );
  }

  if (model.status === 'loading') {
    return (
      <div className="py-5 flex items-center gap-2 text-sm text-slate-600">
        <Loader2 size={16} className="spinner text-teal-600" />
        Modelling journeys to {service.name}…
      </div>
    );
  }

  if (model.status === 'error') {
    return (
      <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
        <div>Unable to inspect journeys: {model.error}</div>
        <button type="button" onClick={model.retry} className="btn-secondary mt-2 inline-flex items-center gap-1 text-xs">
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  if (model.status !== 'ready') return null;

  if (model.selectedJourney) {
    return (
      <JourneyDetail
        journey={model.selectedJourney}
        onBack={model.clearSelection}
        highlightedLegId={model.highlightedLegId}
        onHighlightLeg={model.highlightLeg}
        focusedStep={model.focusedStep}
        onFocusStep={model.focusStep}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Journey to selected service
        </div>
        <div className="text-sm font-bold text-slate-800 mt-0.5 truncate">
          {service.name}
        </div>
        <p className="text-[11px] text-slate-500 leading-snug mt-1">
          Every journey is drawn faintly on the map. Point at one, here or on the map, to pick it out; select it to inspect only that path. The representative journey is the shortest feasible modelled journey returned by the routing engine; other journeys may exist.
        </p>
      </div>

      {!routesBuses && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
          Journeys here use walking and rail only. Buses are not in the journey planner yet, so a
          bus that would be quicker is not shown.
        </p>
      )}
      {model.journeys.map(journey => (
        <JourneyCard
          key={journey.id}
          journey={journey}
          representative={journey.id === model.representativeJourneyId}
          selected={journey.id === model.highlightedJourneyId}
          onSelect={() => model.selectJourney(journey.id)}
          onHighlight={on => {
            if (on) model.highlightJourney(journey.id);
            else if (model.highlightedJourneyId === journey.id) model.highlightJourney(null);
          }}
        />
      ))}

      {model.journeys.length === 0 && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          No practically achievable journey was returned for this service at the modelled departure time.
        </div>
      )}

      {model.rejectedJourneyCount > 0 && (
        <div className="text-[10px] text-slate-500">
          {model.rejectedJourneyCount} returned journey{model.rejectedJourneyCount === 1 ? ' was' : 's were'} excluded because the estimated interchange time did not fit the connection window.
        </div>
      )}
    </div>
  );
}
