import { useEffect, useState, useMemo } from 'react';
import { ArrowRight, Clock, MapPin, Train, Building2, Gauge, Sparkles, TrendingUp, Footprints, Route } from 'lucide-react';
import { TransitMap, ReachabilityLayer, OriginMarker } from '@/shared/map';
import { LocationSearch } from '@/features/reachability';
import { ServiceMarker } from '@/features/essential-services';
import { generateReachPolygon, mapAreaToKm2 } from '@/shared/data/mock/reachability';
import { polygonArea } from '@/shared/lib/spatial';
import { usePrefersReducedMotion, useCountUp, useScrollReveal } from '@/shared/hooks';
import { SERVICES, TRANSIT_LINES, CITY_CENTER } from '@/shared/data';
import type { RailStop } from '@/features/reachability';
import type { MapPoint } from '@/shared/types/location';
import type { PageId } from '@/app/routes';

/**
 * Landing-page visual preview only.
 *
 * This uses the prototype SVG's {x, y} coordinates and must not be used
 * for Epic 3 first-mile results. Real first-mile distance/time is routed
 * through OTP over the OSM pedestrian network.
 */
function findNearbyPreviewStops(
  origin: MapPoint,
  stops: MapPoint[],
  radius = 80,
): MapPoint[] {
  return stops.filter(
    stop =>
      Math.hypot(
        stop.x - origin.x,
        stop.y - origin.y,
      ) <= radius,
  );
}

interface LandingPageProps {
  onNavigate: (page: PageId) => void;
  onSearchSelect: (stop: RailStop) => void;
}

export function LandingPage({ onNavigate, onSearchSelect }: LandingPageProps) {
  const reduced = usePrefersReducedMotion();
  const [searchResult, setSearchResult] = useState<RailStop | null>(null);
  const [showPolygon, setShowPolygon] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [showWalking, setShowWalking] = useState(false);
  const heroRef = useScrollReveal<HTMLDivElement>();
  const statsRef = useScrollReveal<HTMLDivElement>();

  // Animate the hero map preview on load
  useEffect(() => {
    const t1 = setTimeout(() => setShowWalking(true), 300);
    const t2 = setTimeout(() => setShowPolygon(true), 600);
    const t3 = setTimeout(() => setShowPins(true), 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // The hero preview stays on the prototype canvas, so it cannot follow a real stop
  // coordinate. Selecting a stop here hands it to the map page as the starting point.
  const origin = CITY_CENTER;
  const polygon = useMemo(() => generateReachPolygon(origin, 30, 42), [origin]);
  const areaKm2 = useMemo(() => mapAreaToKm2(polygonArea(polygon)), [polygon]);

  const allStops = useMemo(() => {
    const stops: MapPoint[] = [];
    TRANSIT_LINES.forEach(line => line.stops.forEach(stop => stops.push(stop.pos)));
    return stops;
  }, []);
  const nearby = useMemo(
    () => findNearbyPreviewStops(origin, allStops, 70),
    [origin, allStops],
  );
  const reachableServices = useMemo(
    () => SERVICES.filter(s => {
      const dx = s.pos.x - origin.x, dy = s.pos.y - origin.y;
      return Math.hypot(dx, dy) < 120;
    }),
    [origin]
  );

  const handleSearch = (stop: RailStop) => {
    setSearchResult(stop);
    onSearchSelect(stop);
    setShowPolygon(false);
    setShowPins(false);
    setShowWalking(false);
    setTimeout(() => setShowWalking(true), 100);
    setTimeout(() => setShowPolygon(true), 400);
    setTimeout(() => setShowPins(true), 800);
  };

  const animatedArea = useCountUp(showPolygon ? areaKm2 : 0, 1000, 600);
  const animatedServices = useCountUp(showPins ? reachableServices.length : 0, 800, 1000);

  return (
    <div className="min-h-screen">
      {/* Background gradients */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 15% 20%, rgba(20,184,166,0.08) 0%, transparent 50%), radial-gradient(ellipse at 85% 80%, rgba(37,99,235,0.06) 0%, transparent 50%)' }} />
      </div>

      {/* Hero Section */}
      <section className="relative pt-24 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[1400px] mx-auto">
          <div ref={heroRef.ref} className={`grid lg:grid-cols-2 gap-8 lg:gap-12 items-center ${heroRef.visible ? 'fade-slide-up' : 'opacity-0'}`}>
            {/* Left: text */}
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-chip mb-6">
                <Sparkles size={14} className="text-teal-600" />
                <span className="text-xs font-semibold text-teal-700">Transit-Oriented Accessibility Mapping</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 leading-[1.05] mb-5 text-balance">
                See how far you can go in{' '}
                <span className="bg-gradient-to-r from-teal-600 to-teal-500 bg-clip-text text-transparent">30 minutes</span>
              </h1>
              <p className="text-lg text-slate-600 leading-relaxed mb-8 max-w-xl">
                TransitReach maps real transit reachability across Klang Valley — where you can walk, ride, and reach essential services within any time budget.
              </p>

              {/* Search */}
              <div className="max-w-md mb-6">
                <LocationSearch onSelect={handleSearch} selected={searchResult} />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => onNavigate('map')} className="btn-primary inline-flex items-center gap-2">
                  Explore the Map
                  <ArrowRight size={18} />
                </button>
                <button onClick={() => onNavigate('methodology')} className="btn-secondary inline-flex items-center gap-2">
                  <Route size={16} />
                  Methodology
                </button>
              </div>
            </div>

            {/* Right: animated map preview */}
            <div className="relative">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-slate-900/10 float-soft" style={{ aspectRatio: '10/7' }}>
                <TransitMap showTransit={true} showRoads={true} />
                {/* Overlays */}
                <svg viewBox="0 0 1000 700" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid slice">
                  {showPolygon && <ReachabilityLayer points={polygon} color="#14b8a6" fillOpacity={0.15} animate={!reduced} />}
                  {showPins && reachableServices.slice(0, 8).map((s, i) => (
                    <ServiceMarker key={s.id} service={s} animateIn={!reduced} index={i} />
                  ))}
                  <OriginMarker pos={origin} animate={!reduced} showPulse={showPolygon} />
                </svg>

                {/* Floating stat card */}
                {showPolygon && (
                  <div className="absolute bottom-4 left-4 glass-strong px-4 py-3 fade-slide-up" style={{ animationDelay: '800ms' }}>
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Reachable Area</div>
                        <div className="text-xl font-bold text-slate-900">{animatedArea.toFixed(1)} km²</div>
                      </div>
                      <div className="w-px h-8 bg-slate-200" />
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Services</div>
                        <div className="text-xl font-bold text-slate-900">{Math.round(animatedServices)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="px-4 sm:px-6 lg:px-8 py-8">
        <div ref={statsRef.ref} className={`max-w-[1400px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-4 ${statsRef.visible ? 'fade-slide-up' : 'opacity-0'}`}>
          {[
            { icon: Train, label: 'Transit Lines', value: 4, suffix: '', color: '#2563eb' },
            { icon: Building2, label: 'Service Points', value: 43, suffix: '', color: '#0d9488' },
            { icon: MapPin, label: 'Areas Mapped', value: 6, suffix: '', color: '#f59e0b' },
            { icon: Clock, label: 'Time Budgets', value: 4, suffix: '', color: '#8b5cf6' },
          ].map((stat, i) => (
            <StatCard key={i} stat={stat} index={i} />
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section className="px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-[1400px] mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">Built for everyday mobility decisions</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">From choosing where to live to planning a new bus route — TransitReach gives you the data to understand access.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: MapPin, title: 'Reachability Mapping', desc: 'Draw reachable areas from any point using real transit schedules and walking networks.', color: '#0d9488', page: 'map' as PageId },
              { icon: Building2, title: 'Essential Services', desc: 'See which hospitals, schools, markets, and government offices fall within reach.', color: '#e11d48', page: 'services' as PageId },
              { icon: Clock, title: 'Time-of-Day Comparison', desc: 'Compare morning and evening reach to see how access shifts with traffic and schedules.', color: '#2563eb', page: 'time' as PageId },
              { icon: Route, title: 'Scenario Modelling', desc: 'Test proposed routes or suspend existing ones to see how access changes.', color: '#8b5cf6', page: 'scenario' as PageId },
              { icon: TrendingUp, title: 'Area Typology', desc: 'Classify neighbourhoods by walkability, transit, and service access scores.', color: '#f59e0b', page: 'typology' as PageId },
              { icon: Gauge, title: 'Confidence Scoring', desc: 'Every result includes a data-confidence grade so you know what to trust.', color: '#22c55e', page: 'methodology' as PageId },
            ].map((feature, i) => (
              <FeatureCard key={i} feature={feature} index={i} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-3xl mx-auto text-center glass-strong p-10">
          <Footprints size={36} className="mx-auto text-teal-600 mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Ready to explore your city's reach?</h2>
          <p className="text-slate-600 mb-6">Pick a location, set your time budget, and see exactly where transit can take you.</p>
          <button onClick={() => onNavigate('map')} className="btn-primary inline-flex items-center gap-2 mx-auto">
            Open the Map
            <ArrowRight size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}

function StatCard({ stat, index }: { stat: { icon: typeof Train; label: string; value: number; suffix: string; color: string }; index: number }) {
  const Icon = stat.icon;
  const count = useCountUp(stat.value, 600, index * 80);
  return (
    <div className="glass p-5 card-hover">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${stat.color}15` }}>
        <Icon size={20} style={{ color: stat.color }} />
      </div>
      <div className="text-3xl font-bold text-slate-900" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {Math.round(count)}{stat.suffix}
      </div>
      <div className="text-sm font-semibold text-slate-500 mt-0.5">{stat.label}</div>
    </div>
  );
}

function FeatureCard({ feature, index, onNavigate }: {
  feature: { icon: typeof MapPin; title: string; desc: string; color: string; page: PageId };
  index: number;
  onNavigate: (page: PageId) => void;
}) {
  const Icon = feature.icon;
  const reveal = useScrollReveal<HTMLDivElement>();
  return (
    <div
      ref={reveal.ref}
      className={`card p-6 card-hover cursor-pointer ${reveal.visible ? 'fade-slide-up' : 'opacity-0'}`}
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={() => onNavigate(feature.page)}
    >
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: `${feature.color}15` }}>
        <Icon size={24} style={{ color: feature.color }} />
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-2">{feature.title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{feature.desc}</p>
      <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-600 group">
        Learn more
        <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  );
}
