import { Fragment, useEffect, useMemo } from 'react';
import {
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { latLngBounds, type LeafletEventHandlerFnMap } from 'leaflet';
import type { ServiceLocation } from '@/shared/types/service';
import type { WalkStep } from '@/shared/services/transitRoutingClient';
import type { JourneyLeg, ModelledJourney } from '../types';
import { describeStep, legTitle } from '../interchangeService';

interface Props {
  journey: ModelledJourney;
  destination: ServiceLocation;
  /** A leg to emphasise, from Journey Detail; the others are dimmed while it is set. */
  highlightedLegId?: string | null;
  /** A walking step clicked in Journey Detail: the map moves to it and marks the spot. */
  focusedStep?: WalkStep | null;
}

/** Flies to a clicked walking step, close enough to see the turn it describes. */
function StepFocus({ step }: { step: WalkStep }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([step.lat, step.lon], Math.max(map.getZoom(), 18), { duration: 0.6 });
  }, [step, map]);
  return (
    <CircleMarker
      center={[step.lat, step.lon]}
      radius={8}
      pathOptions={{ color: '#0f766e', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }}
    >
      <Tooltip direction="top" permanent>{describeStep(step)}</Tooltip>
    </CircleMarker>
  );
}

/** Unselected journeys in the list view: present, but quiet enough not to compete. */
const PREVIEW_COLOR = '#94a3b8';

/**
 * How each mode is drawn. Colour and line style carry the mode, so a journey reads at a
 * glance without the legend:
 *
 *   walk   teal, dashed — the rider's own effort, the same teal as the first-mile walk
 *   rail   the line's own colour, solid — the colours riders know from station signage
 *   bus    one blue for every bus, solid, cased in white — buses have no colours a rider
 *          recognises (the trunk feed paints them all the same blue and the feeder feed
 *          gives none), and the white casing keeps a bus apart from a blue rail line
 */
const WALK_COLOR = '#0f766e';
const BUS_COLOR = '#1d4ed8';
const RAIL_FALLBACK_COLOR = '#7c3aed';

function legColor(leg: JourneyLeg): string {
  if (leg.mode === 'WALK') return WALK_COLOR;
  if (leg.mode === 'BUS') return BUS_COLOR;
  return leg.routeColor ?? RAIL_FALLBACK_COLOR;
}

function legLabel(leg: JourneyLeg): string {
  return `${legTitle(leg)} · ${Math.ceil(leg.durationSeconds / 60)} min`;
}

function toPositions(points: Array<{ lat: number; lon: number }>): [number, number][] {
  return points.map(point => [point.lat, point.lon]);
}

/** Fits the map to a set of points whenever the set itself changes. */
function useFitTo(points: Array<{ lat: number; lon: number }>) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(latLngBounds(toPositions(points)), { padding: [70, 70], maxZoom: 16 });
  }, [points, map]);
}

/** One leg in its mode's style; a bus gets its white casing drawn underneath. */
function LegPath({
  leg,
  weight,
  opacity,
  eventHandlers,
}: {
  leg: JourneyLeg;
  weight: number;
  opacity: number;
  eventHandlers?: LeafletEventHandlerFnMap;
}) {
  const positions = toPositions(leg.geometry);
  const walking = leg.mode === 'WALK';
  return (
    <>
      {leg.mode === 'BUS' && (
        <Polyline
          positions={positions}
          interactive={false}
          pathOptions={{ color: '#ffffff', weight: weight + 4, opacity, lineCap: 'round', lineJoin: 'round' }}
        />
      )}
      <Polyline
        positions={positions}
        // A leg is inspected, not a new starting point: keep the click off the map.
        bubblingMouseEvents={false}
        pathOptions={{
          color: legColor(leg),
          weight,
          opacity,
          dashArray: walking ? '8 7' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
        }}
        eventHandlers={eventHandlers}
      >
        <Tooltip sticky>{legLabel(leg)}</Tooltip>
      </Polyline>
    </>
  );
}

/**
 * Where each ride starts and ends: a ring in the ride's colour at the boarding and
 * alighting stop. Without them a journey's transit is a line with no visible doors — the
 * rider could not tell from the map which stop to wait at.
 */
function BoardAlightMarkers({ legs }: { legs: JourneyLeg[] }) {
  return (
    <>
      {legs.filter(leg => leg.transitLeg && leg.mode !== 'WALK').map(leg => (
        <Fragment key={`stops-${leg.id}`}>
          {[['Board', leg.from], ['Alight at', leg.to]].map(([verb, point]) => {
            const place = point as JourneyLeg['from'];
            return (
              <CircleMarker
                key={verb as string}
                center={[place.lat, place.lon]}
                radius={5}
                bubblingMouseEvents={false}
                pathOptions={{ color: legColor(leg), weight: 3, fillColor: '#ffffff', fillOpacity: 1 }}
              >
                <Tooltip direction="top">
                  {verb === 'Board' ? `Board ${legTitle(leg)} at ${place.name}` : `Alight at ${place.name}`}
                </Tooltip>
              </CircleMarker>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}

function DestinationMarker({ destination }: { destination: ServiceLocation }) {
  if (destination.lat === undefined || destination.lon === undefined) return null;
  return (
    <CircleMarker
      center={[destination.lat, destination.lon]}
      radius={9}
      pathOptions={{
        color: '#ffffff',
        weight: 3,
        fillColor: '#be123c',
        fillOpacity: 1,
      }}
    >
      <Tooltip direction="top" permanent={false}>
        {destination.name}
      </Tooltip>
    </CircleMarker>
  );
}

export function JourneyMapLayer({ journey, destination, highlightedLegId = null, focusedStep = null }: Props) {
  const allPoints = useMemo(
    () => journey.legs.flatMap(leg => leg.geometry),
    [journey],
  );
  useFitTo(allPoints);

  return (
    <>
      {journey.legs.map(leg => {
        if (leg.geometry.length < 2) return null;
        const emphasised = leg.id === highlightedLegId;
        const dimmed = highlightedLegId !== null && !emphasised;
        return (
          <LegPath
            key={leg.id}
            leg={leg}
            weight={(leg.mode === 'WALK' ? 4 : 6) + (emphasised ? 3 : 0)}
            opacity={dimmed ? 0.3 : 0.95}
          />
        );
      })}

      <BoardAlightMarkers legs={journey.legs} />

      {journey.interchanges.map(interchange => {
        const toLeg = journey.legs[interchange.toLegIndex];
        return (
          <CircleMarker
            key={interchange.id}
            center={[toLeg.from.lat, toLeg.from.lon]}
            radius={6}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: '#d97706',
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="top">
              Estimated interchange · {Math.ceil(interchange.estimatedDurationSeconds / 60)} min
            </Tooltip>
          </CircleMarker>
        );
      })}

      <DestinationMarker destination={destination} />
      {focusedStep && <StepFocus step={focusedStep} />}
    </>
  );
}

interface PreviewProps {
  journeys: ModelledJourney[];
  destination: ServiceLocation;
  highlightedJourneyId: string | null;
  onHighlight: (journeyId: string | null) => void;
  onSelect: (journeyId: string) => void;
}

/**
 * The journey list, on the map. Every modelled journey is drawn faintly so the rider can
 * see how the options differ on the ground — which one walks further, which goes round —
 * before choosing. The one under the pointer, in the list or on the map, is drawn in its
 * real colours on top; clicking a line opens it, as clicking its card does.
 */
export function JourneyPreviewLayer({
  journeys,
  destination,
  highlightedJourneyId,
  onHighlight,
  onSelect,
}: PreviewProps) {
  const allPoints = useMemo(
    () => journeys.flatMap(journey => journey.legs.flatMap(leg => leg.geometry)),
    [journeys],
  );
  useFitTo(allPoints);

  const highlighted = journeys.find(journey => journey.id === highlightedJourneyId) ?? null;

  return (
    <>
      {journeys.map(journey =>
        journey.id === highlightedJourneyId ? null : (
          journey.legs.map(leg =>
            leg.geometry.length < 2 ? null : (
              <Polyline
                key={`${journey.id}-${leg.id}`}
                positions={toPositions(leg.geometry)}
                bubblingMouseEvents={false}
                pathOptions={{
                  color: PREVIEW_COLOR,
                  weight: leg.mode === 'WALK' ? 3 : 5,
                  opacity: 0.7,
                  dashArray: leg.mode === 'WALK' ? '6 6' : undefined,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
                eventHandlers={{
                  mouseover: () => onHighlight(journey.id),
                  click: () => onSelect(journey.id),
                }}
              />
            ),
          )
        ),
      )}

      {highlighted && (
        <>
          {highlighted.legs.map(leg =>
            leg.geometry.length < 2 ? null : (
              <LegPath
                key={`highlight-${leg.id}`}
                leg={leg}
                weight={leg.mode === 'WALK' ? 5 : 7}
                opacity={1}
                eventHandlers={{
                  // Re-asserted on each leg, so moving from one leg to the next along the
                  // same journey does not drop the highlight in between.
                  mouseover: () => onHighlight(highlighted.id),
                  mouseout: () => onHighlight(null),
                  click: () => onSelect(highlighted.id),
                }}
              />
            ),
          )}
          <BoardAlightMarkers legs={highlighted.legs} />
        </>
      )}

      <DestinationMarker destination={destination} />
    </>
  );
}

/**
 * What the journey drawing means, shown whenever journeys are on the map. Line style and
 * colour carry the mode, but nothing tells a first-time reader that dashed is walking or
 * that the cased blue line is a bus; this does.
 */
export function JourneyLegend() {
  const line = (style: React.CSSProperties) => (
    <span className="inline-block w-7 shrink-0" style={{ height: 0, ...style }} />
  );
  const dot = (fill: string, ring: string) => (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: 10, height: 10, background: fill, border: `2.5px solid ${ring}` }}
    />
  );
  const rows: Array<[React.ReactNode, string]> = [
    [line({ borderTop: `3px dashed ${WALK_COLOR}` }), 'Walk'],
    [line({ borderTop: '5px solid #d50032' }), 'Rail, in its line colour'],
    [
      line({ borderTop: `5px solid ${BUS_COLOR}`, boxShadow: '0 0 0 2px #ffffff, 0 0 0 3px #cbd5e1' }),
      'Bus',
    ],
    [dot('#ffffff', '#475569'), 'Board / alight'],
    [dot('#d97706', '#ffffff'), 'Interchange'],
    [dot('#be123c', '#ffffff'), 'Destination'],
  ];
  return (
    <div className="glass rounded-xl px-3 py-2 text-[11px] text-slate-600 space-y-1 pointer-events-none">
      {rows.map(([swatch, label]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="flex w-7 justify-center">{swatch}</span>
          {label}
        </div>
      ))}
    </div>
  );
}
