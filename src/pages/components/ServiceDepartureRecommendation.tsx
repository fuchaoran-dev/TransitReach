import type { DepartureRecommendationModel } from '@/features/time-planning/useDepartureRecommendation';
import type { PlanningPreference } from '@/features/time-planning/planningService';

const caption = (time: string) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur',
}).format(new Date(`${time}:00+08:00`));

/** A compact next action for the already-selected destination, not a second form. */
export function ServiceDepartureRecommendation({ model: m, onApply }: {
  model: DepartureRecommendationModel; onApply: (departure: string) => void;
}) {
  const best = m.recommended;
  const feasible = m.options.filter(option => option.availability === 'available');
  const allWet = feasible.length > 0 && feasible.every(option => option.weatherComplete && (option.weather === 'rain' || option.weather === 'storm'));
  return <section className="service-departure-recommendation departure-planner" aria-label="Suggested departure">
    <h3>Suggested departure</h3>
    <p className="departure-window-label">{m.windowLabel}</p>
    {m.status === 'checking' && <div role="status" className="planning-progress">{m.progress || 'Checking departure times…'}<button className="planning-link" onClick={m.cancel}>Cancel</button></div>}
    {m.blocked && <p role="status">{m.blocked}</p>}
    {(m.status === 'cancelled' || m.status === 'error') && <p role="status">{m.error ?? 'Checks cancelled.'} <button className="planning-link" onClick={m.retry}>Retry</button></p>}
    {best && <article className="recommended-departure" aria-live="polite">
      <strong>{caption(best.departure)} MYT</strong>
      <div className="recommendation-metrics"><span>{Math.ceil(best.travelMinutes!)} min incl. wait</span><span>{Math.ceil(best.walkMinutes!)} min walk</span><span>{best.transfers} transfers</span></div>
      <p>Estimated open at arrival · {m.effectivePreference === 'avoid-rain' ? 'Lower forecast rain exposure' : m.effectivePreference === 'less-walking' ? 'Less walking' : 'Shorter journey'}</p>
      <p>{m.routeOnly ? 'Weather not included · route and opening hours only.' : best.weatherLabel}</p>
      {!m.routeOnly && !best.weatherComplete && <p className="weather-caution">Incomplete forecast coverage; not a verified dry-weather choice.</p>}
      {(best.weather === 'rain' || best.weather === 'storm') && <p className="weather-caution">{allWet ? 'All eligible checked times include rain or thunderstorms. For a flexible outing, try another window.' : 'Walking overlaps forecast rain or thunderstorms. Consider another window for a flexible outing.'}</p>}
      <button className="btn-primary" onClick={() => m.apply(best, onApply)}>Use this time</button>
    </article>}
    {m.status === 'ready' && !best && <p role="status">No suitable departure with sufficient evidence in this window. Unknown data is not a confirmed feasible result. <button className="planning-link" onClick={m.retry}>Recheck</button></p>}
    {(m.status === 'ready' && !best || m.blocked.startsWith('No future')) && m.singleDay && m.dates.length > 1 && <button className="btn-secondary" onClick={m.expandSevenDays}>View next seven days</button>}
    {m.options.length > 0 && <details className="planning-disclosure departure-other-times"><summary>Other times ({m.ranked.length} eligible)</summary>
      <ul className="departure-alternatives">{m.options.map(option => <li key={option.departure}><strong>{caption(option.departure)}</strong><small>{option.availability === 'available' ? `${Math.ceil(option.travelMinutes!)} min travel · ${Math.ceil(option.walkMinutes!)} min walk · ${m.routeOnly ? 'Weather not included' : option.weatherLabel}` : option.reason}</small>{m.ranked.includes(option) && <button className="planning-link" onClick={() => m.apply(option, onApply)}>Use alternative</button>}</li>)}</ul>
      {best && m.fastest && best.travelMinutes! > m.fastest.travelMinutes! && <p>Trade-off: {Math.ceil(best.travelMinutes! - m.fastest.travelMinutes!)} min longer than the fastest checked choice.</p>}
      <p>Best among hourly candidates, not a globally optimal time. Initial waiting is included; venue hours and travel times are estimates. This is a single-destination journey.</p>
    </details>}
    <details className="planning-disclosure departure-adjust"><summary>Adjust window & preference</summary>
      <div className="planning-fields"><label>First day<select aria-label="First recommendation day" value={m.fromDate} onChange={event => m.setFromDate(event.target.value)}>{m.dates.map(date => <option key={date}>{date}</option>)}</select></label><label>Last day<select aria-label="Last recommendation day" value={m.toDate} onChange={event => m.setToDate(event.target.value)}>{m.dates.map(date => <option key={date}>{date}</option>)}</select></label></div>
      <div className="planning-fields"><label>Earliest<input aria-label="Earliest recommended departure" type="time" value={m.fromClock} onChange={event => m.setFromClock(event.target.value)} /></label><label>Latest<input aria-label="Latest recommended departure" type="time" value={m.toClock} onChange={event => m.setToClock(event.target.value)} /></label></div>
      <label>Priority<select aria-label="Departure recommendation priority" value={m.preference} onChange={event => m.setPreference(event.target.value as PlanningPreference)}><option value="avoid-rain">Avoid rain during walking</option><option value="less-walking">Less walking</option><option value="fastest">Shorter journey</option></select></label>
      <label className="weather-scope-choice"><input type="checkbox" checked={m.weatherConfirmed} onChange={event => m.confirmWeather(event.target.checked)} />Use {m.weatherDistrictName} regional outlook for this trip</label>
      <p>Select a relevant district in Weather → Details, then confirm it here. Regional periods, not hourly or street-level rain.{m.weatherRetrievedAt && ` Retrieved ${new Date(m.weatherRetrievedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })} MYT.`}</p>
      {m.routeOnly && m.preference === 'avoid-rain' && <p>Weather not included. Until a relevant forecast is confirmed and available, suggestions use less walking instead.</p>}
      <p>Automatic checks use hourly departures inside the loaded timetable and next seven days. Past times are excluded. Apply a suggestion to change the map departure.</p>
      <button className="planning-link" onClick={m.resetWindow}>Reset to selected day · 18:00–21:00</button>
    </details>
  </section>;
}
