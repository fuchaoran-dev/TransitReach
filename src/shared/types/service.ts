import type { LucideIcon } from 'lucide-react';
import type { MapPoint } from './location';

export type ServiceCategory =
  | 'hospital'
  | 'clinic'
  | 'pharmacy'
  | 'school'
  | 'market'
  /**
   * Split out of `market`. Malls were in the data all along as `shop=mall` but carried no
   * label of their own, so someone looking for one had no way to find it — the mentors'
   * "user can find categories that are not shown in the button".
   */
  | 'mall'
  | 'govt'
  | 'park'
  | 'bank'
  | 'police'
  | 'childcare'
  | 'food'
  | 'other';

export interface ServiceCategoryMeta {
  id: ServiceCategory;
  label: string;
  icon: LucideIcon;
  color: string;
  colorLight: string;
}

export interface ServiceLocation {
  id: string;
  name: string;
  category: ServiceCategory;
  /** The real geographic coordinate used by Leaflet and OTP. */
  lat?: number;
  lon?: number;
  pos: MapPoint;
  /** OSM source tag, retained so the category rule is auditable. */
  sourceCategory?: string;
  sourceDataset?: string;
  address?: string;
  hours?: string;
  rating?: number;
  walkMin?: number;
  transitMin?: number;
  accessible?: boolean;
  waitingMin?: number;
  /** Filled by OTP's plan endpoint for the selected departure time and mode. */
  estimatedTravelTime?: number | null;
  estimatedMode?: 'walking' | 'transit' | 'multimodal';
  /** Missing fields are reported instead of being invented. */
  missingFields?: string[];
}
