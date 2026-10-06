import OpeningHours from 'opening_hours';
export type ArrivalAvailability = { status: 'Open' | 'Closed' | 'Closing before arrival' | 'Unknown'; reason: string; arrival?: string };
/** Evaluate Malaysia wall time even when the browser is in a different timezone. */
function malaysiaWallTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return new Date(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
}
const cache = new Map<string, OpeningHours>();
export function arrivalAvailability(hours: string | undefined, departure: string, travelMinutes: number | null | undefined): ArrivalAvailability {
  if (!hours) return { status: 'Unknown', reason: 'Opening hours missing from source' };
  if (travelMinutes == null || !Number.isFinite(travelMinutes) || travelMinutes < 0) return { status: 'Unknown', reason: 'Modelled arrival time unavailable' };
  const depart = new Date(departure); const arrive = new Date(depart.getTime() + travelMinutes * 60000);
  if (!Number.isFinite(arrive.getTime())) return { status: 'Unknown', reason: 'Invalid departure time' };
  const arrival = arrive.toISOString();
  // Local holiday and variable-solar rules require verified regional calendars.
  if (/\b(PH|SH|sunrise|sunset|dawn|dusk|easter)\b/i.test(hours)) return { status: 'Unknown', reason: 'Holiday or solar-hours rules need verified local data', arrival };
  try {
    let parsed = cache.get(hours);
    if (!parsed) { parsed = new OpeningHours(hours); if (cache.size > 500) cache.clear(); cache.set(hours, parsed); }
    const departureWall = malaysiaWallTime(depart); const arrivalWall = malaysiaWallTime(arrive);
    if (parsed.getUnknown(arrivalWall)) return { status: 'Unknown', reason: 'Conditional opening hours', arrival };
    const open = parsed.getState(arrivalWall);
    return { status: open ? 'Open' : parsed.getState(departureWall) ? 'Closing before arrival' : 'Closed', reason: 'Estimated from OSM opening hours; source freshness unverified. Confirm with the venue.', arrival };
  } catch { return { status: 'Unknown', reason: 'Opening hours cannot be reliably parsed', arrival }; }
}
