import { useState } from 'react';
import { TrendingUp, Footprints, Train, Building2, Route, MapPin, Users } from 'lucide-react';
import { TransitMap } from '@/shared/map';
import { AreaCluster } from './components/AreaCluster';
import { Drawer } from '@/shared/ui';
import { usePrefersReducedMotion, useCountUp, useAnimatedWidth, useStaggeredReveal } from '@/shared/hooks';
import { AREA_PROFILES } from '@/shared/data';
import type { AreaProfile } from '@/shared/types/area';

const TYPOLOGY_COLORS: Record<string, string> = {
  'urban-core': '#0d9488',
  'suburban': '#2563eb',
  'transit-oriented': '#7c3aed',
  'peri-urban': '#f59e0b',
  'rural': '#22c55e',
};

const TYPOLOGY_LABELS: Record<string, string> = {
  'urban-core': 'Urban Core',
  'suburban': 'Suburban',
  'transit-oriented': 'Transit-Oriented',
  'peri-urban': 'Peri-Urban',
  'rural': 'Rural',
};

export function TypologyPage() {
  const reduced = usePrefersReducedMotion();
  const [selectedArea, setSelectedArea] = useState<AreaProfile | null>(null);
  const [hoveredArea, setHoveredArea] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const revealCount = useStaggeredReveal(AREA_PROFILES.length, 80);

  const handleAreaClick = (area: AreaProfile) => {
    setSelectedArea(area);
    setDrawerOpen(true);
  };

  return (
    <div className="min-h-screen pt-16">
      <div className="fixed inset-0 -z-10" style={{ background: 'radial-gradient(ellipse at 15% 20%, rgba(20,184,166,0.06) 0%, transparent 50%), radial-gradient(ellipse at 85% 80%, rgba(37,99,235,0.04) 0%, transparent 50%)' }} />

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 fade-slide-up">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Area Typology</h1>
          <p className="text-slate-600">Classify neighbourhoods by walkability, transit access, and service availability.</p>
        </div>

        <div className="grid lg:grid-cols-[1fr_400px] gap-6">
          {/* Map */}
          <div className="relative rounded-2xl overflow-hidden shadow-lg" style={{ aspectRatio: '10/7', minHeight: '400px' }}>
            <TransitMap showTransit showRoads />
            <svg viewBox="0 0 1000 700" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid slice">
              {AREA_PROFILES.map((area, i) => (
                <AreaCluster
                  key={area.id}
                  pos={area.pos}
                  radius={area.radius}
                  color={TYPOLOGY_COLORS[area.typology]}
                  label={area.name}
                  typology={area.typology}
                  selected={selectedArea?.id === area.id}
                  hovered={hoveredArea === area.id}
                  onClick={() => handleAreaClick(area)}
                  onHover={setHoveredArea}
                  animateIn={!reduced}
                  index={i}
                />
              ))}
              {/* Similar area rings */}
              {selectedArea && selectedArea.similarAreas.map(simId => {
                const sim = AREA_PROFILES.find(a => a.id === simId);
                if (!sim) return null;
                return (
                  <g key={simId}>
                    <circle
                      cx={sim.pos.x}
                      cy={sim.pos.y}
                      r={sim.radius + 8}
                      fill="none"
                      stroke={TYPOLOGY_COLORS[sim.typology]}
                      strokeWidth="2"
                      strokeOpacity="0.4"
                      strokeDasharray="4 4"
                      className="pulse-ring"
                      style={{ animationDuration: '2000ms', animationIterationCount: 'infinite' }}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Typology legend */}
            <div className="absolute bottom-4 left-4 glass-strong p-3.5 max-w-[200px]">
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Typologies</div>
              <div className="space-y-1.5">
                {Object.entries(TYPOLOGY_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md" style={{ background: TYPOLOGY_COLORS[key], opacity: 0.3, border: `1.5px solid ${TYPOLOGY_COLORS[key]}` }} />
                    <span className="text-xs font-medium text-slate-600">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Area cards */}
          <div className="space-y-3 max-h-[600px] overflow-y-auto scrollbar-thin pr-1">
            {AREA_PROFILES.map((area, i) => (
              <AreaCard
                key={area.id}
                area={area}
                visible={i < revealCount}
                selected={selectedArea?.id === area.id}
                hovered={hoveredArea === area.id}
                onClick={() => handleAreaClick(area)}
                onHover={setHoveredArea}
                index={i}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={selectedArea?.name} width="440px">
        {selectedArea && <AreaProfileDetail area={selectedArea} />}
      </Drawer>
    </div>
  );
}

function AreaCard({
  area, visible, selected, hovered, onClick, onHover, index,
}: {
  area: AreaProfile;
  visible: boolean;
  selected: boolean;
  hovered: boolean;
  onClick: () => void;
  onHover: (id: string | null) => void;
  index: number;
}) {
  const color = TYPOLOGY_COLORS[area.typology];
  const overallScore = Math.round(
    (area.scores.walkability + area.scores.transit + area.scores.serviceAccess + area.scores.roadConnectivity + area.scores.affordability) / 5
  );
  const scoreCount = useCountUp(visible ? overallScore : 0, 600, index * 40);

  return (
    <div
      className={`card p-4 cursor-pointer transition-all duration-200 ${
        selected ? 'ring-2 ring-teal-400' : hovered ? 'shadow-md' : ''
      } ${visible ? 'fade-slide-up' : 'opacity-0'}`}
      style={{ animationDelay: `${index * 40}ms` }}
      onMouseEnter={() => onHover(area.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-bold text-slate-900">{area.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-xs font-semibold text-slate-500">{TYPOLOGY_LABELS[area.typology]}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold" style={{ color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {Math.round(scoreCount)}
          </div>
          <div className="text-[10px] font-bold text-slate-400 uppercase">Score</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1">
          <Footprints size={11} className="text-teal-600" />
          <span className="text-slate-500">Walk:</span>
          <span className="font-bold text-slate-700">{area.scores.walkability}</span>
        </div>
        <div className="flex items-center gap-1">
          <Train size={11} className="text-blue-500" />
          <span className="text-slate-500">Transit:</span>
          <span className="font-bold text-slate-700">{area.scores.transit}</span>
        </div>
        <div className="flex items-center gap-1">
          <Building2 size={11} className="text-rose-500" />
          <span className="text-slate-500">Services:</span>
          <span className="font-bold text-slate-700">{area.scores.serviceAccess}</span>
        </div>
        <div className="flex items-center gap-1">
          <Users size={11} className="text-amber-500" />
          <span className="text-slate-500">Pop:</span>
          <span className="font-bold text-slate-700">{(area.population / 1000).toFixed(0)}k</span>
        </div>
      </div>
    </div>
  );
}

function AreaProfileDetail({ area }: { area: AreaProfile }) {
  const color = TYPOLOGY_COLORS[area.typology];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `${color}15` }}>
          <MapPin size={28} style={{ color }} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>{TYPOLOGY_LABELS[area.typology]}</div>
          <div className="text-sm text-slate-500">Pop. {area.population.toLocaleString()} · {area.density.toLocaleString()} /km²</div>
        </div>
      </div>

      {/* Score bars */}
      <div>
        <div className="text-xs font-bold text-slate-500 uppercase mb-3">Accessibility Scores</div>
        <div className="space-y-3">
          {([
            { label: 'Walkability', value: area.scores.walkability, icon: Footprints, color: '#0d9488' },
            { label: 'Transit Access', value: area.scores.transit, icon: Train, color: '#2563eb' },
            { label: 'Service Access', value: area.scores.serviceAccess, icon: Building2, color: '#e11d48' },
            { label: 'Road Connectivity', value: area.scores.roadConnectivity, icon: Route, color: '#8b5cf6' },
            { label: 'Affordability', value: area.scores.affordability, icon: TrendingUp, color: '#f59e0b' },
          ]).map((score, i) => {
            const Icon = score.icon;
            return <ScoreBar key={i} label={score.label} value={score.value} icon={Icon} color={score.color} delay={i * 80} />;
          })}
        </div>
      </div>

      {/* Feature bars */}
      <div>
        <div className="text-xs font-bold text-slate-500 uppercase mb-3">Feature Profile</div>
        <div className="space-y-2.5">
          {area.features.map((feature, i) => (
            <FeatureBar key={i} label={feature.label} value={feature.value} delay={i * 60} />
          ))}
        </div>
      </div>

      {/* Similar areas */}
      {area.similarAreas.length > 0 && (
        <div>
          <div className="text-xs font-bold text-slate-500 uppercase mb-2">Similar Areas</div>
          <div className="flex flex-wrap gap-2">
            {area.similarAreas.map(simId => {
              const sim = AREA_PROFILES.find(a => a.id === simId);
              if (!sim) return null;
              return (
                <div key={simId} className="glass-chip px-3 py-1.5 flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: TYPOLOGY_COLORS[sim.typology] }} />
                  <span className="text-xs font-semibold text-slate-700">{sim.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Footprints; color: string; delay: number }) {
  const width = useAnimatedWidth(value, 500);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Icon size={13} style={{ color }} />
          <span className="text-xs font-semibold text-slate-600">{label}</span>
        </div>
        <span className="text-xs font-bold text-slate-800">{Math.round(width)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full anim-bar"
          style={{ width: `${width}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }}
        />
      </div>
    </div>
  );
}

function FeatureBar({ label, value }: { label: string; value: number; delay: number }) {
  const width = useAnimatedWidth(value, 400);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="text-xs font-bold text-slate-700">{Math.round(width)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-teal-400 anim-bar" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
