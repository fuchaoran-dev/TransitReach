import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { arrivalAvailability } from '../arrivalAvailability';

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
  const estimates = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const lat = origin?.lat;
  const lon = origin?.lon;
  const baseServices = useMemo(() => loadEssentialServices(), []);

  useEffect(() => {
    // Invalidate on every transition, including clearing/disabling the origin.
    // On-demand estimates do not share the coverage controller.
    const ticket = ++runId.current;
    const activeEstimates = estimates.current;
    for (const task of activeEstimates.values()) task.controller.abort();
    activeEstimates.clear();
    if (lat === undefined || lon === undefined) {
      setTravelTimes({});
      setState({ status: 'idle', services: [], allServices: [], result: null, error: null, travelMode });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading', services: [], allServices: baseServices, result: null, error: null, travelMode });
    setTravelTimes({});

    computeReachability({ lat, lon }, budgetMinutes, controller.signal, departureTime, travelMode)
      .then(({ result }) => {
        if (controller.signal.aborted || ticket !== runId.current) return;
        const reachable = deduplicateServices(baseServices.filter(service => inside(service, result)));
        setState({ status: 'ready', services: reachable, allServices: baseServices, result, error: null, travelMode });
      })
      .catch(error => {
        if (controller.signal.aborted || ticket !== runId.current) return;
        setState({ status: 'error', services: [], allServices: baseServices, result: null, error: error instanceof Error ? error.message : 'Unable to calculate reachable services.', travelMode });
      });

    return () => {
      controller.abort();
      for (const task of activeEstimates.values()) task.controller.abort();
      activeEstimates.clear();
      runId.current = ticket + 1;
    };
  }, [lat, lon, budgetMinutes, travelMode, departureTime, baseServices]);

  const services = useMemo(() => state.services.map(service => ({
    ...service,
    estimatedTravelTime: travelTimes[service.id],
    arrivalAvailability: arrivalAvailability(service.hours, departureTime, travelTimes[service.id]),
    estimatedMode: travelMode,
    missingFields: missingServiceFields({ ...service, estimatedTravelTime: travelTimes[service.id] }),
  })), [state.services, travelTimes, travelMode, departureTime]);

  const estimateFor = useCallback((service: ServiceLocation): Promise<void> => {
    if (lat === undefined || lon === undefined || service.lat === undefined || service.lon === undefined) return Promise.resolve();
    const existing = estimates.current.get(service.id);
    if (existing) return existing.promise;
    const ticket = runId.current;
    const controller = new AbortController();
    const promise = estimateTravelTime({ lat, lon }, { lat: service.lat, lon: service.lon }, travelMode, departureTime, controller.signal)
      .then(value => { if (!controller.signal.aborted && ticket === runId.current) setTravelTimes(previous => ({ ...previous, [service.id]: value })); })
      .catch(() => { if (!controller.signal.aborted && ticket === runId.current) setTravelTimes(previous => ({ ...previous, [service.id]: null })); })
      .finally(() => { if (estimates.current.get(service.id)?.controller === controller) estimates.current.delete(service.id); });
    estimates.current.set(service.id, { controller, promise });
    return promise;
  }, [lat, lon, travelMode, departureTime]);

  return { ...state, services, travelTimes, estimateFor };
}
