import type { Map as GLMap, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { PersonalPass } from './types';

export interface PassRouteBackdrop {
  canvas: HTMLCanvasElement;
  /** Screen coordinates from the same camera as the street image. */
  paths: Array<Array<[number, number]>>;
}

const WIDTH = 1012;
const HEIGHT = 268;
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Capture real streets and labels; the private itinerary is never sent to a map API. */
export async function renderPassRouteMap(pass: PersonalPass): Promise<PassRouteBackdrop | null> {
  const paths = pass.legs.map(leg => leg.geometry.filter(point =>
    Number.isFinite(point.lat) && Number.isFinite(point.lon)));
  const points = paths.flat();
  if (pass.zeroTravel || points.length < 2) return null;
  const controller = new AbortController();
  let map: GLMap | undefined;
  let host: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<null>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, 10_000);
      }),
      (async (): Promise<PassRouteBackdrop | null> => {
        const [gl, response] = await Promise.all([
          import('maplibre-gl'), fetch(STYLE_URL, { signal: controller.signal }),
        ]);
        if (!response.ok) return null;
        const raw = await response.json() as StyleSpecification;
        if (controller.signal.aborted) return null;
        // Keep streets, water and labels, including the style's glyphs/sprites.
        // Building-only scenes can look blank at city-scale and obscure a printable route.
        const style: StyleSpecification = {
          ...raw, layers: raw.layers.filter(layer => layer.type !== 'fill-extrusion'),
        };
        host = document.createElement('div');
        host.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none`;
        host.setAttribute('aria-hidden', 'true');
        document.body.appendChild(host);
        gl.setWorkerUrl(workerUrl);
        map = new gl.Map({ container: host, style, interactive: false, attributionControl: false,
          pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
          center: [points[0].lon, points[0].lat], zoom: 16, pitch: 0, bearing: 0,
        });
        const scene = map;
        return await new Promise<PassRouteBackdrop | null>((resolve, reject) => {
          scene.once('error', () => resolve(null));
          controller.signal.addEventListener('abort', () => resolve(null), { once: true });
          scene.once('load', () => {
            if (controller.signal.aborted) return;
            try {
              const west = Math.min(...points.map(p => p.lon));
              const east = Math.max(...points.map(p => p.lon));
              const south = Math.min(...points.map(p => p.lat));
              const north = Math.max(...points.map(p => p.lat));
              scene.fitBounds([[west, south], [east, north]], { duration: 0, padding: 44,
                maxZoom: 17.5, pitch: 0, bearing: 0 });
              const capture = () => {
                if (controller.signal.aborted) return;
                try {
                  const canvas = document.createElement('canvas');
                  canvas.width = WIDTH; canvas.height = HEIGHT;
                  const context = canvas.getContext('2d');
                  if (!context) { resolve(null); return; }
                  context.drawImage(scene.getCanvas(), 0, 0);
                  const projected = paths.map(path => path.map(point => {
                    const p = scene.project([point.lon, point.lat]);
                    return [p.x, p.y] as [number, number];
                  }));
                  resolve({ canvas, paths: projected });
                } catch (error) { reject(error); }
              };
              scene.once('idle', () => {
                if (controller.signal.aborted) return;
                // fitBounds fits a geographic rectangle; tighten the actual route's screen bounds
                // so a tall/narrow journey does not leave its buildings tiny in a wide export.
                const pixels = points.map(point => scene.project([point.lon, point.lat]));
                const left = Math.min(...pixels.map(p => p.x));
                const right = Math.max(...pixels.map(p => p.x));
                const top = Math.min(...pixels.map(p => p.y));
                const bottom = Math.max(...pixels.map(p => p.y));
                const factor = Math.min((WIDTH - 140) / Math.max(1, right - left),
                  (HEIGHT - 110) / Math.max(1, bottom - top), 3.5);
                if (factor > 1.15 && scene.getZoom() < 17.5) {
                  const originalCamera = { center: scene.getCenter(), zoom: scene.getZoom() };
                  const center = scene.unproject([(left + right) / 2, (top + bottom) / 2]);
                  scene.once('idle', () => {
                    if (controller.signal.aborted) return;
                    const clipped = points.some(point => {
                      const p = scene.project([point.lon, point.lat]);
                      return p.x < 24 || p.x > WIDTH - 24 || p.y < 24 || p.y > HEIGHT - 40;
                    });
                    if (clipped) {
                      scene.once('idle', capture);
                      scene.jumpTo(originalCamera);
                      scene.triggerRepaint();
                    } else capture();
                  });
                  scene.jumpTo({ center, zoom: Math.min(17.5, scene.getZoom() + Math.log2(factor)) });
                  scene.triggerRepaint();
                } else capture();
              });
              scene.triggerRepaint();
            } catch (error) { reject(error); }
          });
        });
      })(),
    ]);
  } catch {
    return null;
  } finally {
    controller.abort();
    clearTimeout(timer);
    map?.remove();
    host?.remove();
  }
}
