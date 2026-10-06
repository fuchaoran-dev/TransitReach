import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { ModelledJourney } from '@/features/interchange/types';
import type { MultiPolygon } from 'polygon-clipping';

export interface DepartureCoverage { onlyA: MultiPolygon; onlyB: MultiPolygon; both: MultiPolygon }

/** Share the same baseline/selected/overlap colours in the 2D and 3D views. */
export function updateCoverageScene(map: Map, coverage: DepartureCoverage | null) {
  const data: FeatureCollection = { type: 'FeatureCollection', features: coverage ? [
    { polygons: coverage.onlyA, color: '#ffb454' },
    { polygons: coverage.onlyB, color: '#a989ff' },
    { polygons: coverage.both, color: '#32cab7' },
  ].flatMap(group => group.polygons.map(coordinates => ({ type: 'Feature' as const, properties: { color: group.color }, geometry: { type: 'Polygon' as const, coordinates } }))) : [] };
  const source = map.getSource('departure-coverage') as GeoJSONSource | undefined;
  if (source) source.setData(data); else map.addSource('departure-coverage', { type: 'geojson', data });
  if (!map.getLayer('departure-coverage-fill')) {
    map.addLayer({ id: 'departure-coverage-fill', type: 'fill', source: 'departure-coverage', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': .24 } }, map.getLayer('location-pins') ? 'location-pins' : undefined);
    map.addLayer({ id: 'departure-coverage-edge', type: 'line', source: 'departure-coverage', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } }, map.getLayer('location-pins') ? 'location-pins' : undefined);
  }
}

/** Routes use native geographic coordinates, never screen-space tilted Leaflet paths. */
export function updateJourneyScene(map: Map, journey: ModelledJourney | null, highlightedLeg: string | null) {
  const paths: FeatureCollection = { type: 'FeatureCollection', features: (journey?.legs ?? []).filter(leg => leg.geometry.length > 1).map(leg => ({
    type: 'Feature', properties: { walk: leg.mode === 'WALK', color: leg.mode === 'WALK' ? '#34c9b5' : leg.mode === 'BUS' ? '#397eff' : leg.routeColor ?? '#a879ff', opacity: highlightedLeg && highlightedLeg !== leg.id ? .25 : 1 },
    geometry: { type: 'LineString', coordinates: leg.geometry.map(point => [point.lon, point.lat]) },
  })) };
  const stops: FeatureCollection = { type: 'FeatureCollection', features: (journey?.legs ?? []).filter(leg => leg.transitLeg).flatMap(leg => [leg.from, leg.to].map(point => ({
    type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [point.lon, point.lat] },
  }))) };
  const setSource = (name: string, data: FeatureCollection) => {
    const source = map.getSource(name) as GeoJSONSource | undefined;
    if (source) source.setData(data); else map.addSource(name, { type: 'geojson', data });
  };
  setSource('journey-paths', paths); setSource('journey-stops', stops);
  const endpoints: FeatureCollection = { type: 'FeatureCollection', features: journey?.legs.length ? [
    { type: 'Feature', properties: { color: '#34c9b5' }, geometry: { type: 'Point', coordinates: [journey.legs[0].from.lon, journey.legs[0].from.lat] } },
    { type: 'Feature', properties: { color: '#f46a85' }, geometry: { type: 'Point', coordinates: [journey.legs[journey.legs.length - 1].to.lon, journey.legs[journey.legs.length - 1].to.lat] } },
  ] : [] };
  setSource('journey-endpoints', endpoints);
  if (!map.getLayer('journey-rides')) {
    map.addLayer({ id: 'journey-rides', type: 'line', source: 'journey-paths', filter: ['==', ['get', 'walk'], false], paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': ['get', 'opacity'] } });
    map.addLayer({ id: 'journey-walks', type: 'line', source: 'journey-paths', filter: ['==', ['get', 'walk'], true], paint: { 'line-color': '#34c9b5', 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': ['get', 'opacity'] } });
    map.addLayer({ id: 'journey-stations', type: 'circle', source: 'journey-stops', paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#287caf' } });
    map.addLayer({ id: 'journey-endpoints', type: 'circle', source: 'journey-endpoints', paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
  }
}
