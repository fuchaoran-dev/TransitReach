import { useEffect, useMemo } from 'react';
import {
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { ServiceLocation } from '@/shared/types/service';
import type { JourneyLeg, ModelledJourney } from '../types';
import { displayModeLabel } from '../interchangeService';

interface Props {
  journey: ModelledJourney;
  destination: ServiceLocation;
  /** A leg to emphasise, from Journey Detail; the others are dimmed while it is set. */
  highlightedLegId?: string | null;
}

/** Unselected journeys in the list view: present, but quiet enough not to compete. */
const PREVIEW_COLOR = '#94a3b8';

function legColor(mode: string, routeColor: string | null): string {
  if (mode === 'WALK') return '#0f766e';
  return routeColor ?? '#2563eb';
}

function legLabel(leg: JourneyLeg): string {
  return leg.mode === 'WALK'
    ? `Walk · ${Math.ceil(leg.durationSeconds / 60)} min`
    : `${leg.routeLongName ?? leg.routeShortName ?? displayModeLabel(leg)} · ${Math.ceil(leg.durationSeconds / 60)} min`;
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

export function JourneyMapLayer({ journey, destination, highlightedLegId = null }: Props) {
  const allPoints = useMemo(
    () => journey.legs.flatMap(leg => leg.geometry),
    [journey],
  );
  useFitTo(allPoints);

  return (
    <>
      {journey.legs.map(leg => {
        if (leg.geometry.length < 2) return null;
        const walking = leg.mode === 'WALK';
        const emphasised = leg.id === highlightedLegId;
        const dimmed = highlightedLegId !== null && !emphasised;
        return (
          <Polyline
            key={leg.id}
            positions={toPositions(leg.geometry)}
            // A leg is inspected, not a new starting point: keep the click off the map.
            bubblingMouseEvents={false}
            pathOptions={{
              color: legColor(leg.mode, leg.routeColor),
              weight: (walking ? 4 : 6) + (emphasised ? 3 : 0),
              opacity: dimmed ? 0.3 : 0.95,
              dashArray: walking ? '8 7' : undefined,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          >
            <Tooltip sticky>{legLabel(leg)}</Tooltip>
          </Polyline>
        );
      })}

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

      {highlighted &&
        highlighted.legs.map(leg =>
          leg.geometry.length < 2 ? null : (
            <Polyline
              key={`highlight-${leg.id}`}
              positions={toPositions(leg.geometry)}
              bubblingMouseEvents={false}
              pathOptions={{
                color: legColor(leg.mode, leg.routeColor),
                weight: leg.mode === 'WALK' ? 5 : 7,
                opacity: 1,
                dashArray: leg.mode === 'WALK' ? '8 7' : undefined,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              eventHandlers={{
                // Re-asserted on each leg, so moving from one leg to the next along the
                // same journey does not drop the highlight in between.
                mouseover: () => onHighlight(highlighted.id),
                mouseout: () => onHighlight(null),
                click: () => onSelect(highlighted.id),
              }}
            >
              <Tooltip sticky>{legLabel(leg)}</Tooltip>
            </Polyline>
          ),
        )}

      <DestinationMarker destination={destination} />
    </>
  );
}
