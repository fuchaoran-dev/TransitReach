import { aroundTime, durationLabel, reasonLabel } from '../format';
import type { PlannedOrder, TripPlan } from '../types';

interface OrderComparisonProps {
  plan: TripPlan;
  selectedId: string;
  onSelect: (orderId: string) => void;
}

/**
 * The calculated visit orders, side by side.
 *
 * AC 2.2.4 — the first is the feasible order with the shortest total time, and it is
 * named for that rule. It is not called best or recommended: the planner measures time,
 * and whether a longer order suits the day better is the traveller's call (as AC 3.3.4).
 *
 * AC 2.2.3 — an order that cannot be completed is listed with its reason, never as an
 * option to follow.
 */
export function OrderComparison({ plan, selectedId, onSelect }: OrderComparisonProps) {
  const names = new Map(plan.request.stops.map(stop => [stop.service.id, stop.service.name]));
  const shortest = plan.orders.find(order => order.feasible) ?? null;

  const title = (order: PlannedOrder) =>
    order === shortest
      ? plan.ordersCalculated === plan.ordersConsidered ? 'Shortest total time' : 'Shortest calculated time'
      : order.feasible ? 'Alternative order' : 'Cannot be completed';

  return (
    <section aria-label="Visit orders compared">
      <div className="space-y-2" role="radiogroup" aria-label="Visit order">
        {plan.orders.map(order => {
          const selected = order.id === selectedId;
          const extra = shortest && order.feasible && order !== shortest && order.totals && shortest.totals
            ? order.totals.elapsedSeconds - shortest.totals.elapsedSeconds
            : null;
          return (
            <button
              key={order.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(order.id)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selected ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-300' : 'border-slate-200 bg-white/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${order.feasible ? 'text-teal-700' : 'text-rose-400'}`}>
                  {title(order)}{order.isUserOrder ? ' · your order' : ''}
                </span>
                {order.feasible && order.totals && (
                  <span className="text-sm font-bold text-slate-800">{durationLabel(order.totals.elapsedSeconds)}</span>
                )}
              </div>
              {/* Only the selected order is spelled out as a list: with five stops, four full
                  lists pushed the itinerary below them off the panel. */}
              {selected ? (
                <ol className="mt-1.5 text-xs text-slate-600 leading-snug">
                  {order.stopIds.map((id, index) => (
                    <li key={id} className="truncate">{index + 1}. {names.get(id)}</li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1.5 text-xs text-slate-600 leading-snug line-clamp-2">
                  {order.stopIds.map(id => names.get(id)).join(' → ')}
                </p>
              )}
              {order.feasible && order.totals ? (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Finish {aroundTime(order.totals.finishTime)} · {durationLabel(order.totals.walkSeconds)} walking ·{' '}
                  {order.totals.transfers} {order.totals.transfers === 1 ? 'transfer' : 'transfers'}
                  {extra !== null && extra >= 60 && ` · ${durationLabel(extra)} longer`}
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-rose-400">{order.reasons.map(reasonLabel).join(' ')}</p>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-500 leading-snug">
        Rule-based comparison: travel time, visit length, known opening hours and your finish-by time. No AI selects the order.{' '}
        {plan.ordersCalculated === plan.ordersConsidered
          ? `All ${plan.ordersConsidered} possible orders were calculated leg by leg.`
          : `${plan.ordersConsidered} possible orders were compared from estimated travel times; the ${plan.ordersCalculated} shown were then calculated leg by leg. An order not shown could still be quicker.`}
      </p>
    </section>
  );
}
