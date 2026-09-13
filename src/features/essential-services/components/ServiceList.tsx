import { useEffect, useState } from 'react';
import { Accessibility, ChevronRight, Clock, MapPin } from 'lucide-react';
import { CATEGORY_META, CATEGORY_ORDER } from '@/shared/data';
import type { ServiceLocation } from '@/shared/types/service';

interface ServiceListProps {
  services: ServiceLocation[];
  hoveredService: ServiceLocation | null;
  selectedService: ServiceLocation | null;
  onHover: (service: ServiceLocation | null) => void;
  onSelect: (service: ServiceLocation) => void;
}

/**
 * How many rows are rendered before the reader asks for more.
 *
 * Rendering every match put 65,110 nodes in the DOM at a central origin and pushed the
 * latency of a single keystroke in the filter box to over a second. The full count is
 * still reported above the list, so nothing is hidden — only deferred.
 */
const PAGE_SIZE = 50;

/** Epic 5.1.2 — service records are visibly grouped by the documented category. */
export function ServiceList({ services, hoveredService, selectedService, onHover, onSelect }: ServiceListProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  // A new result set starts from the top again, rather than keeping a limit the reader
  // raised for a different set of services.
  useEffect(() => setLimit(PAGE_SIZE), [services]);

  const shown = services.slice(0, limit);
  const remaining = services.length - shown.length;

  return (
    <div className="space-y-3 max-h-[560px] overflow-y-auto scrollbar-thin pr-1">
      {services.length > 0 && (
        <div className="text-xs text-slate-500 px-1">
          Showing <span className="font-semibold text-slate-700">{shown.length}</span> of{' '}
          <span className="font-semibold text-slate-700">{services.length.toLocaleString()}</span> services
        </div>
      )}
      {CATEGORY_ORDER.map(category => {
        const grouped = shown.filter(service => service.category === category);
        if (!grouped.length) return null;
        const categoryMeta = CATEGORY_META[category];
        return (
          <section key={category} className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 px-1 pt-1">
              {categoryMeta.label} · {grouped.length}
            </div>
            {grouped.map((service, index) => {
              const meta = CATEGORY_META[service.category];
              const Icon = meta.icon;
              const isHovered = hoveredService?.id === service.id;
              const isSelected = selectedService?.id === service.id;
              const missing = service.missingFields?.filter(field => field !== 'estimated travel time') ?? [];
              return (
                <div
                  key={service.id}
                  className={`card p-3.5 cursor-pointer transition-all duration-200 ${isSelected ? 'ring-2 ring-teal-400' : isHovered ? 'shadow-md' : ''}`}
                  style={{ animationDelay: `${index * 30}ms` }}
                  onMouseEnter={() => onHover(service)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(service)}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: meta.colorLight }}>
                      <Icon size={18} style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">{service.name}</div>
                      <div className="text-xs text-slate-500 truncate">{service.address || 'Address unavailable'}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <span className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                          <Clock size={11} className="text-teal-600" />
                          {service.estimatedTravelTime === undefined ? 'Calculating…' : service.estimatedTravelTime === null ? 'Time unavailable' : `${service.estimatedTravelTime} min`}
                        </span>
                        {service.lat !== undefined && service.lon !== undefined && (
                          <span className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={11} />{service.lat.toFixed(4)}, {service.lon.toFixed(4)}</span>
                        )}
                        {service.accessible === true && <Accessibility size={12} className="text-teal-600" />}
                      </div>
                      {missing.length > 0 && <div className="text-[10px] text-amber-700 mt-1">Unavailable: {missing.join(', ')}</div>}
                    </div>
                    <ChevronRight size={16} className="text-slate-300 mt-1" />
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {remaining > 0 && (
        <button
          onClick={() => setLimit(current => current + PAGE_SIZE)}
          className="btn-secondary w-full text-xs py-2.5"
        >
          Show {Math.min(PAGE_SIZE, remaining)} more · {remaining.toLocaleString()} remaining
        </button>
      )}
      {services.length === 0 && (
        <div className="glass p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">No services found</p>
          <p className="text-xs text-slate-500 mt-1">Try a longer travel time, or a different category.</p>
        </div>
      )}
    </div>
  );
}
