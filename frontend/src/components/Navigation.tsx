import React from 'react';
import { Home, BatteryCharging, ShieldAlert, Box, LineChart, User, Menu } from 'lucide-react';

export type TabType = 'home' | 'battery' | 'guardian' | 'simulator' | 'analytics' | 'profile';
export type DrawerType = 'doctor' | 'assistant' | 'twin' | 'charging' | 'alerts' | 'bms' | 'research' | 'reports' | 'settings' | 'company' | 'trends';

interface NavigationProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenDrawer: () => void;
  bmsConnected?: boolean;
  isVisible?: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  onOpenDrawer,
  isVisible = true,
}) => {
  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'battery', label: 'Battery', icon: BatteryCharging },
    { id: 'guardian', label: 'AI Guardian', icon: ShieldAlert },
    { id: 'simulator', label: 'Simulator', icon: Box },
    { id: 'profile', label: 'Profile', icon: User },
  ] as const;

  return (
    <div
      className={`fixed sm:absolute bottom-0 left-0 right-0 z-50 bg-white/98 backdrop-blur-md border-t border-slate-200/80 pt-1 pb-1.5 px-2 select-none shadow-lg w-full transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <div className="grid w-full max-w-xl grid-cols-6 items-center gap-1 mx-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onSelectTab(t.id)}
              className={`relative flex w-full min-w-0 flex-col items-center gap-0.5 px-1 py-1 transition-all cursor-pointer ${
                isActive ? 'text-emerald-600 font-extrabold' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              {isActive && (
                <span className="absolute -top-1 w-6 h-0.5 bg-emerald-500 rounded-full" />
              )}
              <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-600 stroke-[2.5]' : 'stroke-[1.8]'}`} />
              <span className="w-full truncate text-center text-[9px] sm:text-[10px] font-bold tracking-tight">{t.label}</span>
            </button>
          );
        })}
        <button
          onClick={onOpenDrawer}
          className="flex w-full min-w-0 flex-col items-center gap-0.5 px-1 py-1 text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
        >
          <Menu className="w-5 h-5 stroke-[1.8]" />
          <span className="w-full truncate text-center text-[9px] sm:text-[10px] font-bold tracking-tight">Menu</span>
        </button>
      </div>

      {/* iOS Home Indicator Bar */}
      <div className="w-28 h-1 bg-slate-300 rounded-full mx-auto mt-1.5" />
    </div>
  );
};
