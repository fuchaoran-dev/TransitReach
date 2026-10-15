import type { RadarPlace } from '@/features/meeting-point/components/MeetingRadarLayer';

/** Visual-only fictitious POIs. Never imported by production discovery or routing logic. */
export const RADAR_DEMO_PLACES: RadarPlace[] = [
  { id: 'demo-food', label: 'Demo restaurant', category: 'restaurant', lat: 3.0706, lon: 101.5919 },
  { id: 'demo-cafe', label: 'Demo cafe', category: 'cafe', lat: 3.0691, lon: 101.5913 },
  { id: 'demo-bus', label: 'Demo bus stop', category: 'bus', lat: 3.0666, lon: 101.5917 },
  { id: 'demo-train', label: 'Demo train station', category: 'train', lat: 3.0700, lon: 101.5959 },
  { id: 'demo-shop', label: 'Demo shopping area', category: 'shopping', lat: 3.0682, lon: 101.5960 },
  { id: 'demo-meet', label: 'Demo meeting place', category: 'meeting', lat: 3.0660, lon: 101.5953 },
];
