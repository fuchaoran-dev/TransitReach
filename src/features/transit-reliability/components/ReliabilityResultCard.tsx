import { AlertTriangle, CheckCircle2, Radio } from 'lucide-react';
import type { ReliabilityResponse } from '../types';

export function ReliabilityResultCard({ result }: { result: ReliabilityResponse }) {
  if (!result.supported) {
    return (
      <section className="glass p-6" role="status">
        <div className="flex gap-3 items-start">
          <AlertTriangle className="text-amber-500 shrink-0" />
          <div>
            <h2 className="font-bold">Prediction unavailable</h2>
            <p className="text-sm text-slate-600 mt-1">
              Insufficient historical operational data. No delay or risk has been generated.
            </p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="glass p-6 space-y-5" aria-live="polite">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Expected delay</p>
          <p className="text-4xl font-bold text-slate-900">{result.expected_delay_min.toFixed(1)} min</p>
        </div>
        <span className="glass-chip px-4 py-2 self-start font-semibold capitalize">{result.risk_level.replace('_', ' ')} risk</span>
      </div>
      <p className="text-sm text-slate-600">
        {result.prediction_type === 'live_adjusted' ? <><Radio className="inline mr-1" size={15} />Live-adjusted</> : <><CheckCircle2 className="inline mr-1" size={15} />Historical forecast</>}
        {result.prediction_lower_min != null && result.prediction_upper_min != null && ` · likely range ${result.prediction_lower_min.toFixed(1)}–${result.prediction_upper_min.toFixed(1)} min`}
      </p>
      <div>
        <h3 className="font-bold">Why this prediction?</h3>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-600 space-y-1">{result.explanations.map(item => <li key={item}>{item}</li>)}</ul>
      </div>
      <div className="text-xs text-slate-500 border-t border-slate-200 pt-4">
        Model {result.model_version} · {result.model_type} · Training: {result.training_period}. {result.disclaimer}
      </div>
    </section>
  );
}

