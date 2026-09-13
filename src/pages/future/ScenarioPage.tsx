import { useState, useMemo } from 'react';
import { Route, Plus, Minus, Play, RotateCcw, TrendingUp, TrendingDown, Lightbulb, Check } from 'lucide-react';
import { TransitMap, ReachabilityLayer, OriginMarker, HatchArea } from '@/shared/map';
import { ScenarioRouteOverlay } from './components/ScenarioRouteOverlay';
import { servicesInPolygon, polygonArea } from '@/shared/lib/spatial';
import { usePrefersReducedMotion, useCountUp } from '@/shared/hooks';
import { generateReachPolygon, mapAreaToKm2 } from '@/shared/data/mock/reachability';
import { SERVICES, SCENARIO_ROUTES, TRANSIT_LINES, CITY_CENTER } from '@/shared/data';

type Tab = 'baseline' | 'scenario' | 'difference';

export function ScenarioPage() {
  const reduced = usePrefersReducedMotion();
  const [tab, setTab] = useState<Tab>('baseline');
  const [running, setRunning] = useState(false);
  const [showScenario, setShowScenario] = useState(false);
  const [showNewPolygon, setShowNewPolygon] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [activeRoutes, setActiveRoutes] = useState<Set<string>>(new Set(['sc-proposed-1']));

  const baselinePoly = useMemo(() => generateReachPolygon(CITY_CENTER, 45, 42), []);
  const scenarioPoly = useMemo(() => generateReachPolygon(CITY_CENTER, 55, 42), []);
  const baselineArea = mapAreaToKm2(polygonArea(baselinePoly));
  const scenarioArea = mapAreaToKm2(polygonArea(scenarioPoly));
  const baselineServices = servicesInPolygon(SERVICES, baselinePoly).length;
  const scenarioServices = servicesInPolygon(SERVICES, scenarioPoly).length;

  const lostPoints = baselinePoly.filter(p => !scenarioPoly.includes(p));
  const gainedPoints = scenarioPoly.filter(p => !baselinePoly.includes(p));

  const runScenario = () => {
    setRunning(true);
    setShowScenario(false);
    setShowNewPolygon(false);
    setShowDiff(false);
    setShowExplanation(false);
    setTab('scenario');

    setTimeout(() => setShowScenario(true), reduced ? 50 : 300);
    setTimeout(() => setShowNewPolygon(true), reduced ? 100 : 700);
    if (tab === 'difference') {
      setTimeout(() => setShowDiff(true), reduced ? 150 : 1000);
    }
    setTimeout(() => setShowExplanation(true), reduced ? 200 : 1200);
    setTimeout(() => setRunning(false), reduced ? 300 : 1400);
  };

  const reset = () => {
    setTab('baseline');
    setShowScenario(false);
    setShowNewPolygon(false);
    setShowDiff(false);
    setShowExplanation(false);
  };

  const toggleRoute = (id: string) => {
    setActiveRoutes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeScenarioRoutes = SCENARIO_ROUTES.filter(r => activeRoutes.has(r.id));

  return (
    <div className="min-h-screen pt-16">
      <div className="fixed inset-0 -z-10" style={{ background: 'radial-gradient(ellipse at 15% 20%, rgba(20,184,166,0.06) 0%, transparent 50%), radial-gradient(ellipse at 85% 80%, rgba(37,99,235,0.04) 0%, transparent 50%)' }} />

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 fade-slide-up">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Scenario Modelling</h1>
          <p className="text-slate-600">Test proposed routes or suspend existing ones to see how accessibility changes.</p>
        </div>

        {/* Tab selector */}
        <div className="flex items-center gap-2 mb-6">
          <div className="glass-chip p-1 flex gap-1 rounded-xl">
            {([
              { id: 'baseline' as Tab, label: 'Baseline' },
              { id: 'scenario' as Tab, label: 'Scenario' },
              { id: 'difference' as Tab, label: 'Difference' },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`chip ${tab === t.id ? 'chip-selected' : 'chip-unselected'}`}
                style={{ padding: '6px 16px' }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          {/* Map */}
          <div className="relative rounded-2xl overflow-hidden shadow-lg" style={{ aspectRatio: '10/7', minHeight: '400px' }}>
            <TransitMap
              showTransit
              showRoads
              fadedLines={tab !== 'baseline' ? TRANSIT_LINES.map(l => l.id) : []}
            />
            <svg viewBox="0 0 1000 700" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid slice">
              {/* Baseline polygon */}
              {(tab === 'baseline' || tab === 'difference') && (
                <ReachabilityLayer points={baselinePoly} color="#94a3b8" fillOpacity={tab === 'difference' ? 0.08 : 0.15} animate={!reduced} />
              )}
              {/* Scenario polygon */}
              {(tab === 'scenario' || tab === 'difference') && showNewPolygon && (
                <ReachabilityLayer points={scenarioPoly} color="#14b8a6" fillOpacity={0.15} animate={!reduced} />
              )}
              {/* Difference hatches */}
              {tab === 'difference' && showDiff && (
                <>
                  <HatchArea points={lostPoints} type="lost" animate={!reduced} />
                  <HatchArea points={gainedPoints} type="gained" animate={!reduced} />
                </>
              )}
              {/* Scenario routes */}
              {showScenario && activeScenarioRoutes.map(route => (
                <ScenarioRouteOverlay
                  key={route.id}
                  path={route.path}
                  color={route.color}
                  stops={route.stops}
                  type={route.type}
                  animate={!reduced}
                />
              ))}
              <OriginMarker pos={CITY_CENTER} animate={!reduced} showPulse />
            </svg>

            {/* Running indicator */}
            {running && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 glass-strong px-4 py-2 flex items-center gap-2 fade-in">
                <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent spinner" />
                <span className="text-sm font-semibold text-slate-700">Running scenario...</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {/* Route selector */}
            <div className="glass p-4">
              <div className="flex items-center gap-2 mb-3">
                <Route size={14} className="text-teal-600" />
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Active Scenarios</span>
              </div>
              <div className="space-y-2">
                {SCENARIO_ROUTES.map(route => {
                  const active = activeRoutes.has(route.id);
                  return (
                    <button
                      key={route.id}
                      onClick={() => toggleRoute(route.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${
                        active ? 'bg-teal-50 border border-teal-300' : 'bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${route.color}15` }}>
                        {route.type === 'proposed' ? <Plus size={16} style={{ color: route.color }} /> : <Minus size={16} style={{ color: route.color }} />}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold text-slate-800">{route.name}</div>
                        <div className="text-xs text-slate-500 capitalize">{route.type}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                        active ? 'bg-teal-500 border-teal-500' : 'border-slate-300'
                      }`}>
                        {active && <Check size={12} className="text-white check-draw" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={runScenario}
                disabled={running || activeRoutes.size === 0}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Play size={16} />
                {running ? 'Running...' : 'Run Scenario'}
              </button>
              <button onClick={reset} className="btn-secondary flex items-center justify-center gap-2">
                <RotateCcw size={16} />
              </button>
            </div>

            {/* Before/After metrics */}
            {(tab === 'scenario' || tab === 'difference') && showNewPolygon && (
              <div className="space-y-3 fade-slide-up">
                <ScenarioMetric
                  label="Reachable Area"
                  before={baselineArea}
                  after={scenarioArea}
                  unit="km²"
                  decimals={1}
                  icon={Route}
                />
                <ScenarioMetric
                  label="Services in Reach"
                  before={baselineServices}
                  after={scenarioServices}
                  unit=""
                  icon={TrendingUp}
                />
              </div>
            )}

            {/* Explanation card */}
            {showExplanation && (
              <div className="glass-strong p-4 fade-slide-up">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={16} className="text-amber-500" />
                  <span className="text-sm font-bold text-slate-800">Model Explanation</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Adding the proposed feeder route extends the reachable area by{' '}
                  <span className="font-bold text-teal-600">{(scenarioArea - baselineArea).toFixed(1)} km²</span> and
                  brings <span className="font-bold text-teal-600">{scenarioServices - baselineServices}</span> additional
                  essential services within reach. The new stops along the corridor improve access for
                  approximately 12,000 residents.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScenarioMetric({
  label, before, after, unit, decimals = 0, icon: Icon,
}: {
  label: string;
  before: number;
  after: number;
  unit: string;
  decimals?: number;
  icon: typeof TrendingUp;
}) {
  const diff = after - before;
  const diffPct = before > 0 ? (diff / before) * 100 : 0;
  const beforeCount = useCountUp(before, 500, 0);
  const afterCount = useCountUp(after, 500, 200);
  const positive = diff >= 0;
  return (
    <div className="glass p-4 card-hover">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className="text-teal-600" />
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase">Before</div>
          <div className="text-lg font-bold text-slate-700">{beforeCount.toFixed(decimals)}{unit}</div>
        </div>
        <div className="text-2xl text-slate-300">→</div>
        <div className="text-right">
          <div className="text-[10px] font-bold text-slate-400 uppercase">After</div>
          <div className="text-lg font-bold text-teal-700">{afterCount.toFixed(decimals)}{unit}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: positive ? '#22c55e' : '#f43f5e' }}>
        {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        {positive ? '+' : ''}{diff.toFixed(decimals)}{unit} ({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(0)}%)
      </div>
    </div>
  );
}
