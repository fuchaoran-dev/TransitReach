import { useState } from 'react';
import { NavBar } from './NavBar';
import { VISIBLE_NAV_ITEMS } from './nav';
import type { PageId } from './routes';
import { ToastContainer, PageTransition } from '@/shared/ui';
import { useToasts } from '@/shared/hooks';
import { LandingPage } from '@/pages/LandingPage';
import { MapPage } from '@/pages/MapPage';
import type { MapAnalysisTab } from '@/pages/components/MapAnalysisPanel';
import { TimeComparisonPage } from '@/pages/future/TimeComparisonPage';
import { ScenarioPage } from '@/pages/future/ScenarioPage';
import { TypologyPage } from '@/pages/future/TypologyPage';
import { MethodologyPage } from '@/pages/MethodologyPage';
import { DEFAULT_TIME_BUDGET } from '@/features/reachability';
import { originFromHit, type SearchHit } from '@/features/reachability/reachabilityService';
import type { Origin } from '@/features/reachability/types';
import { MeetingPointPage, hasRoomLink } from '@/features/meeting-point';

/**
 * The journey state, held here rather than on each screen.
 *
 * The map, the services screen and the time comparison each used to own a separate origin
 * and budget, and two of them defaulted to a station in central Kuala Lumpur. Choosing a
 * location on one screen therefore left the others describing somewhere else — with no
 * indication, so a resident of an outer suburb could read central KL's service count as
 * their own. One shared value per concept removes that class of problem: whatever a screen
 * shows, it shows for the place the user actually chose.
 *
 * Departure times stay on the comparison screen, because two of them are specific to it.
 */
function App() {
  // Epic 6 — a meeting-room link (`?meet=<code>`) opens straight onto the meeting screen.
  const [activePage, setActivePage] = useState<PageId>(() => (hasRoomLink() ? 'meeting' : 'landing'));
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [timeBudget, setTimeBudget] = useState(DEFAULT_TIME_BUDGET);
  const [analysisTab, setAnalysisTab] = useState<MapAnalysisTab>('first-mile');
  const { toasts, addToast, removeToast } = useToasts();

  /**
   * "Services" is a view of the map, not a separate screen.
   *
   * It used to be its own page with its own map, search box and origin, which is how a
   * user could end up reading one location's services while the map beside it described
   * another. Selecting it now opens the map with the Services tab active: same map, same
   * starting point, and the feature keeps a name in the navigation.
   */
  const handleNavigate = (page: PageId) => {
    if (page === 'services') setAnalysisTab('services');
    else if (page === 'map' && analysisTab === 'services') setAnalysisTab('first-mile');
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const showsMap = activePage === 'map' || activePage === 'services';

  /** AC 1.4.2 — a landing-page selection becomes the starting point for every screen. */
  const handleSearchSelect = (hit: SearchHit) => setOrigin(originFromHit(hit));

  const journey = {
    origin,
    onOriginChange: setOrigin,
    timeBudget,
    onTimeBudgetChange: setTimeBudget,
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <NavBar items={VISIBLE_NAV_ITEMS} activePage={activePage} onNavigate={handleNavigate} />

      {/* Map and Services are the same screen, so they share a transition key and the map
          is not torn down and recomputed when the user switches between them. */}
      <PageTransition pageKey={showsMap ? 'map' : activePage}>
        {activePage === 'landing' && (
          <LandingPage onNavigate={handleNavigate} onSearchSelect={handleSearchSelect} />
        )}
        {showsMap && (
          <MapPage
            journey={journey}
            onToast={addToast}
            analysisTab={analysisTab}
            onAnalysisTabChange={setAnalysisTab}
          />
        )}
        {activePage === 'time' && <TimeComparisonPage journey={journey} />}
        {activePage === 'scenario' && <ScenarioPage />}
        {activePage === 'typology' && <TypologyPage />}
        {activePage === 'meeting' && <MeetingPointPage />}
        {activePage === 'methodology' && <MethodologyPage />}
      </PageTransition>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

export default App;
