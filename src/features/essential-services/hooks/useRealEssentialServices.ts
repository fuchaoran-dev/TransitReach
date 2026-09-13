import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  computeReachability,
  estimateTravelTime,
  type IsochroneResult,
  type TravelMode,
} from '@/shared/data/adapters/routingAdapter';
import { loadEssentialServices } from '@/shared/data/adapters/essentialServicesAdapter';
import type { ServiceLocation } from '@/shared/types/service';
import type { LatLng } from '@/features/reachability/types';
import { deduplicateServices, missingServiceFields } from '../serviceDataRules';

export type RealServicesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RealServicesState {
  status: RealServicesStatus;
  services: ServiceLocation[];
  allServices: ServiceLocation[];
  result: IsochroneResult | null;
  error: string | null;
  travelMode: TravelMode;
}

function inside(service: ServiceLocation, result: IsochroneResult | null): boolean {
  if (!result || service.lat === undefined || service.lon === undefined) return false;
  return result.regions.some(region =>
    pointInRing(service.lat!, service.lon!, region.outer) &&
    !region.holes.some(hole => pointInRing(service.lat!, service.lon!, hole)),
  );
}

function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Epic 5 data hook. The OSM dataset is static and reproducible; OTP is called for the
 * selected origin, budget, mode and departure time. There is intentionally no mock
 * fallback: an unavailable upstream is shown as an error to avoid presenting fiction as
 * coverage.
 */
export function useRealEssentialServices(
  origin: LatLng | null,
  budgetMinutes: number,
  travelMode: TravelMode,
  departureTime: string,
) {
  const [state, setState] = useState<RealServicesState>({
    status: 'idle', services: [], allServices: [], result: null, error: null, travelMode,
  });
  const [travelTimes, setTravelTimes] = useState<Record<string, number | null>>({});
  const runId = useRef(0);
  const baseServices = useMemo(() => loadEssentialServices(), []);

  useEffect(() => {
    if (!origin) {
      setState({ status: 'idle', services: [], allServices: [], result: null, error: null, travelMode });
      return;
    }

    const controller = new AbortController();
    const ticket = ++runId.current;
    setState({ status: 'loading', services: [], allServices: baseServices, result: null, error: null, travelMode });
    setTravelTimes({});

    computeReachability(origin, budgetMinutes, controller.signal, departureTime, travelMode)
      .then(({ result }) => {
        if (ticket !== runId.current) return;
        const reachable = deduplicateServices(baseServices.filter(service => inside(service, result)));
        setState({ status: 'ready', services: reachable, allServices: baseServices, result, error: null, travelMode });
        populateTravelTimes(reachable.slice(0, 80), origin, travelMode, departureTime, controller.signal, setTravelTimes, ticket, runId);
      })
      .catch(error => {
        if (controller.signal.aborted || ticket !== runId.current) return;
        setState({ status: 'error', services: [], allServices: baseServices, result: null, error: error instanceof Error ? error.message : 'Unable to calculate reachable services.', travelMode });
      });

    return () => controller.abort();
  }, [origin, budgetMinutes, travelMode, departureTime, baseServices]);

  const services = useMemo(() => state.services.map(service => ({
    ...service,
    estimatedTravelTime: travelTimes[service.id],
    estimatedMode: travelMode,
    missingFields: missingServiceFields({ ...service, estimatedTravelTime: travelTimes[service.id] }),
  })), [state.services, travelTimes, travelMode]);

  const estimateFor = async (service: ServiceLocation) => {
    if (!origin || service.lat === undefined || service.lon === undefined) return;
    const value = await estimateTravelTime(origin, { lat: service.lat, lon: service.lon }, travelMode, departureTime);
    setTravelTimes(previous => ({ ...previous, [service.id]: value }));
  };

  return { ...state, services, travelTimes, estimateFor };
}

async function populateTravelTimes(
  services: ServiceLocation[],
  origin: LatLng,
  mode: TravelMode,
  departureTime: string,
  signal: AbortSignal,
  setTravelTimes: Dispatch<SetStateAction<Record<string, number | null>>>,
  ticket: number,
  runId: MutableRefObject<number>,
) {
  let next = 0;
  async function worker() {
    while (next < services.length && !signal.aborted && ticket === runId.current) {
      const service = services[next++];
      if (service.lat === undefined || service.lon === undefined) continue;
      try {
        const value = await estimateTravelTime(origin, { lat: service.lat, lon: service.lon }, mode, departureTime, signal);
        if (ticket === runId.current) setTravelTimes(previous => ({ ...previous, [service.id]: value }));
      } catch {
        if (signal.aborted) return;
        if (ticket === runId.current) setTravelTimes(previous => ({ ...previous, [service.id]: null }));
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
}
