/** Decorative only: never changes forecast data or route geometry. */
export function WeatherAtmosphere() {
  return <div className="weather-atmosphere" aria-hidden="true">
    <div className="weather-sun-rays" />
    <div className="weather-cloud weather-cloud-one" /><div className="weather-cloud weather-cloud-two" />
    <div className="weather-rain-sheet" />
    <div className="weather-lightning-illumination" />
    <div className="weather-moonlight" />
  </div>;
}
