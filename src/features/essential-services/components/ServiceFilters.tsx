import { CATEGORY_META, CATEGORY_ORDER } from '@/shared/data';
import type { ServiceCategory } from '@/shared/types/service';

interface ServiceFiltersProps {
  selected: Set<ServiceCategory>;
  onToggle: (cat: ServiceCategory) => void;
  counts?: Partial<Record<ServiceCategory, number>>;
  compact?: boolean;
}

/**
 * Category chips.
 *
 * Nothing is selected on arrival, so these are the first thing the reader is asked to
 * act on. That makes their state worth stating properly rather than implying: selection
 * used to be carried by fill colour alone, with no role, no pressed state and no
 * accessible name beyond the label — a screen reader announced twelve identical-sounding
 * buttons and gave no way to tell which were on.
 */
export function ServiceFilters({ selected, onToggle, counts, compact = false }: ServiceFiltersProps) {
  return (
    <div
      role="group"
      aria-label="Service categories"
      className={`flex flex-wrap gap-2 ${compact ? 'gap-1.5' : ''}`}
    >
      {CATEGORY_ORDER.map((catId) => {
        const meta = CATEGORY_META[catId];
        const Icon = meta.icon;
        const isSelected = selected.has(catId);
        const count = counts?.[catId];
        return (
          <button
            key={catId}
            type="button"
            onClick={() => onToggle(catId)}
            aria-pressed={isSelected}
            title={
              count === undefined || count === 0
                ? `${meta.label} — none in reach`
                : isSelected
                  ? `Hide ${meta.label} (${count} in reach)`
                  : `Show ${meta.label} (${count} in reach)`
            }
            className={`chip ${isSelected ? 'chip-selected' : 'chip-unselected'}`}
            style={compact ? { padding: '6px 10px', fontSize: 12 } : undefined}
          >
            <Icon size={compact ? 13 : 15} style={{ color: isSelected ? 'white' : meta.color }} />
            {meta.label}
            {count !== undefined && count > 0 && (
              <span className={`ml-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                isSelected ? 'bg-white/25' : 'bg-slate-200/60 text-slate-600'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
