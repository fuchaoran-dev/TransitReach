import type { CheckedPassLeg, JourneyOptionSummary } from '../types';

/**
 * GTFS feeds publish many stop names in upper case with the stop code glued on the front
 * ("SJ68 TAMAN SUBANG PERMAI (UTARA)"). They are hard to scan on a pass, so the code is
 * split out as a chip and the name is shown in title case. Mixed-case names are left alone:
 * they were written by a person and may carry deliberate capitals.
 */
const KEEP_UPPER = new Set(['LRT', 'MRT', 'KTM', 'BRT', 'KL', 'KLCC', 'KLIA', 'USJ', 'PJ', 'SS', 'UPM', 'UM', 'UKM', 'IOI', 'MRR2', 'LDP', 'NPE', 'KESAS', 'TTDI', 'PPR', 'SMK', 'SK', 'II', 'III', 'IV']);
const STOP_CODE = /^([A-Z]{1,4}\d{1,4}[A-Z]?)\s+(.+)$/;

export interface StopLabel {
  code: string | null;
  name: string;
}

function titleWord(word: string): string {
  const bare = word.replace(/[^A-Z0-9]/g, '');
  if (!bare || KEEP_UPPER.has(bare) || /\d/.test(bare)) return word;
  return word.toLowerCase().replace(/(^|[(\-/'])([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

export function stopLabel(raw: string | null | undefined): StopLabel {
  const value = (raw ?? '').trim();
  if (!value) return { code: null, name: 'Unnamed stop' };
  if (value !== value.toUpperCase()) return { code: null, name: value };
  const match = STOP_CODE.exec(value);
  const code = match ? match[1] : null;
  const rest = match ? match[2] : value;
  return { code, name: rest.split(/\s+/).map(titleWord).join(' ') };
}

export type LegKind = 'walk' | 'bus' | 'rail';

export function legKind(leg: Pick<CheckedPassLeg, 'mode'>): LegKind {
  if (leg.mode === 'WALK') return 'walk';
  if (leg.mode === 'BUS' || leg.mode === 'COACH' || leg.mode === 'TROLLEYBUS') return 'bus';
  return 'rail';
}

const KIND_FALLBACK_COLOUR: Record<LegKind, string> = { walk: '#74fcea', bus: '#60a5fa', rail: '#a78bfa' };

export function legColour(leg: Pick<CheckedPassLeg, 'mode' | 'routeColor'>): string {
  const kind = legKind(leg);
  if (kind === 'walk') return KIND_FALLBACK_COLOUR.walk;
  return leg.routeColor ?? KIND_FALLBACK_COLOUR[kind];
}

/** A bus is named by its route number; a rail line by its line name. */
export function legTitle(leg: CheckedPassLeg): { title: string; subtitle: string | null } {
  const kind = legKind(leg);
  if (kind === 'walk') return { title: 'Walk', subtitle: null };
  if (kind === 'bus') {
    return leg.routeShortName
      ? { title: `Bus ${leg.routeShortName}`, subtitle: leg.routeLongName }
      : { title: 'Bus', subtitle: leg.routeLongName };
  }
  return { title: leg.routeLongName ?? leg.routeShortName ?? 'Train', subtitle: leg.routeLongName && leg.routeShortName ? leg.routeShortName : null };
}

export function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function distanceLabel(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
}

/** "Leave in 1 h 4 min", "Leave now", or "Departure time passed 3 min ago". */
export function countdownLabel(leaveIso: string, now: number): string {
  const diff = Date.parse(leaveIso) - now;
  if (!Number.isFinite(diff)) return '';
  if (Math.abs(diff) < 60_000) return 'Time to leave now';
  if (diff < 0) return `Suggested departure passed ${minutesLabel(-diff / 1000)} ago`;
  return `Leave in ${minutesLabel(diff / 1000)}`;
}

export type OptionHighlight = 'Fastest' | 'Least walking' | 'Fewest transfers';

/** Labels help compare options; ties go to the earliest-listed option so labels stay stable. */
export function optionHighlights(options: JourneyOptionSummary[]): Map<string, OptionHighlight[]> {
  const result = new Map<string, OptionHighlight[]>(options.map(option => [option.id, []]));
  if (options.length < 2) return result;
  const pick = (score: (option: JourneyOptionSummary) => number, label: OptionHighlight) => {
    const best = options.reduce((winner, option) => score(option) < score(winner) ? option : winner);
    if (options.some(option => score(option) !== score(best))) result.get(best.id)?.push(label);
  };
  pick(option => option.durationSeconds, 'Fastest');
  pick(option => option.walkingSeconds, 'Least walking');
  pick(option => option.transferCount, 'Fewest transfers');
  return result;
}
