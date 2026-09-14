import { useState } from 'react';
import { MapPin, Clock, Footprints, Building2, Gauge, ArrowRight, Check, Database, GitBranch, Shield } from 'lucide-react';
import { useStaggeredReveal } from '@/shared/hooks';
import { METHODOLOGY_STEPS } from '@/shared/data';
import type { MethodologyStep } from '@/shared/types/methodology';

const STEP_ICONS: Record<string, typeof MapPin> = {
  MapPin, Clock, Footprints, Building2, Gauge,
};

export function MethodologyPage() {
  const [activeStep, setActiveStep] = useState(0);
  const revealCount = useStaggeredReveal(METHODOLOGY_STEPS.length, 100);

  return (
    <div className="min-h-screen pt-16">
      <div className="fixed inset-0 -z-10" style={{ background: 'radial-gradient(ellipse at 15% 20%, rgba(20,184,166,0.06) 0%, transparent 50%), radial-gradient(ellipse at 85% 80%, rgba(37,99,235,0.04) 0%, transparent 50%)' }} />

      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10 fade-slide-up">
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Methodology</h1>
          <p className="text-lg text-slate-600 max-w-2xl">
            How TransitReach computes transit-based accessibility, from stop identification to confidence scoring.
          </p>
        </div>

        {/* Steps flow */}
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-slate-200" />

          <div className="space-y-6">
            {METHODOLOGY_STEPS.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                index={i}
                active={activeStep === i}
                visible={i < revealCount}
                onClick={() => setActiveStep(i)}
              />
            ))}
          </div>
        </div>

        {/* Data sources */}
        <div className="mt-12">
          <h2 className="text-xl font-bold text-slate-900 mb-4 fade-slide-up">Data Sources</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: GitBranch, title: 'OpenStreetMap', desc: 'Pedestrian network, road geometry, and POI locations.', color: '#22c55e' },
              { icon: Clock, title: 'GTFS Schedules', desc: 'Transit timetables, headways, and stop locations.', color: '#2563eb' },
              { icon: Database, title: 'Government Open Data', desc: 'Facility registries and service boundaries.', color: '#f59e0b' },
            ].map((src, i) => {
              const Icon = src.icon;
              return (
                <div
                  key={i}
                  className="card p-5 fade-slide-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${src.color}15` }}>
                    <Icon size={20} style={{ color: src.color }} />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mb-1">{src.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{src.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Confidence grading */}
        <div className="mt-12">
          <h2 className="text-xl font-bold text-slate-900 mb-4 fade-slide-up">Confidence Grading</h2>
          <div className="glass p-6 fade-slide-up">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={18} className="text-teal-600" />
              <span className="text-sm font-bold text-slate-700">Every result includes a data-confidence grade</span>
            </div>
            <div className="grid sm:grid-cols-5 gap-3">
              {[
                { grade: 'A', score: '80–100', label: 'High', color: '#22c55e' },
                { grade: 'B', score: '60–79', label: 'Good', color: '#84cc16' },
                { grade: 'C', score: '40–59', label: 'Moderate', color: '#f59e0b' },
                { grade: 'D', score: '20–39', label: 'Low', color: '#f97316' },
                { grade: 'E', score: '0–19', label: 'Very Low', color: '#f43f5e' },
              ].map((g, i) => (
                <div key={i} className="text-center p-3 rounded-xl" style={{ background: `${g.color}10` }}>
                  <div className="text-2xl font-bold mb-1" style={{ color: g.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{g.grade}</div>
                  <div className="text-xs font-bold text-slate-700">{g.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{g.score}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <button className="btn-primary inline-flex items-center gap-2 mx-auto">
            Try it on the Map
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step, index, active, visible, onClick,
}: {
  step: MethodologyStep;
  index: number;
  active: boolean;
  visible: boolean;
  onClick: () => void;
}) {
  const Icon = STEP_ICONS[step.icon] ?? MapPin;
  return (
    <div
      className={`relative pl-16 transition-all duration-300 ${visible ? 'fade-slide-up' : 'opacity-0'}`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Node */}
      <button
        onClick={onClick}
        className={`absolute left-0 top-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 ${
          active ? 'bg-gradient-to-br from-teal-400 to-teal-600 shadow-lg shadow-teal-500/30' : 'glass'
        }`}
        style={{ zIndex: 1 }}
      >
        {active ? (
          <Icon size={22} color="white" />
        ) : (
          <Icon size={20} className="text-slate-500" />
        )}
      </button>

      {/* Card */}
      <div
        className={`card p-5 cursor-pointer transition-all duration-200 ${active ? 'ring-2 ring-teal-300 shadow-md' : 'hover:shadow-md'}`}
        onClick={onClick}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-teal-600">Step {index + 1}</span>
          {active && (
            <span className="text-xs text-slate-400">·</span>
          )}
          {active && (
            <span className="text-xs font-semibold text-slate-500">Active</span>
          )}
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-2">{step.title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed mb-3">{step.description}</p>
        {active && (
          <div className="space-y-1.5 fade-in">
            {step.details.map((detail, i) => (
              <div key={i} className="flex items-start gap-2">
                <Check size={14} className="text-teal-600 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-slate-600">{detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
