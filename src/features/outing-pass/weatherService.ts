import type { CheckedPassLeg, WeatherEvidence } from './types';

const SOURCE_URL = 'https://developer.data.gov.my/realtime-api/weather';

export interface ForecastRow {
  date?: unknown;
  morning_forecast?: unknown;
  afternoon_forecast?: unknown;
  night_forecast?: unknown;
  location?: { location_id?: unknown; location_name?: unknown };
}

export interface WeatherDistrict {
  id: string;
  name: string;
}

export interface OfficialForecastSnapshot {
  district: WeatherDistrict;
  rows: ForecastRow[];
  retrievedAt: string;
}

/**
 * The project currently has one configured MET district. Use it only when the venue's
 * source address itself establishes Kuala Lumpur; coordinates alone cannot distinguish
 * the federal territory from neighbouring Petaling, Gombak or Hulu Langat districts.
 */
export function weatherDistrictForVenue(venue: { address?: string }): WeatherDistrict | null {
  const address = venue.address?.trim();
  if (!address) return null;
  if (/\bkuala lumpur\b/i.test(address) || /\b(?:5\d{4}|60000)\b/.test(address)) {
    return { id: 'Ds058', name: 'Kuala Lumpur' };
  }
  return null;
}

function malaysiaParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
  };
}

function periodAt(hour: number): 'Morning' | 'Afternoon' | 'Night' {
  if (hour >= 6 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 19) return 'Afternoon';
  return 'Night';
}

interface WeatherPeriodKey {
  date: string;
  period: 'Morning' | 'Afternoon' | 'Night';
  walkingSeconds: number;
}

function relevantWalkingPeriods(at: Date, legs: CheckedPassLeg[]): WeatherPeriodKey[] {
  const totals = new Map<string, WeatherPeriodKey>();
  const add = (instant: Date, seconds: number) => {
    const { date, hour } = malaysiaParts(instant);
    const period = periodAt(hour);
    const key = `${date}:${period}`;
    const current = totals.get(key);
    totals.set(key, { date, period, walkingSeconds: (current?.walkingSeconds ?? 0) + seconds });
  };

  for (const leg of legs) {
    if (leg.mode !== 'WALK') continue;
    const start = leg.estimatedStartTime ? Date.parse(leg.estimatedStartTime) : NaN;
    const end = leg.estimatedEndTime ? Date.parse(leg.estimatedEndTime) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      add(at, leg.durationSeconds);
      continue;
    }
    for (let cursor = start; cursor < end;) {
      const local = malaysiaParts(new Date(cursor));
      const boundaryHour = local.hour < 6 ? 6 : local.hour < 12 ? 12 : local.hour < 19 ? 19 : 30;
      const boundaryDate = boundaryHour === 30
        ? malaysiaParts(new Date(Date.parse(`${local.date}T00:00:00+08:00`) + 86_400_000)).date
        : local.date;
      const boundaryClock = boundaryHour === 30 ? '06' : String(boundaryHour).padStart(2, '0');
      const boundary = Date.parse(`${boundaryDate}T${boundaryClock}:00:00+08:00`);
      const next = Math.min(end, boundary);
      add(new Date((cursor + next) / 2), (next - cursor) / 1000);
      cursor = next;
    }
  }
  if (totals.size === 0) add(at, 0);
  return [...totals.values()];
}

export async function fetchOfficialForecast(
  district: WeatherDistrict | null,
  signal?: AbortSignal,
): Promise<OfficialForecastSnapshot | null> {
  if (!district) return null;
  try {
    const params = new URLSearchParams({
      contains: `${district.id}@location__location_id`,
      limit: '14',
    });
    const response = await fetch(`/weather/forecast/?${params}`, { signal });
    if (!response.ok) return null;
    const data = await response.json() as unknown;
    if (!Array.isArray(data)) return null;
    return {
      district,
      rows: data.filter((row): row is ForecastRow => Boolean(row) && typeof row === 'object'),
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export function walkingWeatherFromForecast(
  at: string,
  legs: CheckedPassLeg[],
  forecast: OfficialForecastSnapshot | null,
): WeatherEvidence[] {
  const instant = new Date(at);
  if (!Number.isFinite(instant.getTime())) {
    return [{ status: 'not-checked', reason: 'outside-forecast-window', label: 'Weather unknown' }];
  }
  if (!forecast) {
    return [{ status: 'not-checked', reason: 'forecast-unavailable', label: 'Weather unknown' }];
  }
  const relevant = relevantWalkingPeriods(instant, legs);
  return relevant.map(({ date, period, walkingSeconds }): WeatherEvidence => {
    const row = forecast.rows.find(item =>
      item.date === date && item.location?.location_id === forecast.district.id,
    );
    const field = period === 'Morning' ? row?.morning_forecast : period === 'Afternoon' ? row?.afternoon_forecast : row?.night_forecast;
    if (typeof field !== 'string' || !field.trim()) {
      return { status: 'not-checked', reason: 'outside-forecast-window', label: 'Weather unknown' };
    }
    return {
      status: 'checked',
      period,
      summary: field.trim(),
      source: 'MET Malaysia via data.gov.my',
      sourceUrl: SOURCE_URL,
      location: typeof row?.location?.location_name === 'string' ? row.location.location_name : forecast.district.name,
      retrievedAt: forecast.retrievedAt,
      walkingSecondsInPeriod: Math.round(walkingSeconds),
    };
  });
}

export async function fetchWalkingWeather(
  at: string,
  legs: CheckedPassLeg[],
  district: WeatherDistrict | null,
  signal?: AbortSignal,
): Promise<WeatherEvidence[]> {
  return walkingWeatherFromForecast(at, legs, await fetchOfficialForecast(district, signal));
}
