import { BusFront, Coffee, ShoppingBag, TrainFront, Users, Utensils, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { RadarCategory, RadarPoi } from '../radarScan';

const CATEGORIES: Record<RadarCategory, { icon: LucideIcon; colour: string }> = {
  restaurant: { icon: Utensils, colour: '#ffc579' },
  cafe: { icon: Coffee, colour: '#67f3ff' },
  bus: { icon: BusFront, colour: '#259bff' },
  train: { icon: TrainFront, colour: '#80dcff' },
  shopping: { icon: ShoppingBag, colour: '#ffd38b' },
  meeting: { icon: Users, colour: '#79f9cc' },
};

/** The anchor stays fixed; only the raised glass bubble floats above it. */
export function RadarPoiMarker({ poi }: { poi: RadarPoi }) {
  const { icon: Icon, colour } = CATEGORIES[poi.category];
  return <div className="radar-poi" data-category={poi.category} style={{
    left: `calc(50% + ${poi.x}px)`, top: `calc(50% + ${poi.y}px)`, '--poi-colour': colour,
  } as CSSProperties}>
    <span className="radar-poi-ripple" />
    <span className="radar-poi-anchor" />
    <span className="radar-poi-bubble">
      <span className="radar-poi-flash" />
      <Icon size={24} strokeWidth={2} />
    </span>
  </div>;
}
