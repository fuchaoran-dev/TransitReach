import { useRef } from 'react';

/**
 * AC 1.2.1 — the fixed set of travel time budgets.
 *
 * 15, 30, 45 and 60 minutes; no other value is selectable and free-text entry of an
 * arbitrary number of minutes is out of scope. The maximum is 60 min because isochrone
 * computation cost above that range has not been assessed.
 */
export const TIME_BUDGET_OPTIONS = [15, 30, 45, 60] as const;

const OPTIONS = TIME_BUDGET_OPTIONS;

interface TimeBudgetProps {
  value: number;
  onChange: (min: number) => void;
}

export function TimeBudgetSelector({ value, onChange }: TimeBudgetProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Arrow keys move between options, as a radio group requires. Only the selected option
   * is in the tab order, so the group is reached once by Tab rather than four times.
   */
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next]);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Travel time budget"
      className="relative flex items-center gap-1.5 p-1 glass-chip rounded-xl"
    >
      {OPTIONS.map((opt, index) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            ref={el => (refs.current[index] = el)}
            role="radio"
            aria-checked={selected}
            // Exactly one option is selected at any time. Selecting the current option
            // re-applies it rather than clearing it, so the control has no empty state.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt)}
            onKeyDown={e => handleKeyDown(e, index)}
            className={`chip whitespace-nowrap ${selected ? 'chip-selected' : 'chip-unselected'}`}
            style={{ padding: '6px 14px' }}
          >
            {opt} min
          </button>
        );
      })}
    </div>
  );
}
