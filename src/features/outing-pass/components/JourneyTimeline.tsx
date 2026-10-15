import { Fragment, type ReactNode } from 'react';
import { Bus, ChevronRight, Footprints, MapPin, Navigation, TrainFront } from 'lucide-react';
import { describeStep } from '@/features/interchange/interchangeService';
import type { CheckedPassLeg } from '../types';
import { passTime } from './passPresentation';
import { distanceLabel, legColour, legKind, legTitle, minutesLabel, stopLabel, type StopLabel } from './legPresentation';

interface Props {
  legs: CheckedPassLeg[];
  originLabel: string;
  destinationLabel: string;
}

function StopName({ stop }: { stop: StopLabel }) {
  return <span className="inline-flex flex-wrap items-center gap-2">
    <span className="font-semibold text-white">{stop.name}</span>
    {stop.code && <span className="rounded-md bg-slate-500/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-300">{stop.code}</span>}
  </span>;
}

function Stop({ time, label, terminal = false }: { time: string; label: ReactNode; terminal?: boolean }) {
  return <li className="travel-timeline-row">
    <span className="travel-timeline-time">{time}</span>
    <span className="travel-timeline-rail" aria-hidden="true"><span className={`travel-timeline-dot ${terminal ? 'is-terminal' : ''}`} /></span>
    <span className="min-w-0 pb-1 text-sm">{label}</span>
  </li>;
}

/**
 * The journey as one vertical line: stops are dots with a time, legs are the line between.
 * Walking is a dashed teal line and a ridden leg is solid in its route colour, matching the
 * map so the two can be read against each other.
 */
export function JourneyTimeline({ legs, originLabel, destinationLabel }: Props) {
  if (legs.length === 0) return null;
  return <ol className="travel-timeline" aria-label="Your journey, step by step">
    <Stop time={passTime(legs[0].estimatedStartTime)} terminal label={<span className="font-semibold text-white">{originLabel}</span>} />
    {legs.map((leg, index) => {
      const kind = legKind(leg);
      const colour = legColour(leg);
      const { title, subtitle } = legTitle(leg);
      const isLast = index === legs.length - 1;
      const to = stopLabel(leg.to.name);
      const Icon = kind === 'walk' ? Footprints : kind === 'bus' ? Bus : kind === 'rail' ? TrainFront : Navigation;
      return <Fragment key={leg.id}>
          <li className="travel-timeline-row">
            <span className="travel-timeline-time" />
            <span className="travel-timeline-rail" aria-hidden="true"><span className={`travel-timeline-line ${kind === 'walk' ? 'is-walk' : ''}`} style={{ ['--leg-colour' as string]: colour }} /></span>
            {kind === 'walk'
              ? <div className="min-w-0 py-3 text-sm text-slate-300">
                <p className="flex items-center gap-2"><Icon size={15} aria-hidden="true" className="text-teal-200" />Walk {minutesLabel(leg.durationSeconds)} · {distanceLabel(leg.distanceMeters)}</p>
                {leg.steps.length > 0 && <details className="travel-steps mt-1.5 text-xs text-slate-400">
                  <summary className="inline-flex cursor-pointer items-center gap-1 hover:text-teal-200"><ChevronRight size={13} aria-hidden="true" className="travel-steps-chevron" />Walking directions</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">{leg.steps.map((step, stepIndex) => <li key={stepIndex}>{describeStep(step)} · {Math.round(step.distanceMeters)} m</li>)}</ol>
                </details>}
              </div>
              : <div className="my-2 min-w-0 rounded-xl border p-3.5" style={{ borderColor: `${colour}55`, background: `${colour}12` }}>
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-white">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#08121d]" style={{ background: colour }}><Icon size={16} aria-hidden="true" /></span>
                  {title}
                  <span className="ml-auto shrink-0 text-xs font-medium text-slate-300">{minutesLabel(leg.durationSeconds)}</span>
                </p>
                {subtitle && <p className="mt-1.5 pl-9 text-xs text-slate-300">{subtitle}</p>}
                {leg.stopCount != null && <p className="mt-2 pl-9 text-xs text-slate-300">Ride {leg.stopCount} {leg.stopCount === 1 ? 'stop' : 'stops'}</p>}
                <p className="mt-2 pl-9 text-xs text-slate-300">Board at <StopName stop={stopLabel(leg.from.name)} /></p>
                <p className="mt-1 pl-9 text-xs text-slate-300">Get off at <StopName stop={to} /></p>
              </div>}
          </li>
          {isLast
            ? <Stop time={passTime(leg.estimatedEndTime)} terminal label={<span className="inline-flex items-center gap-1.5 font-semibold text-white"><MapPin size={14} aria-hidden="true" className="text-teal-200" />{destinationLabel}</span>} />
            : <Stop time={passTime(leg.estimatedEndTime)} label={<StopName stop={to} />} />}
      </Fragment>;
    })}
  </ol>;
}
