import type { PersonalPass } from '../types';
import { TravelPassContent } from './TravelPassContent';
import { TravelPassDialog } from './TravelPassDialog';

export function SavedTravelPass({ pass, onClose }: { pass: PersonalPass; onClose: () => void }) {
  return <TravelPassDialog plan={pass.meeting} backLabel="Back to My Passes" onClose={onClose}>
    <TravelPassContent mode="saved" pass={pass} originLabel={pass.legs[0]?.from.name ?? 'Your starting point'} />
  </TravelPassDialog>;
}
