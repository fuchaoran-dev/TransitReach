import { useState, useEffect } from 'react';
import { Navigation } from 'lucide-react';
import { useScrollPosition } from '@/shared/hooks';
import type { PageId } from './routes';
import type { NavItem } from './nav';


interface NavBarProps {
  items: NavItem[];
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

export function NavBar({ items, activePage, onNavigate }: NavBarProps) {
  const scrollY = useScrollPosition();
  const scrolled = scrollY > 20;
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  const [hoveredItem, setHoveredItem] = useState<PageId | null>(null);

  useEffect(() => {
    if (hoveredItem) {
      const el = document.querySelector(`[data-nav-id="${hoveredItem}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const parent = el.parentElement?.getBoundingClientRect();
        if (parent) {
          setIndicatorStyle({ left: rect.left - parent.left, width: rect.width });
        }
      }
    } else {
      const el = document.querySelector(`[data-nav-id="${activePage}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const parent = el.parentElement?.getBoundingClientRect();
        if (parent) {
          setIndicatorStyle({ left: rect.left - parent.left, width: rect.width });
        }
      }
    }
  }, [hoveredItem, activePage]);

  return (
    <nav className={`glass-nav fixed top-0 left-0 right-0 z-50 ${scrolled ? 'scrolled' : ''}`}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <button
            onClick={() => onNavigate('map')}
            className="flex items-center gap-2.5 group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-md shadow-teal-500/20 group-hover:scale-105 transition-transform">
              <Navigation size={18} color="white" strokeWidth={2.5} />
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-[15px] font-bold text-slate-900 leading-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                TransitReach
              </div>
              <div className="text-[10px] text-slate-500 leading-tight font-medium tracking-wide uppercase">
                Klang Valley · City Explorer
              </div>
            </div>
          </button>

          {/* Nav items */}
          <div className="hidden md:flex items-center gap-1 relative">
            {/* Sliding indicator */}
            {indicatorStyle && (
              <div
                className="absolute bottom-0 h-[3px] bg-gradient-to-r from-teal-400 to-teal-600 rounded-full transition-all duration-200 ease-out"
                style={{
                  left: indicatorStyle.left + 8,
                  width: Math.max(indicatorStyle.width - 16, 0),
                }}
              />
            )}
            {items.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  data-nav-id={item.id}
                  onClick={() => onNavigate(item.id)}
                  onMouseEnter={() => setHoveredItem(item.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-colors duration-200 ${
                    active
                      ? 'text-teal-700'
                      : 'text-slate-500 hover:text-teal-700'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={15} strokeWidth={2.2} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Mobile menu button */}
          <MobileNav items={items} activePage={activePage} onNavigate={onNavigate} />
        </div>
      </div>
    </nav>
  );
}

function MobileNav({ items, activePage, onNavigate }: { items: NavItem[]; activePage: PageId; onNavigate: (p: PageId) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="btn-icon"
        aria-label="Menu"
        aria-expanded={open}
      >
        <Navigation size={18} />
      </button>
      {open && (
        <div className="absolute top-16 right-4 glass-strong p-2 min-w-[200px] z-50 fade-slide-up">
          {items.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  active ? 'text-teal-700 bg-teal-50' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={16} strokeWidth={2.2} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
