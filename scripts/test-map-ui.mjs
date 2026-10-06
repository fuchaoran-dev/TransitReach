import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const Module = require('node:module');
async function load(entry) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], logLevel: 'silent' });
  const module = new Module(`${process.cwd()}/scripts/ui-fixture.cjs`);
  module.filename = `${process.cwd()}/scripts/ui-fixture.cjs`;
  module.paths = Module._nodeModulePaths(process.cwd());
  module._compile(output.outputFiles[0].text, module.filename);
  return module.exports;
}
const weather = await load('src/pages/components/WeatherPlanning.tsx');
const day = { date: '2026-10-05', code: 95, low: 24, high: 33, summary: 'Ribut petir', morning: 'Tiada Hujan', afternoon: 'Ribut petir', night: 'Hujan', location: 'Kuala Lumpur' };
let checks = 0;
for (const [clock, period, label, icon] of [['09:00', 'Morning', 'No rain forecast', '☀️'], ['13:00', 'Afternoon', 'Thunderstorms', '⛈️'], ['20:00', 'Night', 'Rain', '🌧️']]) {
  const markup = renderToStaticMarkup(React.createElement(weather.WeatherPlanningBar, { forecast: { days: [day], status: 'ready', retrievedAt: null, retry() {} }, date: day.date, clock, supportedDates: [day.date], onDateChange() {} }));
  assert.ok(markup.includes(period)); assert.ok(markup.includes(label)); assert.ok(markup.includes(icon));
  assert.ok(markup.includes('aria-pressed="true"')); checks += 4;
}
const disabled = renderToStaticMarkup(React.createElement(weather.WeatherPlanningBar, { forecast: { days: [day], status: 'ready', retrievedAt: null, retry() {} }, date: day.date, supportedDates: [], onDateChange() {} }));
assert.ok(disabled.includes('disabled=""')); checks++;
assert.ok(disabled.includes('class="weather-forecast-details"'));
assert.ok(disabled.includes('class="weather-forecast-popover"'));
assert.ok(disabled.includes('MET Malaysia'));
assert.ok(disabled.includes('not route-level rain')); checks += 4;
const forecastRow = { date: day.date, location: { location_id: 'Ds058', location_name: 'Kuala Lumpur' }, max_temp: 33, min_temp: 24, morning_forecast: 'Tiada Hujan', afternoon_forecast: 'Ribut petir', night_forecast: 'Hujan', summary_forecast: 'Ribut petir' };
const parsed = weather.parseWeatherForecast([null, { ...forecastRow, date: '2026-10-10' }, { ...forecastRow, location: { location_id: 'Other' } }, forecastRow, forecastRow], '2026-10-03');
assert.equal(parsed.length, 1); assert.equal(parsed[0].date, day.date);
assert.throws(() => weather.parseWeatherForecast({}, '2026-10-03'));
assert.throws(() => weather.parseWeatherForecast([], '2026-10-03'));
assert.throws(() => weather.parseWeatherForecast([{ ...forecastRow, max_temp: '33' }], '2026-10-03'));
assert.throws(() => weather.parseWeatherForecast([{ ...forecastRow, min_temp: 40 }], '2026-10-03'));
assert.throws(() => weather.parseWeatherForecast([{ ...forecastRow, afternoon_forecast: {} }], '2026-10-03'));
assert.equal(weather.forecastCode('Ribut petir, tiada hujan di tempat lain'), 95); checks += 8;
const refreshing = renderToStaticMarkup(React.createElement(weather.WeatherPlanningBar, { forecast: { days: [day], status: 'loading', retrievedAt: null, retry() {} }, date: day.date, onDateChange() {} }));
assert.ok(!refreshing.includes('Loading official regional forecast')); checks++;
const { WeatherAtmosphere } = await load('src/pages/components/WeatherAtmosphere.tsx');
const atmosphere = renderToStaticMarkup(React.createElement(WeatherAtmosphere));
assert.ok(!atmosphere.includes('<svg')); assert.ok(!atmosphere.includes('class="weather-sun"')); assert.ok(!atmosphere.includes('class="weather-moon"')); checks += 3;
console.log(`Desktop weather UI render checks passed: ${checks}. Synthetic fixtures, not live forecasts.`);
