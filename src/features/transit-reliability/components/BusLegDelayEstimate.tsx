import { useEffect } from 'react';
import { BrainCircuit, LoaderCircle } from 'lucide-react';
import { useReliabilityPrediction } from '../hooks/useReliabilityPrediction';
import type { RiskLevel } from '../types';

/**
 * The OTP feed id of the Rapid KL trunk bus feed. The delay model was trained on that
 * feed's route and stop ids, so only legs from it can be looked up; MRT feeder routes
 * (feed prasarana-mrt-feeder) are outside the model.
 */
const TRUNK_BUS_FEED = 'prasarana-rapid-bus-kl';

interface Props {
  /** OTP's feed-scoped route id, e.g. "prasarana-rapid-bus-kl:U3000". */
  routeId: string | null;
  /** OTP's feed-scoped id of the stop the rider boards at. */
  boardingStopId: string | null;
  /** The leg's modelled departure. */
  departureMs: number | null;
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very high',
};

const RISK_STYLE: Record<RiskLevel, string> = {
  low: 'bg-emerald-50 text-emerald-700',
  moderate: 'bg-amber-50 text-amber-700',
  high: 'bg-orange-50 text-orange-700',
  very_high: 'bg-rose-50 text-rose-700',
};

function unscoped(id: string | null, feed: string): string | null {
  if (!id?.startsWith(`${feed}:`)) return null;
  return id.slice(feed.length + 1);
}

/**
 * A delay as a rider says it. The model's range often starts below zero, because buses run
 * early as well as late; "−22 to 37 min" reads as nonsense, "22 min early and 37 min late"
 * does not.
 */
function offset(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded === 0) return 'on time';
  return rounded < 0 ? `${-rounded} min early` : `${rounded} min late`;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-MY', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

/**
 * Epic 4's delay estimate, on the bus leg of a modelled journey (US 4.1 inside US 3.5).
 *
 * The estimate is asked for the stop the rider boards at and the leg's modelled departure,
 * not "now": the journey itself is modelled for a typical weekday morning, and a delay for
 * the moment of reading would describe a different trip. The time used is stated, and the
 * figure is labelled historical, because that is what it is.
 */
export function BusLegDelayEstimate({ routeId, boardingStopId, departureMs }: Props) {
  const lineId = unscoped(routeId, TRUNK_BUS_FEED);
  const stopId = unscoped(boardingStopId, TRUNK_BUS_FEED);
  const { result, loading, error, predict } = useReliabilityPrediction();

  useEffect(() => {
    if (!lineId || !stopId || departureMs === null) return;
    void predict({ mode: 'BUS', lineId, stopId, datetime: new Date(departureMs).toISOString() });
  // One request per leg; predict is recreated on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, stopId, departureMs]);

  if (!lineId || !stopId || departureMs === null) {
    return (
      <p className="mt-1.5 text-[10px] text-slate-400">
        Delay estimates cover Rapid KL trunk bus routes only, not MRT feeder buses.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500">
        <LoaderCircle size={12} className="animate-spin text-teal-600" /> Estimating typical delay…
      </p>
    );
  }

  if (error) {
    return <p className="mt-1.5 text-[10px] text-slate-400">Delay estimate unavailable: the reliability service did not respond.</p>;
  }

  if (!result) return null;

  if (!result.supported) {
    return (
      <p className="mt-1.5 text-[10px] text-slate-400">
        No delay estimate for this stop at {formatWhen(departureMs)}: not enough comparable historical data.
      </p>
    );
  }

  const range =
    result.prediction_lower_min !== null && result.prediction_upper_min !== null
      ? `Likely between ${offset(result.prediction_lower_min)} and ${offset(result.prediction_upper_min)}.`
      : null;

  return (
    <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-700">
        <BrainCircuit size={12} className="text-teal-700 shrink-0" />
        <span>
          Typically arrives <span className="font-bold">{offset(result.expected_delay_min)}</span>
        </span>
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold ${RISK_STYLE[result.risk_level]}`}>
          {RISK_LABEL[result.risk_level]}
        </span>
      </div>
      {range && <div className="mt-0.5 text-[10px] text-slate-500">{range}</div>}
      <div className="mt-0.5 text-[10px] text-slate-400">
        Historical estimate for {formatWhen(departureMs)} at the boarding stop, trained on{' '}
        {result.training_period}. Not a live prediction.
      </div>
    </div>
  );
}
