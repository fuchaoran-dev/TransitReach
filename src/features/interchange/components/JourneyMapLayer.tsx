import { useEffect, useMemo } from 'react';
import {
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { ServiceLocation } from '@/shared/types/service';
import type { ModelledJourney } from '../types';
import { displayModeLabel } from '../interchangeService';

interface Props {
  journey: ModelledJourney;
  destination: ServiceLocation;
}

function legColor(mode: string, routeColor: string | null): string {
  if (mode === 'WALK') return '#0f766e';
  return routeColor ?? '#2563eb';
}

export function JourneyMapLayer({ journey, destination }: Props) {
  const map = useMap();

  const allPoints = useMemo(
    () => journey.legs.flatMap(leg => leg.geometry),
    [journey],
  );

  useEffect(() => {
    if (allPoints.length < 2) return;
    const bounds = latLngBounds(
      allPoints.map(point => [point.lat, point.lon] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 16 });
  }, [allPoints, map]);

  return (
    <>
      {journey.legs.map(leg => {
        if (leg.geometry.length < 2) return null;
        const walking = leg.mode === 'WALK';
        return (
          <Polyline
            key={leg.id}
            positions={leg.geometry.map(point => [point.lat, point.lon] as [number, number])}
            pathOptions={{
              color: legColor(leg.mode, leg.routeColor),
              weight: walking ? 4 : 6,
              opacity: 0.95,
              dashArray: walking ? '8 7' : undefined,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          >
            <Tooltip sticky>
              {walking
                ? `Walk · ${Math.ceil(leg.durationSeconds / 60)} min`
                : `${leg.routeLongName ?? leg.routeShortName ?? displayModeLabel(leg)} · ${Math.ceil(leg.durationSeconds / 60)} min`}
            </Tooltip>
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

      {destination.lat !== undefined && destination.lon !== undefined && (
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
      )}
    </>
  );
}
