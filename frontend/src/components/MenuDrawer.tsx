import React from 'react';
import { X, Stethoscope, MessageSquare, Flame, Zap, AlertTriangle, Radio, BookOpen, FileText, Settings, Building2, ChevronRight, TrendingUp } from 'lucide-react';
import type { DrawerType } from './Navigation';

interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDrawerItem: (item: DrawerType) => void;
  onLogout: () => void;
}

export const MenuDrawer: React.FC<MenuDrawerProps> = ({
  isOpen,
  onClose,
  onSelectDrawerItem,
  onLogout,
}) => {
  if (!isOpen) return null;

  const menuItems = [
    { id: 'trends', label: 'Battery Trends & Stress', icon: TrendingUp, tag: 'ANALYTICS' },
    { id: 'doctor', label: 'AI Battery Doctor', icon: Stethoscope, tag: 'DIAGNOSTICS' },
    { id: 'assistant', label: 'BRAIN Assistant', icon: MessageSquare, tag: 'CONVERSATIONAL' },
    { id: 'twin', label: 'Digital Twin Visualizer', icon: Flame, tag: '3D TWIN' },
    { id: 'charging', label: 'Charging Intelligence', icon: Zap, tag: 'ANALYTICS' },
    { id: 'alerts', label: 'Alerts & Emergency Mode', icon: AlertTriangle, tag: 'SAFETY' },
    { id: 'bms', label: 'Connected BMS (BLE)', icon: Radio, tag: 'HARDWARE' },
    { id: 'research', label: 'Research Dashboard', icon: BookOpen, tag: 'PINN METRICS' },
    { id: 'reports', label: 'Research PDF Reports', icon: FileText, tag: 'EXPORT' },
    { id: 'settings', label: 'System Settings', icon: Settings, tag: 'PREFERENCES' },
  ] as const;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex justify-end bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-4/5 max-w-xs sm:max-w-sm bg-white border-l border-slate-200 h-full flex flex-col p-4 shadow-2xl overflow-hidden"
      >
        {/* Drawer Header */}
        <div className="pb-3.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-900 heading-tech tracking-tight uppercase">BRAIN MODULES</h3>
              <p className="text-xs font-semibold text-slate-500">Research & Intelligence System</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:text-slate-800 border border-slate-200 transition active:scale-95"
            >
              <X className="w-5 h-5 text-red-500" />
            </button>
          </div>
        </div>

        {/* Menu Items List */}
        <div className="flex-1 my-3 space-y-2 overflow-y-auto pr-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectDrawerItem(item.id as DrawerType);
                  onClose();
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-emerald-50/70 border border-slate-200/80 hover:border-emerald-300 transition group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white border border-slate-200 text-emerald-600 shadow-sm group-hover:bg-emerald-500 group-hover:text-white transition">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold text-slate-800 group-hover:text-emerald-700 transition">
                      {item.label}
                    </div>
                    <div className="text-[9px] font-mono text-slate-400">{item.tag}</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition" />
              </button>
            );
          })}
        </div>

        {/* Logout Footer */}
        <div className="pt-3 pb-1 border-t border-slate-200 shrink-0">
          <button
            onClick={() => {
              onLogout();
              onClose();
            }}
            className="w-full py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-extrabold hover:bg-red-100 transition uppercase tracking-wider shadow-sm active:scale-98"
          >
            SIGN OUT OPERATOR
          </button>
        </div>
      </div>
    </div>
  );
};
