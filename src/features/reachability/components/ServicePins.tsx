import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Marker, Tooltip } from 'react-leaflet';
import { divIcon, type DivIcon } from 'leaflet';
import { CATEGORY_META } from '@/shared/data';
import type { ServiceCategory, ServiceLocation } from '@/shared/types/service';

interface ServicePinsProps {
  services?: ServiceLocation[];
  selectedServiceId?: string | null;
  onServiceSelect?: (service: ServiceLocation) => void;
}

/**
 * A service pin: a dark category icon on a white disc with a category-coloured ring.
 * Colour alone could not carry thirteen categories — Schools and Food read as the
 * same orange dot — so the icon, the same one on the category's filter chip, is what
 * tells them apart. The white disc keeps every glyph readable on day and night maps.
 *
 * One icon per category and state, built once: the pins are re-rendered on every filter
 * change and there can be hundreds of them.
 */
const serviceIconCache = new Map<string, DivIcon>();

function serviceIcon(category: ServiceCategory, selected: boolean): DivIcon {
  const key = `${category}:${selected}`;
  const cached = serviceIconCache.get(key);
  if (cached) return cached;

  const meta = CATEGORY_META[category];
  const size = selected ? 38 : 30;
  const glyph = renderToStaticMarkup(
    createElement(meta.icon, { size: selected ? 23 : 19, color: '#102a43', strokeWidth: 2.8 }),
  );
  const icon = divIcon({
    className: `service-pin${selected ? ' service-pin-selected' : ''}`,
    html:
      `<div class="service-pin-disc" style="width:${size}px;height:${size}px;border-radius:9999px;background:#ffffff;` +
      `border:3px solid ${meta.color};` +
      `display:flex;align-items:center;justify-content:center;box-sizing:border-box">${glyph}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  serviceIconCache.set(key, icon);
  return icon;
}

export function ServicePins({ services, selectedServiceId, onServiceSelect }: ServicePinsProps) {
  return <>
    {(services ?? []).map(service => {
      if (service.lat === undefined || service.lon === undefined) return null;
      const selected = service.id === selectedServiceId;
      return (
        <Marker
          key={service.id}
          position={[service.lat, service.lon]}
          icon={serviceIcon(service.category, selected)}
          title={service.name}
          // Selected pin above its neighbours; the origin pin (1000) stays above both.
          zIndexOffset={selected ? 500 : 0}
          // A service click is an inspection action, not a new-origin map click. Marker
          // clicks do not bubble to the map, so ClickHandler never sees it.
          eventHandlers={{ click: () => onServiceSelect?.(service) }}
        >
          <Tooltip direction="top" offset={[0, selected ? -19 : -15]} className="service-pin-tooltip">
            <strong>{service.name}</strong><br />{CATEGORY_META[service.category].label}
          </Tooltip>
        </Marker>
      );
    })}
  </>;
}

