import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BrainCircuit, LoaderCircle, Radio } from 'lucide-react';
import type { BusStop } from '@/features/first-mile/busStopService';
import { useReliabilityPrediction } from '../hooks/useReliabilityPrediction';
import type { ReliabilityService } from '../types';

interface Props {
  stop: BusStop;
  services: ReliabilityService[];
  catalogLoading: boolean;
  catalogError: string | null;
}

export function BusStopReliabilityPopup({ stop, services, catalogLoading, catalogError }: Props) {
  const matchingLines = useMemo(
    () => services.filter(service =>
      service.mode === 'BUS' && service.stops.some(item => item.stop_id === stop.stopId),
    ),
    [services, stop.stopId],
  );
  const [lineId, setLineId] = useState('');
  const { result, loading, error, predict } = useReliabilityPrediction();

  useEffect(() => {
    const nextLine = matchingLines[0]?.line_id ?? '';
    setLineId(nextLine);
    if (nextLine) {
      void predict({
        mode: 'BUS',
        lineId: nextLine,
        stopId: stop.stopId,
        datetime: new Date().toISOString(),
      });
    }
  // A newly selected stop must trigger exactly one initial prediction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingLines, stop.stopId]);

  const changeLine = (nextLine: string) => {
    setLineId(nextLine);
    if (nextLine) {
      void predict({
        mode: 'BUS',
        lineId: nextLine,
        stopId: stop.stopId,
        datetime: new Date().toISOString(),
      });
    }
  };

  return (
    <div className="w-[310px] max-w-[72vw] text-slate-800">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-teal-700">
        <BrainCircuit size={15} /> AI delay estimate
      </div>
      <h3 className="mt-1 text-sm font-bold">{stop.name}</h3>
      <p className="text-[11px] text-slate-500">Bus stop {stop.stopId} · prediction time: now</p>

      {matchingLines.length > 1 && (
        <label className="mt-3 block text-xs font-semibold">
          Bus line
          <select
            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-xs"
            value={lineId}
            onChange={event => changeLine(event.target.value)}
          >
            {matchingLines.map(line => (
              <option key={line.line_id} value={line.line_id}>{line.name}</option>
            ))}
          </select>
        </label>
      )}

      {(catalogLoading || loading) && (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <LoaderCircle className="animate-spin text-teal-600" size={15} /> Calculating expected delay…
        </p>
      )}
      {(catalogError || error) && (
        <p role="alert" className="mt-3 flex gap-2 text-xs text-rose-600">
          <AlertTriangle className="shrink-0" size={15} /> Reliability service is unavailable.
        </p>
      )}
      {!catalogLoading && !catalogError && matchingLines.length === 0 && (
        <p className="mt-3 flex gap-2 text-xs text-amber-700">
          <AlertTriangle className="shrink-0" size={15} /> Prediction unavailable: this stop has insufficient historical data.
        </p>
      )}

      {result && !result.supported && (
        <p className="mt-3 flex gap-2 text-xs text-amber-700">
          <AlertTriangle className="shrink-0" size={15} /> Prediction unavailable for this line and time.
        </p>
      )}
      {result?.supported && (
        <div className="mt-3 space-y-3" aria-live="polite">
          <div className="flex items-end justify-between gap-3 rounded-xl bg-teal-50 p-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Expected delay</p>
              <p className="text-2xl font-extrabold text-slate-900">{result.expected_delay_min.toFixed(1)} min</p>
            </div>
            <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold capitalize text-teal-800">
              {result.risk_level.replace('_', ' ')} risk
            </span>
          </div>
          <p className="text-xs text-slate-600">
            <Radio className="mr-1 inline" size={13} /> Historical prediction
            {result.prediction_lower_min != null && result.prediction_upper_min != null &&
              ` · likely ${result.prediction_lower_min.toFixed(1)}–${result.prediction_upper_min.toFixed(1)} min`}
          </p>
          <p className="text-[11px] font-medium text-slate-600">
            {result.prediction_level.replace('_', ' ')}-level estimate · {result.confidence} confidence
            {result.is_fallback && ' · fallback for a stop with limited direct history'}
          </p>
          <ul className="list-disc space-y-1 pl-4 text-[11px] text-slate-600">
            {result.explanations.slice(0, 3).map(item => <li key={item}>{item}</li>)}
          </ul>
          <p className="border-t border-slate-200 pt-2 text-[10px] text-slate-500">
            {result.model_type} · trained {result.training_period}. This is not realtime occupancy or a guaranteed arrival time.
          </p>
        </div>
      )}
    </div>
  );
}
