import type { JourneyOptionSummary } from '../types';
import { passTime } from './passPresentation';
import { minutesLabel, optionHighlights } from './legPresentation';

interface Props {
  options: JourneyOptionSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/** Side-by-side options, so alternatives are visible without opening a dropdown. */
export function RouteOptionCards({ options, selectedId, onSelect, disabled = false }: Props) {
  const highlights = optionHighlights(options);
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Route options</legend>
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
      {options.map(option => {
        const selected = option.id === selectedId;
        const labels = highlights.get(option.id) ?? [];
        return <button key={option.id} type="button" role="radio" aria-checked={selected} onClick={() => onSelect(option.id)}
          className={`route-option rounded-xl border p-3 text-left transition-colors ${selected ? 'border-teal-300 bg-teal-300/10' : 'border-[#294456] bg-[#152535] hover:border-[#3d6276]'}`}>
          <span className="flex items-baseline justify-between gap-2">
            <span className="tabular-nums text-base font-bold text-white">{minutesLabel(option.durationSeconds)}</span>
            <span className="tabular-nums text-xs text-slate-300">{passTime(option.leaveTime)}</span>
          </span>
          <span className="mt-1 block text-xs text-slate-400">
            {option.transferCount === 0 ? 'No transfers' : `${option.transferCount} transfer${option.transferCount === 1 ? '' : 's'}`} · {minutesLabel(option.walkingSeconds)} walk
          </span>
          {labels.length > 0 && <span className="mt-2 flex flex-wrap gap-1">{labels.map(label => <span key={label} className="rounded-full bg-teal-300/15 px-2 py-0.5 text-[10px] font-semibold text-teal-200">{label}</span>)}</span>}
        </button>;
      })}
    </div>
  </fieldset>;
}
