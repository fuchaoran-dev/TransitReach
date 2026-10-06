import { createContext, useEffect, useState } from 'react';
export const MapDaylight = createContext(false);
export function malaysiaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
export type WeatherDay = { date: string; code: number; high: number; low: number; morning: string; afternoon: string; night: string; summary: string; location: string };
export function weatherKind(code: number): 'sunny' | 'cloudy' | 'rainy' | 'storm' { return code >= 95 ? 'storm' : code >= 51 ? 'rainy' : code >= 2 ? 'cloudy' : 'sunny'; }
export function forecastCode(summary: string) { const value = summary.toLowerCase(); return value.includes('ribut') ? 95 : value.includes('tiada hujan') ? 0 : value.includes('hujan') ? 61 : 3; }
export function forecastPeriod(clock: string) {
  const hour = Number(clock.slice(0, 2)); const period = hour >= 6 && hour < 12 ? 'Morning' : hour >= 12 && hour < 19 ? 'Afternoon' : 'Night';
  return period;
}
export function periodForecast(day: WeatherDay, clock: string) {
  const period = forecastPeriod(clock);
  return { period, summary: period === 'Morning' ? day.morning : period === 'Afternoon' ? day.afternoon : day.night };
}
/** Validate the upstream response before any date or temperature reaches the UI. */
export function parseWeatherForecast(data: unknown, today: string): WeatherDay[] {
  if (!Array.isArray(data)) throw new Error('Invalid forecast');
  const days = new Map<string, WeatherDay>();
  for (const row of data) {
    if (!row || row.location?.location_id !== 'Ds058' || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date < today || row.date > addDays(today, 6)) continue;
    if (!Number.isFinite(row.max_temp) || !Number.isFinite(row.min_temp) || row.min_temp > row.max_temp || ![row.morning_forecast, row.afternoon_forecast, row.night_forecast].every(value => typeof value === 'string' && value.trim())) throw new Error('Incomplete forecast');
    days.set(row.date, { date: row.date, code: forecastCode(typeof row.summary_forecast === 'string' ? row.summary_forecast : ''), high: row.max_temp, low: row.min_temp, morning: row.morning_forecast, afternoon: row.afternoon_forecast, night: row.night_forecast, summary: typeof row.summary_forecast === 'string' ? row.summary_forecast : '', location: row.location.location_name });
  }
  if (!days.size) throw new Error('Incomplete forecast');
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function useWeatherForecast() {
  const [days, setDays] = useState<WeatherDay[]>([]); const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const refresh = setInterval(() => setRetry(value => value + 1), 15 * 60 * 1000);
    return () => clearInterval(refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000); let active = true;
    // Keep the current outlook during a background refresh to avoid switching
    // the entire map to "weather unknown" every fifteen minutes.
    setStatus('loading');
    fetch('/weather/forecast/?contains=Ds058@location__location_id&limit=14', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Official forecast unavailable');
        const parsed = parseWeatherForecast(await response.json(), malaysiaToday());
        if (active) { setDays(parsed); setRetrievedAt(new Date().toISOString()); setStatus('ready'); }
      }).catch(() => { if (active) { setDays([]); setRetrievedAt(null); setStatus('error'); } }).finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [retry]);
  return { days, status, retrievedAt, retry: () => setRetry(value => value + 1) };
}
export function WeatherPlanningBar({ forecast, date, clock = '09:00', onDateChange, supportedDates }: { forecast: ReturnType<typeof useWeatherForecast>; date: string; clock?: string; onDateChange: (date: string) => void; supportedDates?: string[] }) {
  return <section className="weather-planning-bar glass" aria-label="Seven-day official weather forecast">
    <div className="weather-bar-title">
      <strong>7-day weather · {forecastPeriod(clock)}</strong>
      <details className="weather-forecast-details">
        <summary>Details</summary>
        <div className="weather-forecast-popover">
          <a href="https://developer.data.gov.my/realtime-api/weather" target="_blank" rel="noreferrer" title="Official Kuala Lumpur district forecast">MET Malaysia ↗</a>
          <small>Kuala Lumpur district · morning / afternoon / night, not route-level rain. Source issue time unavailable.{forecast.retrievedAt && ` Retrieved ${new Date(forecast.retrievedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })} MYT.`}</small>
        </div>
      </details>
    </div>
    {forecast.status === 'loading' && !forecast.days.length && <p role="status">Loading official regional forecast…</p>}
    {forecast.status === 'error' && <p role="alert">Official forecast unknown. Departure planning still works. <button onClick={forecast.retry}>Retry</button></p>}
    <div className="weather-days">{forecast.days.map(day => {
      const period = periodForecast(day, clock);
      const kind = weatherKind(forecastCode(period.summary));
      const icon = kind === 'sunny' ? '☀️' : kind === 'rainy' ? '🌧️' : kind === 'storm' ? '⛈️' : '☁️';
      const label = kind === 'sunny' ? 'No rain forecast' : kind === 'storm' ? 'Thunderstorms' : kind === 'rainy' ? 'Rain' : 'Cloudy / unknown';
      const unsupported = Boolean(supportedDates && !supportedDates.includes(day.date));
      const tooltip = `${day.date} · ${period.period}: ${label} · ${day.low}–${day.high}°C\n${day.summary}\nMorning: ${day.morning}\nAfternoon: ${day.afternoon}\nNight: ${day.night}${unsupported ? '\nOutside the loaded transit timetable; routing unavailable.' : ''}`;
      return <button key={day.date} disabled={supportedDates && !supportedDates.includes(day.date)} aria-label={`${day.date}, ${label}, ${day.low} to ${day.high} degrees Celsius`} aria-pressed={date === day.date} className="weather-day" onClick={() => onDateChange(day.date)} title={tooltip}>
        <span className="weather-day-icon" aria-hidden="true">{icon}</span>
        <span>{new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</span>
      </button>;
    })}</div>
  </section>;
}
