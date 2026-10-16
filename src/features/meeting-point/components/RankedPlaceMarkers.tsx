import { useEffect, useMemo, useState } from 'react';
import { Marker, Tooltip, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { usePrefersReducedMotion } from '@/shared/hooks';
import type { RankedPlace } from '../fairnessRanking';
import { panelPadding } from '../mapFraming';
import type { MeetingSelection, MeetingVenue } from '../types';

/** Close enough to read the streets around a place, without losing the stations nearby. */
const FOCUS_ZOOM = 15;

/**
 * A rank badge. Graphite with a white ring, like the white place dots inverted, so it reads
 * over the graphite shared area and over the street map; the selected place swaps to white on
 * graphite and grows, so it stands out from its neighbours by shape and contrast, not a new hue.
 */
const VENUE_GLYPHS: Record<RankedPlace['venue']['type'], string> = {
  station: '<path d="M7 3h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 10h10M8 20l2-4m6 4-2-4M8 7h8v3H8Z"/>',
  cafe: '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 2h2a3 3 0 0 1 0 6h-3M7 3v2m4-2v2"/>',
  restaurant: '<path d="M7 3v7m-3-7v4a3 3 0 0 0 6 0V3M7 10v11m10-18v18m0-18c-3 2-3 8 0 9"/>',
  mall: '<path d="M5 8h14l-1 13H6L5 8Zm3 0a4 4 0 0 1 8 0"/>',
};

function venueGlyph(type: RankedPlace['venue']['type']): string {
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VENUE_GLYPHS[type]}</svg>`;
}

function rankIcon(place: Pick<RankedPlace, 'venue'>, selected: boolean, besideStart: boolean, proposed: boolean, confirmed: boolean, dimmed: boolean) {
  const size = confirmed ? 40 : selected || proposed ? 34 : 24;
  const background = confirmed ? '#14b8a6' : proposed ? '#fbbf24' : selected ? '#ffffff' : '#1e293b';
  const colour = confirmed ? '#04201c' : selected || proposed ? '#1e293b' : '#ffffff';
  const border = confirmed ? '3px solid #ffffff' : `${selected ? 3 : 2}px solid ${selected ? '#1e293b' : '#ffffff'}`;
  const shadow = confirmed
    ? '0 0 0 6px rgba(20,184,166,.28),0 2px 10px rgba(15,23,42,.6)'
    : selected
      ? '0 0 0 5px rgba(255,255,255,.22),0 3px 12px rgba(15,23,42,.7)'
      : proposed
        ? '0 0 0 4px rgba(251,191,36,.2),0 2px 8px rgba(15,23,42,.55)'
        : '0 1px 4px rgba(15,23,42,.45)';
  const html =
    `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;` +
    `justify-content:center;font:700 ${confirmed ? 15 : selected ? 13 : 11}px system-ui,sans-serif;` +
    `background:${background};color:${colour};border:${border};box-shadow:${shadow};` +
    `opacity:${dimmed ? 0.28 : 1};transition:opacity .2s,transform .2s">${confirmed ? '✓' : venueGlyph(place.venue.type)}</div>`;
  // Move only the badge's screen anchor when it shares a point with a member.
  // The venue/member coordinates remain exact; the member's coloured circle stays visible.
  return divIcon({ className: `ranked-place-marker${proposed ? ' meeting-proposed-pin' : ''}`, html, iconSize: [size, size], iconAnchor: [besideStart ? -12 : size / 2, size / 2] });
}

function clusterIcon(count: number) {
  const size = count > 5 ? 42 : 36;
  return divIcon({
    className: 'ranked-place-marker meeting-place-cluster',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#132433;color:#99f6e4;border:2px solid #5eead4;box-shadow:0 0 0 5px rgba(45,212,191,.16),0 4px 14px rgba(0,0,0,.4);font:800 12px system-ui,sans-serif">+${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function distanceMeters(a: RankedPlace, b: RankedPlace): number {
  const lat = (a.venue.lat + b.venue.lat) * Math.PI / 360;
  const x = (a.venue.lon - b.venue.lon) * Math.cos(lat);
  const y = a.venue.lat - b.venue.lat;
  return Math.sqrt(x * x + y * y) * 111_320;
}

function clusterDistance(zoom: number): number {
  if (zoom <= 12) return 900;
  if (zoom === 13) return 480;
  if (zoom === 14) return 220;
  if (zoom === 15) return 90;
  return 0;
}

interface RankedPlaceMarkersProps {
  /** The places currently listed, in rank order. */
  places: RankedPlace[];
  selectedId: string | null;
  onSelect: (venueId: string) => void;
  memberPoints?: Array<{ lat: number; lon: number }>;
  selections?: MeetingSelection[];
  /** Once the group has chosen, that place leads and the rest step back. */
  confirmedId?: string | null;
  confirmedVenue?: MeetingVenue | null;
}

/** Numbers on the map for the places the list is showing, so the two can be read against each other. */
export function RankedPlaceMarkers({ places, selectedId, onSelect, memberPoints = [], selections = [], confirmedId = null, confirmedVenue = null }: RankedPlaceMarkersProps) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => typeof map.getZoom === 'function' ? map.getZoom() : 13);
  useEffect(() => {
    if (typeof map.on !== 'function' || typeof map.off !== 'function') return;
    const update = () => setZoom(map.getZoom());
    map.on('zoomend', update);
    return () => { map.off('zoomend', update); };
  }, [map]);
  const groups = useMemo(() => {
    const distance = clusterDistance(zoom);
    const grouped: RankedPlace[][] = [];
    for (const place of places) {
      if (!distance || place.venue.id === selectedId || place.venue.id === confirmedId) {
        grouped.push([place]);
        continue;
      }
      const group = grouped.find(items => items.length > 0 && items.every(item => item.venue.id !== selectedId && item.venue.id !== confirmedId) && distanceMeters(items[0], place) <= distance);
      if (group) group.push(place); else grouped.push([place]);
    }
    return grouped;
  }, [confirmedId, places, selectedId, zoom]);

  // A peer can propose a later search page or another category. Show the shared
  // public venue without inventing a rank or personal travel-time calculation.
  const unlisted = new Map<string, { venue: MeetingVenue; people: string[] }>();
  for (const selection of selections) {
    if (places.some(place => place.venue.id === selection.venue.id && place.venue.type === selection.venue.type)) continue;
    const key = `${selection.venue.type}:${selection.venue.id}`;
    unlisted.set(key, { venue: selection.venue, people: [...(unlisted.get(key)?.people ?? []), selection.displayName] });
  }
  if (confirmedVenue && !places.some(place => place.venue.id === confirmedVenue.id && place.venue.type === confirmedVenue.type)) {
    const key = `${confirmedVenue.type}:${confirmedVenue.id}`;
    unlisted.set(key, { venue: confirmedVenue, people: unlisted.get(key)?.people ?? [] });
  }

  return (
    <>
      {groups.map(group => {
        if (group.length > 1) {
          const lat = group.reduce((sum, place) => sum + place.venue.lat, 0) / group.length;
          const lon = group.reduce((sum, place) => sum + place.venue.lon, 0) / group.length;
          return <Marker key={`cluster-${group.map(place => place.venue.id).join('-')}`} position={[lat, lon]} icon={clusterIcon(group.length)} title={`${group.length} nearby places`} zIndexOffset={700} bubblingMouseEvents={false} eventHandlers={{ click: () => {
            if (typeof map.fitBounds === 'function') map.fitBounds(latLngBounds(group.map(place => [place.venue.lat, place.venue.lon])), { ...panelPadding(map), maxZoom: 16 });
          } }}><Tooltip direction="top" offset={[0, -18]}>{group.length} nearby places · zoom in to explore</Tooltip></Marker>;
        }
        const place = group[0];
        const index = places.indexOf(place);
        const selected = place.venue.id === selectedId;
        const rank = place.rank ?? index + 1;
        const proposers = selections.filter(selection => selection.venue.id === place.venue.id && selection.venue.type === place.venue.type);
        const confirmed = confirmedId === place.venue.id;
        const dimmed = (confirmedId !== null && !confirmed && !selected) || (selectedId !== null && !selected);
        const besideStart = memberPoints.some(point => Math.abs(point.lat - place.venue.lat) < 0.00001 && Math.abs(point.lon - place.venue.lon) < 0.00001);
        return (
          <Marker
            key={place.venue.id}
            position={[place.venue.lat, place.venue.lon]}
            icon={rankIcon(place, selected, besideStart, proposers.length > 0, confirmed, dimmed)}
            // Above the place dots and other ranks. The selected place also rises above the viewer's
            // own pin (1000): a café inside the station someone starts from was otherwise hidden
            // under their pin at the moment they asked to see it.
            zIndexOffset={confirmed ? 1200 : selected || proposers.length ? 1100 : dimmed ? 300 : 500}
            title={`${rank}. ${place.venue.name}`}
            bubblingMouseEvents={false}
            eventHandlers={{ click: () => onSelect(place.venue.id) }}
          >{confirmed || selected ? <Tooltip permanent direction="bottom" offset={[0, confirmed ? 22 : 18]} className="meeting-confirmed-label"><span className="block max-w-44 text-center">{place.venue.name}</span></Tooltip> : proposers.length > 0 && !confirmedId && <Tooltip permanent direction="bottom" offset={[0, 16]}><span className="block max-w-44 text-center"><strong>Proposed</strong><br />{proposers.map(person => person.displayName).join(' · ')}</span></Tooltip>}</Marker>
        );
      })}
      {[...unlisted.values()].map(({ venue, people }) => {
        const confirmed = venue.id === confirmedId;
        return <Marker key={`shared-${venue.type}:${venue.id}`} position={[venue.lat, venue.lon]}
          icon={rankIcon({ venue }, venue.id === selectedId, false, people.length > 0, confirmed, false)}
          title={`${confirmed ? 'Chosen' : 'Proposed'}: ${venue.name}`} zIndexOffset={1200} bubblingMouseEvents={false}
          eventHandlers={{ click: () => onSelect(venue.id) }}>
          <Tooltip permanent direction="bottom" offset={[0, 18]}><span>{venue.name}<br />{confirmed ? 'Chosen by group vote' : `Proposed: ${people.join(', ')}`}</span></Tooltip>
        </Marker>;
      })}
    </>
  );
}

/** AC 6.2.2 — brings the selected place into view, clear of both panels. */
export function FocusOnPlace({ place }: { place: { lat: number; lon: number } | null }) {
  const map = useMap();
  const reduced = usePrefersReducedMotion();
  const lat = place?.lat;
  const lon = place?.lon;

  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    const bounds = latLngBounds([lat, lon], [lat, lon]);
    const options = { ...panelPadding(map), maxZoom: FOCUS_ZOOM };
    if (reduced) map.fitBounds(bounds, options);
    else map.flyToBounds(bounds, { ...options, duration: 0.6 });
  }, [map, lat, lon, reduced]);

  return null;
}
