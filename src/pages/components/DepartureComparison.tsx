import { Polygon, Tooltip } from 'react-leaflet';
import * as clipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';
import { loadEssentialServices } from '@/shared/data/adapters/essentialServicesAdapter';
import { CATEGORY_META, CATEGORY_ORDER } from '@/shared/data';
import { overlapContains } from '@/features/meeting-point/overlapService';
import { deduplicateServices } from '@/features/essential-services/serviceDataRules';
const polygonOps = (clipping as unknown as { default?: typeof clipping }).default ?? clipping;
export function compareCoverage(a: IsochroneRegion[], b: IsochroneRegion[]) {
  const left: MultiPolygon = a.map(region => [region.outer, ...region.holes]);
  const right: MultiPolygon = b.map(region => [region.outer, ...region.holes]);
  const both = left.length && right.length ? polygonOps.intersection(left, right) : [];
  const onlyA = left.length ? right.length ? polygonOps.difference(left, right) : left : [];
  const onlyB = right.length ? left.length ? polygonOps.difference(right, left) : right : [];
  const inA = overlapContains(left); const inB = overlapContains(right);
  const services = deduplicateServices(loadEssentialServices());
  const counts = CATEGORY_ORDER.map(category => {
    const rows = services.filter(service => service.category === category && service.lat !== undefined && service.lon !== undefined);
    const aCount = rows.filter(service => inA(service.lat!, service.lon!)).length;
    const bCount = rows.filter(service => inB(service.lat!, service.lon!)).length;
    return { category, a: aCount, b: bCount, both: rows.filter(service => inA(service.lat!, service.lon!) && inB(service.lat!, service.lon!)).length, neither: rows.filter(service => !inA(service.lat!, service.lon!) && !inB(service.lat!, service.lon!)).length };
  });
  return { both, onlyA, onlyB, counts };
}
export function DepartureComparisonLayer({ coverage }: { coverage: ReturnType<typeof compareCoverage> }) {
  return <>{([{ polygons: coverage.onlyA, color: '#ffb454', label: 'Baseline only' }, { polygons: coverage.onlyB, color: '#a989ff', label: 'Selected time only' }, { polygons: coverage.both, color: '#32cab7', label: 'Both departure times' }]).flatMap(group => group.polygons.map((polygon, i) => <Polygon key={`${group.label}-${i}`} positions={polygon.map(ring => ring.map(([lon, lat]) => [lat, lon] as [number, number]))} pathOptions={{ color: group.color, fillColor: group.color, fillOpacity: .24, weight: 2 }}><Tooltip>{group.label}</Tooltip></Polygon>))}</>;
}
export function DepartureComparisonSummary({ coverage }: { coverage: ReturnType<typeof compareCoverage> }) {
  return <div className="departure-counts"><p>Map: <span style={{ color: '#ffb454' }}>baseline only</span> · <span style={{ color: '#a989ff' }}>selected only</span> · <span style={{ color: '#32cab7' }}>both</span>. Outside both boundaries: neither.</p>
    <table><caption>Reachable services — same origin and budget</caption><thead><tr><th>Category</th><th>Base</th><th>Now</th><th>Δ</th><th>Both</th><th>Neither</th></tr></thead><tbody>{coverage.counts.map(row => <tr key={row.category}><th>{CATEGORY_META[row.category].label}</th><td>{row.a}</td><td>{row.b}</td><td>{row.b - row.a}</td><td>{row.both}</td><td>{row.neither}</td></tr>)}</tbody></table>
    <p>Counts describe geographic reach, not confirmed opening hours. Neither counts refer to the loaded service dataset. No departure is universally best.</p>
  </div>;
}
