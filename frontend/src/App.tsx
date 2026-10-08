import React, { useState, useEffect, useRef } from 'react';
import { LoginScreen } from './screens/LoginScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { Navigation } from './components/Navigation';
import type { TabType, DrawerType } from './components/Navigation';
import { MenuDrawer } from './components/MenuDrawer';
import { Battery3DView } from './components/Battery3DView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BrainLogo } from './components/BrainLogo';
import { BleDiagnosticsModal } from './components/BleDiagnosticsModal';
import { BluetoothPairingModal } from './components/BluetoothPairingModal';
import { batteryStateService } from './services/batteryStateService';
import type { NormalizedBatteryState } from './types/telemetry';
import { bluetoothService } from './services/bluetoothService';
import type { BLEDeviceState } from './services/bluetoothService';
import { telemetrySocketService } from './services/telemetrySocket';
import { apiService } from './services/api';
import { DoctorDrawer } from './components/drawers/DoctorDrawer';
import { AssistantDrawer } from './components/drawers/AssistantDrawer';
import { ChargingDrawer } from './components/drawers/ChargingDrawer';
import { AlertsDrawer } from './components/drawers/AlertsDrawer';
import { ResearchDrawer } from './components/drawers/ResearchDrawer';
import { ReportsDrawer } from './components/drawers/ReportsDrawer';
import { SettingsDrawer } from './components/drawers/SettingsDrawer';
import { CompanyAdminDrawer } from './components/drawers/CompanyAdminDrawer';
import { BatteryTrendsDrawer } from './components/drawers/BatteryTrendsDrawer';
import { firebaseSyncService } from './services/firebaseSyncService';
import { PinnEngine } from './services/pinnEngine';
import {
  ArrowLeft,
  Zap,
  ShieldAlert,
  Cpu,
  Activity,
  Gauge,
  Thermometer,
  ZapOff,
  Sliders,
  Radio,
  RefreshCw,
  X,
  Info,
  Bluetooth,
  Wifi,
  CheckCircle2,
  AlertCircle,
  Bell,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Heart,
  Navigation as NavigationIcon,
  BarChart2,
  ShieldCheck,
  Clock,
  BatteryCharging,
  LogOut,
  User
} from 'lucide-react';

export function App() {
  const [authState, setAuthState] = useState<'LOGIN' | 'REGISTER' | 'AUTHENTICATED'>(() => {
    try {
      const savedSession = localStorage.getItem('brain_auth_session');
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed && parsed.authenticated) {
          return 'AUTHENTICATED';
        }
      }
    } catch (e) {}
    return 'LOGIN';
  });

  const [currentUser, setCurrentUser] = useState<any>(() => {
    try {
      const savedSession = localStorage.getItem('brain_auth_session');
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed && parsed.user) {
          return parsed.user;
        }
      }
    } catch (e) {}
    return null;
  });

  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    try {
      const savedSession = localStorage.getItem('brain_auth_session');
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (typeof parsed.isDemo === 'boolean') {
          return parsed.isDemo;
        }
      }
    } catch (e) {}
    return true;
  });

  const [backendOnline, setBackendOnline] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [activeDrawerItem, setActiveDrawerItem] = useState<DrawerType | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Dynamic Hide-on-Scroll / Show-on-Scroll Taskbar state
  const [isNavVisible, setIsNavVisible] = useState(true);
  const lastScrollTop = useRef(0);

  const handleMainScroll = (e: React.UIEvent<HTMLElement>) => {
    const currentScrollTop = e.currentTarget.scrollTop;
    if (currentScrollTop <= 15) {
      setIsNavVisible(true);
    } else if (currentScrollTop > lastScrollTop.current + 8) {
      setIsNavVisible(false);
    } else if (currentScrollTop < lastScrollTop.current - 8) {
      setIsNavVisible(true);
    }
    lastScrollTop.current = currentScrollTop;
  };

  // Selected Cell Modal State
  const [selectedCell, setSelectedCell] = useState<{
    id: number;
    voltage: number;
    temp: number;
    deviation: number;
    status: 'HEALTHY' | 'WATCH' | 'WARNING' | 'CRITICAL';
    riskScore: number;
  } | null>(null);

  // Digital Twin Mode
  const [twinMode, setTwinMode] = useState<'LIVE' | 'PREDICTED'>('LIVE');

  // Simulator Controls & Output State
  const [simSpeed, setSimSpeed] = useState(85);
  const [simTemp, setSimTemp] = useState(38);
  const [simAux, setSimAux] = useState(0.3);
  const [simMode, setSimMode] = useState('FAST_CHARGE');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResults, setSimResults] = useState<{
    predictedTemp: number;
    predictedSoc: number;
    thermalStress: string;
    riskScore: number;
    safeWindow: string;
    baselineTemp: string;
    baselineSoc: string;
    baselineRisk: string;
    scooterModelName: string;
  } | null>(null);

  // Bluetooth BLE BMS State
  const [bleState, setBleState] = useState<BLEDeviceState>(bluetoothService.getState());
  const [bleConnecting, setBleConnecting] = useState(false);
  const [bleError, setBleError] = useState('');
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [batteryState, setBatteryState] = useState<NormalizedBatteryState>(batteryStateService.getSnapshot());

  useEffect(() => {
    // Refresh / link open ALWAYS defaults to LOGIN screen for clean security
    const checkBackend = async () => {
      try {
        const res = await apiService.checkBackendStatus();
        setBackendOnline(res?.online ?? false);
      } catch (err) {
        setBackendOnline(false);
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 15000);

    // Initial state is DISCONNECTED by default until user explicitly connects BLE / QR
    bluetoothService.disconnect(false);

    // Subscribe to live BLE telemetry updates
    const unsubscribeBle = bluetoothService.subscribe(() => {
      setBleState(bluetoothService.getState());
    });

    const unsubscribeBattery = batteryStateService.subscribe((state) => {
      setBatteryState(state);
      firebaseSyncService.syncTelemetryToFirebase(state);
    });

    const unsubscribeTwinTelemetry = telemetrySocketService.subscribe((packet) => {
      if (packet.transport === 'LAN_BLUETOOTH_BRIDGE') {
        bluetoothService.markLanBridgeConnected();
      } else {
        bluetoothService.markLanBridgeDisconnected();
      }
    });

    // ── QR Deep-Link Auto-Pairing ──
    // When the app is opened via a QR code link (e.g. ?pair=BATTERY_PACK_01&mode=mobile),
    // auto-open the Bluetooth Pairing modal so the user can instantly connect.
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const pairBatteryId = urlParams.get('pair');
      const mode = urlParams.get('mode');
      if (pairBatteryId && mode === 'mobile') {
        // Short delay so the app renders first
        setTimeout(() => {
          setIsPairingModalOpen(true);
        }, 800);
      }
    } catch (e) {}

    return () => {
      clearInterval(interval);
      unsubscribeBle();
      unsubscribeBattery();
      unsubscribeTwinTelemetry();
    };
  }, []);

  const getPackArchitecture = (modelStr?: string) => {
    const m = (modelStr || currentUser?.ev_model || currentUser?.evModel || '').toLowerCase();
    if (m.includes('ola')) {
      return '70V Nominal • 19S Cell Architecture (~4.0 kWh)';
    } else if (m.includes('ather')) {
      return '51.1V Nominal • 14S Cell Architecture (~3.7 kWh)';
    } else if (m.includes('tvs') || m.includes('iqube')) {
      return '52V Nominal • 14S Cell Architecture (~3.04 kWh)';
    } else if (m.includes('bajaj') || m.includes('chetak') || m.includes('vida') || m.includes('hero')) {
      return '50.4V Nominal • 14S Cell Architecture (~2.9 kWh)';
    } else if (m.includes('simple')) {
      return '51.2V Nominal • 16S Cell Architecture (~5.0 kWh)';
    }
    return '51.2V Nominal • 14S-16S EV Pack Architecture (~3.5 kWh)';
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('brain_auth_session');
    } catch (e) {}
    apiService.clearStoredToken();
    setCurrentUser(null);
    setIsDemoMode(true);
    setAuthState('LOGIN');
    setIsDrawerOpen(false);
  };

  const runWhatIfSimulation = () => {
    if (isDemoMode) {
      alert('View-Only Demo Mode: Simulation controls are locked. Please Register or Sign In to run custom simulations.');
      return;
    }
    if (batteryState.connectionState !== 'CONNECTED') {
      alert('Bluetooth BMS Hardware Required: Please connect to a Bluetooth BMS device or Simulated BLE before running What-If Simulations.');
      setIsPairingModalOpen(true);
      return;
    }
    setIsSimulating(true);
    setTimeout(() => {
      const baseTemp = batteryState.maxTemperature || batteryState.temperature || 30;
      const baseSoc = Math.round(batteryState.soc || 80);
      const baseRisk = batteryState.risk || 10;

      const userModel = (currentUser?.ev_model || currentUser?.evModel || '').toLowerCase();
      let modelScale = 1.0;
      if (userModel.includes('ola')) modelScale = 1.15;
      else if (userModel.includes('ather')) modelScale = 1.0;
      else if (userModel.includes('tvs') || userModel.includes('iqube')) modelScale = 0.9;
      else if (userModel.includes('bajaj') || userModel.includes('chetak')) modelScale = 0.85;

      const calcTemp = Math.round(baseTemp + (simSpeed * 0.12 * modelScale) + (simAux * 2.0));
      const calcSoc = Math.max(5, Math.round(baseSoc - (simSpeed * 0.22 / modelScale)));
      const calcRisk = Math.min(95, Math.round(baseRisk + (calcTemp > 45 ? (calcTemp - 40) * 2 : 5)));

      setSimResults({
        predictedTemp: calcTemp,
        predictedSoc: calcSoc,
        thermalStress: calcTemp > 48 ? 'CRITICAL THERMAL STRESS' : calcTemp > 42 ? 'ELEVATED TEMPERATURE' : 'MODERATE STRESS',
        riskScore: calcRisk,
        safeWindow: calcTemp > 48 ? '6 - 10 MIN' : calcTemp > 42 ? '12 - 18 MIN' : '22 - 30 MIN',
        baselineTemp: `${baseTemp}°C (Live BLE)`,
        baselineSoc: `${baseSoc}% (Live BLE)`,
        baselineRisk: `${baseRisk}% (Live BLE)`,
        scooterModelName: currentUser?.ev_model || currentUser?.evModel || 'EV Scooter',
      });
      setIsSimulating(false);
    }, 600);
  };

  const [registeredEmail, setRegisteredEmail] = useState('');

  if (authState === 'LOGIN') {
    return (
      <LoginScreen
        initialEmail={registeredEmail}
        onLoginSuccess={async (demo) => {
          if (demo) {
            setIsDemoMode(true);
            setCurrentUser(null);
            try {
              localStorage.setItem('brain_auth_session', JSON.stringify({
                authenticated: true,
                isDemo: true,
                user: null,
              }));
            } catch (e) {}
          } else {
            setIsDemoMode(false);
            let user = null;
            try {
              user = await apiService.getCurrentUser();
            } catch (e) {
              user = { email: registeredEmail || 'operator@brainev.com', role: 'ENGINEER' };
            }
            setCurrentUser(user);
            try {
              localStorage.setItem('brain_auth_session', JSON.stringify({
                authenticated: true,
                isDemo: false,
                user,
              }));
            } catch (e) {}
          }
          setAuthState('AUTHENTICATED');
        }}
        onNavigateRegister={() => setAuthState('REGISTER')}
      />
    );
  }

  if (authState === 'REGISTER') {
    return (
      <RegisterScreen
        onRegisterComplete={(email) => {
          if (email) setRegisteredEmail(email);
          setAuthState('LOGIN');
        }}
        onNavigateLogin={() => setAuthState('LOGIN')}
      />
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] bg-slate-950 flex items-center justify-center p-0 sm:p-4 selection:bg-emerald-500/20 relative overflow-x-hidden touch-scroll-active">
      {/* Responsive dashboard shell; it retains a compact phone layout on small screens. */}
      <div className="w-full max-w-[1440px] min-h-[100dvh] h-[100dvh] sm:min-h-0 sm:h-[calc(100dvh-2rem)] sm:max-h-[960px] sm:rounded-[28px] relative overflow-y-auto sm:overflow-hidden shadow-[0_25px_60px_-15px_rgba(0,0,0,0.25)] border-0 sm:border sm:border-slate-200 bg-slate-50 text-slate-900 flex flex-col justify-between z-10 shrink-0 pb-16 sm:pb-0 touch-scroll-active">
        
        {/* 1. CLEAN, UNCLUTTERED HEADER */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3.5 py-2 flex items-center justify-between shadow-2xs shrink-0 relative">
          <div className="flex items-center gap-2">
            {activeDrawerItem ? (
              <button
                onClick={() => setActiveDrawerItem(null)}
                className="p-1.5 bg-white rounded-xl text-emerald-600 hover:bg-emerald-50 border border-slate-200 shadow-xs cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <BrainLogo size="sm" layout="horizontal" showFullForm={false} showQuote={false} />
            )}

            {/* Connection Status Dot */}
            <span
              className={`w-2.5 h-2.5 rounded-full border border-white shadow-2xs ${
                backendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
              }`}
              title={backendOnline ? 'Database & Backend Online' : 'Offline Mode Active'}
            />
          </div>

          {/* Right Header: Notifications & Alerts Bell & User Profile */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className="relative p-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 text-slate-700 border border-slate-200 transition cursor-pointer active:scale-95"
              title="Notifications & Safety Alerts"
            >
              <Bell className="w-4 h-4 text-slate-700 hover:text-emerald-600 transition" />
              {batteryStateService.getNotifications().length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-black text-white animate-pulse">
                  {batteryStateService.getNotifications().length}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveDrawerItem(null);
                setActiveTab('profile');
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full border transition cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-slate-900 text-emerald-400 border-slate-700 shadow-sm font-black'
                  : 'bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200 font-extrabold'
              }`}
            >
              {(() => {
                const userEmail = currentUser?.email?.toLowerCase().trim();
                const avatarSrc = currentUser?.avatar_photo || (userEmail ? localStorage.getItem(`brain_avatar_${userEmail}`) : null);
                if (avatarSrc) {
                  return (
                    <img
                      src={avatarSrc}
                      alt="Avatar"
                      className="w-4 h-4 rounded-full object-cover shrink-0"
                    />
                  );
                }
                return <User className="w-3.5 h-3.5 text-emerald-600" />;
              })()}
              <span className="text-xs truncate max-w-[110px]">
                {isDemoMode ? 'Demo Guest' : (currentUser?.full_name?.split(' ')[0] || 'Operator')}
              </span>
            </button>
          </div>

          {/* Notification Popover Window (Modern White Translucent Glassmorphism) */}
          {isNotificationsOpen && (
            <div className="absolute right-2 top-11 w-[calc(100%-16px)] max-w-[340px] bg-white/95 backdrop-blur-xl text-slate-900 rounded-2xl p-3.5 shadow-2xl border border-slate-200/90 z-50 animate-fadeIn space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5 text-xs font-black uppercase text-emerald-600">
                  <Bell className="w-3.5 h-3.5" />
                  Live System Notifications
                </div>
                <div className="flex items-center gap-2">
                  {batteryStateService.getNotifications().length > 0 && (
                    <button
                      onClick={() => {
                        batteryStateService.clearNotifications();
                      }}
                      className="text-[10px] font-extrabold text-red-500 hover:text-red-700 hover:underline px-1.5 py-0.5 rounded transition cursor-pointer"
                    >
                      Clear All
                    </button>
                  )}
                  <button
                    onClick={() => setIsNotificationsOpen(false)}
                    className="text-slate-400 hover:text-slate-700 p-1 rounded-lg transition cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto text-xs pr-1">
                {batteryStateService.getNotifications().length > 0 ? (
                  batteryStateService.getNotifications().map((notif) => (
                    <div
                      key={notif.id}
                      className={`p-2.5 rounded-xl border flex items-start justify-between gap-2 transition ${
                        notif.type === 'warning'
                          ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                          : notif.type === 'error'
                          ? 'bg-red-50/90 border-red-200 text-red-900'
                          : notif.type === 'success'
                          ? 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                            notif.type === 'warning'
                              ? 'bg-amber-500'
                              : notif.type === 'error'
                              ? 'bg-red-500'
                              : notif.type === 'success'
                              ? 'bg-emerald-500'
                              : 'bg-blue-500'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-[11px] truncate">{notif.title}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{notif.message}</div>
                          <div className="text-[9px] text-slate-400 font-mono mt-1">{notif.timestamp}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => batteryStateService.dismissNotification(notif.id)}
                        className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition shrink-0 cursor-pointer"
                        title="Dismiss notification"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="py-6 px-4 text-center text-slate-400 text-xs font-semibold flex flex-col items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500/80" />
                    <span>No active notifications</span>
                    <span className="text-[10px] text-slate-400 font-normal">No unread notices. Live battery risk monitoring continues.</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <button
                  onClick={() => {
                    setIsNotificationsOpen(false);
                    setActiveDrawerItem('alerts');
                  }}
                  className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[10px] rounded-xl transition text-center uppercase tracking-wider cursor-pointer shadow-xs"
                >
                  View Full Safety Log
                </button>
                <button
                  onClick={() => setIsNotificationsOpen(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-xl transition uppercase cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </header>

        {/* 2. MAIN CONTENT BODY */}
        <main onScroll={handleMainScroll} className="relative z-10 p-3 sm:p-4 space-y-4 flex-1 overflow-y-auto min-h-0 pb-20 touch-scroll-active">

          {/* LIVE BLUETOOTH CONNECTIVITY BAR */}
          <div 
            onClick={() => setIsPairingModalOpen(true)}
            className={`p-2.5 px-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between shadow-xs ${
              bleState.connected && batteryState.safetyState === 'CRITICAL'
                ? 'bg-gradient-to-r from-slate-950 to-red-950 text-red-200 border-red-500/60 hover:bg-red-900/60'
                : bleState.connected && batteryState.safetyState !== 'HEALTHY'
                ? 'bg-gradient-to-r from-slate-900 to-amber-950 text-amber-200 border-amber-500/60 hover:bg-amber-900/60'
                : bleState.connected
                ? 'bg-gradient-to-r from-slate-900 to-emerald-950 text-emerald-300 border-emerald-500/50 hover:bg-emerald-900/60'
                : 'bg-slate-900 text-slate-300 border-amber-500/40 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`p-1.5 rounded-xl border ${bleState.connected && batteryState.safetyState === 'CRITICAL' ? 'bg-red-500/20 border-red-400 text-red-300' : bleState.connected && batteryState.safetyState !== 'HEALTHY' ? 'bg-amber-500/20 border-amber-400 text-amber-300' : bleState.connected ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400' : 'bg-amber-500/20 border-amber-400 text-amber-400'}`}>
                <Bluetooth className={`w-4 h-4 ${bleState.connected ? 'animate-pulse' : ''}`} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider">
                  <span className={`w-2 h-2 rounded-full ${bleState.connected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                  <span>{bleState.connected ? (bleState.mode === 'NETWORK_BRIDGE' ? 'CONNECTED VIA WI-FI · BLUETOOTH-STYLE LINK' : 'BLUETOOTH CONNECTED · LIVE GATT') : 'BLUETOOTH DISCONNECTED'}</span>
                </div>
                <div className="text-[11px] font-extrabold text-white truncate mt-0.5">
                  {bleState.connected ? (
                    <span>{bleState.deviceName || 'BRAIN Digital Twin Battery'} • {batteryState.voltage}V | {batteryState.temperature}°C | {batteryState.soc}% SOC</span>
                  ) : (
                    <span>Tap to connect to a battery or Digital Twin</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-xl border ${bleState.connected ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'}`}>
                {bleState.connected ? 'LIVE 5Hz' : 'CONNECT'}
              </span>
            </div>
          </div>
          {isDemoMode && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2 px-3 flex items-center justify-between text-[11px] font-bold text-amber-800 animate-fadeIn">
              <span>VIEW-ONLY DEMO MODE: Actions & saved data locked.</span>
              <button
                onClick={() => setAuthState('LOGIN')}
                className="underline text-amber-900 font-black ml-1.5 shrink-0 cursor-pointer hover:text-emerald-700"
              >
                Sign In / Register
              </button>
            </div>
          )}
          <ErrorBoundary>
        {activeDrawerItem ? (
          <div className="w-full space-y-4 animate-fadeIn">
            {activeDrawerItem === 'twin' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      onClick={() => setActiveDrawerItem(null)}
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer shrink-0"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <h2 className="text-sm sm:text-base font-black text-slate-900 heading-tech uppercase flex items-center gap-1.5 truncate">
                        3D DIGITAL TWIN VISUALIZER
                      </h2>
                      <p className="text-[11px] text-slate-500 font-semibold truncate">
                        Real-Time PINN Physics Mesh & Cell Telemetry
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setTwinMode('LIVE')}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg ${
                        twinMode === 'LIVE'
                          ? 'bg-emerald-500 text-white shadow-emerald'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      LIVE TELEMETRY
                    </button>
                    <button
                      onClick={() => setTwinMode('PREDICTED')}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg ${
                        twinMode === 'PREDICTED'
                          ? 'bg-red-500 text-white shadow-red'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      PREDICTED PINN STATE
                    </button>
                  </div>
                </div>

                <Battery3DView status={batteryState.safetyState} isConnected={batteryState.connectionState === 'CONNECTED'} expanded={true} interactive={true} />
              </div>
            ) : activeDrawerItem === 'bms' ? (
              <div className="space-y-4 animate-fadeIn">
                {/* BLE BMS STATUS CARD */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        onClick={() => setActiveDrawerItem(null)}
                        className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer shrink-0"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 text-emerald-600 shadow-sm shrink-0">
                        <Bluetooth className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm sm:text-base font-black text-slate-900 heading-tech truncate">BLUETOOTH LOW ENERGY (BLE) BMS</h3>
                        <p className="text-[11px] font-semibold text-slate-500 truncate">Physical Hardware &amp; Cloud Database Sync</p>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-extrabold px-3 py-1 rounded-full border shrink-0 ${
                        bleState.connected
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                          : 'bg-slate-100 border-slate-300 text-slate-500'
                      }`}
                    >
                      • {bleState.connected ? bleState.mode : 'DISCONNECTED'}
                    </span>
                  </div>

                  {bleError && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                      <span>{bleError}</span>
                    </div>
                  )}

                  {/* Device Info & RSSI */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">DEVICE NAME</div>
                      <div className="text-xs font-extrabold text-slate-900 mt-0.5 truncate">
                        {bleState.deviceName || 'BRAIN Virtual Battery Simulation (8S LFP)'}
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">DEVICE MAC / ID</div>
                      <div className="text-xs font-mono font-bold text-emerald-600 mt-0.5">
                        {bleState.deviceId || 'BRAIN-SIM-8S'}
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">SIGNAL STRENGTH (RSSI)</div>
                      <div className="text-xs font-mono font-bold text-slate-700 mt-0.5">
                        {bleState.rssi ? `${bleState.rssi} dBm (Strong)` : '-42 dBm (Strong)'}
                      </div>
                    </div>
                  </div>

                  {/* Realtime BLE Telemetry Frame */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-emerald-300 shadow-sm space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold border-b border-slate-200 pb-2">
                      <span className="flex items-center gap-1.5 text-emerald-600 font-extrabold">
                        <CheckCircle2 className="w-4 h-4" /> LIVE BLE TELEMETRY STREAMING
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {new Date().toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block">VOLTAGE</span>
                        <span className="text-base font-black text-emerald-600">{batteryState.voltage} V</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block">CURRENT</span>
                        <span className="text-base font-black text-emerald-600">{batteryState.current} A</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block">TEMPERATURE</span>
                        <span className="text-base font-black text-red-500">{batteryState.temperature} °C</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block">SOC / SOH</span>
                        <span className="text-base font-black text-slate-900">{batteryState.soc}% / {batteryState.soh}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Bluetooth Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <button
                      onClick={() => {
                        setBleError('');
                        setIsPairingModalOpen(true);
                      }}
                      className="py-2.5 px-4 bg-emerald-500 text-white font-extrabold text-xs rounded-xl hover:bg-emerald-600 transition flex items-center justify-center gap-2 shadow-emerald uppercase cursor-pointer"
                    >
                      <Bluetooth className="w-4 h-4" />
                      <span>SCAN &amp; PAIR BLE BMS</span>
                    </button>

                    <button
                      onClick={() => {
                        setBleError('');
                        bluetoothService.startSimulatedBleConnectionWithName('BRAIN Virtual Battery Simulation (8S LFP)', 'BRAIN-SIM-8S');
                        setBleState(bluetoothService.getState());
                      }}
                      className="py-2.5 px-4 bg-emerald-50 text-emerald-700 border-2 border-emerald-500 font-extrabold text-xs rounded-xl hover:bg-emerald-100 transition flex items-center justify-center gap-2 shadow-sm uppercase cursor-pointer"
                    >
                      <Wifi className="w-4 h-4 text-emerald-600" />
                      <span>CONNECT SIMULATED BLE</span>
                    </button>

                    <button
                      onClick={() => {
                        bluetoothService.disconnect();
                        setBleState(bluetoothService.getState());
                      }}
                      disabled={!bleState.connected}
                      className="py-2.5 px-4 bg-slate-100 text-slate-700 border border-slate-300 font-extrabold text-xs rounded-xl hover:bg-slate-200 disabled:opacity-50 transition flex items-center justify-center gap-2 uppercase cursor-pointer"
                    >
                      <span>DISCONNECT BLE</span>
                    </button>
                  </div>

                  <button
                    onClick={() => setIsDiagnosticsOpen(true)}
                    className="w-full py-2.5 px-4 bg-slate-900 text-emerald-400 border border-emerald-500/40 font-mono font-extrabold text-xs rounded-xl hover:bg-slate-800 transition flex items-center justify-center gap-2 shadow-sm uppercase cursor-pointer"
                  >
                    <Radio className="w-4 h-4 animate-pulse" />
                    <span>OPEN RESEARCH BLE GATT DIAGNOSTICS</span>
                  </button>
                </div>
              </div>
            ) : activeDrawerItem === 'company' ? (
              <CompanyAdminDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'trends' ? (
              <BatteryTrendsDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'doctor' ? (
              <DoctorDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'assistant' ? (
              <AssistantDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'charging' ? (
              <ChargingDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'alerts' ? (
              <AlertsDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'research' ? (
              <ResearchDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'reports' ? (
              <ReportsDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : activeDrawerItem === 'settings' ? (
              <SettingsDrawer batteryState={batteryState} onBack={() => setActiveDrawerItem(null)} />
            ) : (
              <div className="h-64 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-200">
                <span className="text-xs font-mono font-bold text-slate-500 tracking-widest uppercase">
                  [ {activeDrawerItem.toUpperCase()} ENGINE ONLINE ]
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* TAB 1: HOME DASHBOARD */}
            {activeTab === 'home' && (
              <div className="space-y-3.5">
                
                {/* 3D DIGITAL TWIN HERO CARD */}
                <div className="bg-white rounded-3xl p-3.5 border border-slate-200/80 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold ${batteryState.connectionState !== 'CONNECTED' ? 'bg-slate-100 border border-slate-200 text-slate-500' : batteryState.safetyState === 'CRITICAL' ? 'bg-red-50 border border-red-200 text-red-700' : batteryState.safetyState !== 'HEALTHY' ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${batteryState.connectionState !== 'CONNECTED' ? 'bg-slate-400' : batteryState.safetyState === 'CRITICAL' ? 'bg-red-500 animate-pulse' : batteryState.safetyState !== 'HEALTHY' ? 'bg-amber-500 animate-pulse' : 'bg-[#059669] animate-pulse'}`} /> {batteryState.connectionState === 'CONNECTED' ? batteryState.safetyState === 'HEALTHY' ? 'Live' : batteryState.safetyState : 'Standby'}
                      </span>
                      <div>
                        <h3 className="text-xs font-black text-slate-900 tracking-tight">3D Digital Twin</h3>
                        <p className="text-[9px] font-semibold text-slate-400">Real-time battery visualization</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveDrawerItem('twin')}
                      className="inline-flex items-center gap-1 bg-white border border-[#059669] px-2.5 py-1 rounded-full text-[10px] font-extrabold text-[#059669] hover:bg-emerald-50 transition cursor-pointer"
                    >
                      <span>View 3D</span>
                      <Maximize2 className="w-3 h-3 text-[#059669]" />
                    </button>
                  </div>

                  {/* Interactive 3D WebGL Battery View Canvas */}
                  <div className="relative flex flex-col items-center justify-center">
                    <div className="w-full h-48 sm:h-64 lg:h-80 relative rounded-2xl overflow-hidden border border-slate-100 bg-[#F8FAFC]">
                      <ErrorBoundary>
                        <Battery3DView status={batteryState.safetyState} isConnected={batteryState.connectionState === 'CONNECTED'} interactive={true} hideControls={true} />
                      </ErrorBoundary>
                    </div>

                    <div className="text-[10px] font-extrabold text-slate-700 tracking-wide mt-1.5 bg-slate-100/90 px-3 py-0.5 rounded-full border border-slate-200 shadow-2xs">
                      Drag to <span className="text-[#059669]">rotate</span> • Pinch to <span className="text-[#059669]">zoom</span>
                    </div>
                  </div>

                  {/* 4 KEY METRICS RESPONSIVE GRID */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <div className="bg-[#F8FAFC] p-2 rounded-2xl border border-slate-200/60 text-center">
                      <div className="flex items-center justify-center gap-1 text-[9px] font-extrabold text-slate-400 uppercase">
                        <BatteryCharging className="w-3 h-3 text-[#059669]" /> SOC
                      </div>
                      <div className="text-sm font-black text-[#059669] mt-0.5">{Math.round(batteryState.soc)}%</div>
                    </div>

                    <div className="bg-[#F8FAFC] p-2 rounded-2xl border border-slate-200/60 text-center">
                      <div className="flex items-center justify-center gap-1 text-[9px] font-extrabold text-slate-400 uppercase">
                        <Heart className="w-3 h-3 text-[#2563EB]" /> SOH
                      </div>
                      <div className="text-sm font-black text-[#2563EB] mt-0.5">{batteryState.soh}%</div>
                    </div>

                    <div className="bg-[#F8FAFC] p-2 rounded-2xl border border-slate-200/60 text-center">
                      <div className="flex items-center justify-center gap-1 text-[9px] font-extrabold text-slate-400 uppercase">
                        <Thermometer className="w-3 h-3 text-[#EA580C]" /> Temp
                      </div>
                      <div className="text-sm font-black text-[#EA580C] mt-0.5">{batteryState.maxTemperature || batteryState.temperature}°C</div>
                    </div>

                    <div className="bg-[#F8FAFC] p-2 rounded-2xl border border-slate-200/60 text-center">
                      <div className="flex items-center justify-center gap-1 text-[9px] font-extrabold text-slate-400 uppercase">
                        <NavigationIcon className="w-3 h-3 text-[#059669]" /> Range
                      </div>
                      <div className="text-sm font-black text-[#059669] mt-0.5">{batteryState.estimatedRange} km</div>
                    </div>
                  </div>
                </div>

                {/* BATTERY HEALTH PROGRESS BAR CARD */}
                <div
                  onClick={() => setActiveTab('battery')}
                  className="bg-white rounded-3xl p-3.5 border border-slate-200/80 shadow-2xs space-y-2 cursor-pointer hover:border-emerald-300 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-xl bg-[#ECFDF5] text-[#059669]">
                        <Activity className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-slate-900 flex items-center gap-1">
                          Battery Health
                          <ChevronRight className="w-3 h-3 text-slate-400" />
                        </h4>
                        <p className="text-[9px] font-semibold text-slate-400">
                          {batteryState.connectionState === 'CONNECTED'
                            ? (batteryState.safetyState === 'HEALTHY' ? 'Live readings are within normal limits' : batteryState.safetyState === 'CRITICAL' ? 'Critical battery fault reported' : batteryState.safetyState === 'WARNING' ? 'Battery warning: check live readings' : 'Monitor battery condition')
                            : 'Connect Bluetooth BMS to inspect live SOH & PINN metrics'}
                        </p>
                      </div>
                    </div>

                    <span className={`inline-flex items-center gap-1 border px-2.5 py-0.5 rounded-full text-[9px] font-extrabold ${
                      batteryState.connectionState === 'CONNECTED'
                        ? (batteryState.safetyState === 'HEALTHY'
                          ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                          : batteryState.safetyState === 'CRITICAL'
                          ? 'bg-red-50 border-red-200 text-red-700'
                          : 'bg-amber-50 border-amber-200 text-amber-700')
                        : 'bg-slate-100 border-slate-300 text-slate-500'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        batteryState.connectionState === 'CONNECTED'
                          ? (batteryState.safetyState === 'HEALTHY' ? 'bg-[#059669]' : batteryState.safetyState === 'CRITICAL' ? 'bg-red-500 animate-ping' : 'bg-amber-500 animate-pulse')
                          : 'bg-slate-400'
                      }`} />
                      {batteryState.connectionState === 'CONNECTED' ? batteryState.safetyState : 'STANDBY'}
                    </span>
                  </div>

                  <div className="space-y-1 pt-1">
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          batteryState.connectionState === 'CONNECTED' ? 'bg-[#059669]' : 'bg-slate-300'
                        }`}
                        style={{ width: `${batteryState.connectionState === 'CONNECTED' ? batteryState.soh : 0}%` }}
                      />
                    </div>
                    <div className="text-right text-xs font-black text-slate-900">
                      {batteryState.connectionState === 'CONNECTED' ? `${batteryState.soh}%` : '0% (BLE Disconnected)'}
                    </div>
                  </div>
                </div>

                {/* LIVE PARAMETERS 4 GRID */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5">
                      <BarChart2 className="w-4 h-4 text-[#059669]" />
                      <h4 className="text-xs font-black text-slate-900">Live Parameters</h4>
                    </div>
                    <button
                      onClick={() => setActiveTab('battery')}
                      className="text-[10px] font-extrabold text-[#059669] hover:underline cursor-pointer flex items-center gap-0.5"
                    >
                      <span>View All</span>
                      <ChevronRight className="w-3 h-3 text-[#059669]" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div
                      onClick={() => setActiveTab('battery')}
                      className="bg-white p-2.5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1 cursor-pointer hover:border-emerald-300 transition"
                    >
                      <Zap className="w-4 h-4 text-[#059669]" />
                      <div className="text-[8px] font-extrabold text-slate-400 uppercase">Voltage</div>
                      <div className="text-xs font-black text-[#059669]">{batteryState.voltage} V</div>
                    </div>

                    <div
                      onClick={() => setActiveTab('battery')}
                      className="bg-white p-2.5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1 cursor-pointer hover:border-emerald-300 transition"
                    >
                      <Activity className="w-4 h-4 text-[#2563EB]" />
                      <div className="text-[8px] font-extrabold text-slate-400 uppercase">Current</div>
                      <div className="text-xs font-black text-[#2563EB]">{batteryState.current} A</div>
                    </div>

                    <div
                      onClick={() => setActiveTab('battery')}
                      className="bg-white p-2.5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1 cursor-pointer hover:border-emerald-300 transition"
                    >
                      <Cpu className="w-4 h-4 text-[#9333EA]" />
                      <div className="text-[8px] font-extrabold text-slate-400 uppercase">Power</div>
                      <div className="text-xs font-black text-[#9333EA]">{batteryState.power} kW</div>
                    </div>

                    <div
                      onClick={() => setActiveTab('battery')}
                      className="bg-white p-2.5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1 cursor-pointer hover:border-emerald-300 transition"
                    >
                      <Thermometer className="w-4 h-4 text-[#EA580C]" />
                      <div className="text-[8px] font-extrabold text-slate-400 uppercase">Temperature</div>
                      <div className="text-xs font-black text-[#EA580C]">{batteryState.maxTemperature || batteryState.temperature} °C</div>
                    </div>
                  </div>
                </div>

                {/* AI GUARDIAN & RISK STATUS 2 CARDS */}
                {(() => {
                  const connected = batteryState.connectionState === 'CONNECTED';
                  const risk = connected ? PinnEngine.evaluatePhysicsModel(batteryState) : null;
                  const level = risk?.overallRiskLevel || 'STANDBY';
                  const levelStyle = level === 'CRITICAL'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : level === 'ELEVATED'
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                    : level === 'WATCH'
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700';
                  const summary = !connected ? 'Waiting for live battery data' : level === 'CRITICAL' ? 'Critical condition reported' : level === 'ELEVATED' ? 'Battery needs attention' : level === 'WATCH' ? 'Monitor battery closely' : 'No abnormal signals detected';
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        onClick={() => setActiveTab('guardian')}
                        className={`min-w-0 text-left p-3 rounded-2xl border shadow-2xs flex items-center justify-between gap-2 cursor-pointer transition hover:shadow-sm ${levelStyle}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="p-1.5 rounded-xl bg-white/80 shrink-0"><ShieldCheck className="w-4 h-4" /></div>
                          <div className="min-w-0">
                            <div className="text-xs font-black text-slate-900">AI Guardian</div>
                            <div className="text-[9px] font-semibold leading-tight truncate">{summary}</div>
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      </button>
                      <button
                        onClick={() => setActiveTab('guardian')}
                        className={`min-w-0 text-left p-3 rounded-2xl border shadow-2xs flex items-center justify-between gap-2 cursor-pointer transition hover:shadow-sm ${levelStyle}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="p-1.5 rounded-xl bg-white/80 shrink-0"><Clock className="w-4 h-4" /></div>
                          <div className="min-w-0">
                            <div className="text-xs font-black text-slate-900">Risk Status</div>
                            <div className="text-[10px] font-extrabold">{connected ? `${level} · ${risk?.thermalRunawayRiskPct}%` : 'STANDBY'}</div>
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    </div>
                  );
                })()}

                {/* RECENT ALERTS CARD (DYNAMIC) */}
                <div className="bg-white rounded-3xl p-3.5 border border-slate-200/80 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-xl bg-red-50 text-red-500">
                        <Bell className="w-4 h-4" />
                      </div>
                      <h4 className="text-xs font-black text-slate-900">Recent Alerts</h4>
                    </div>
                    <button
                      onClick={() => setActiveDrawerItem('alerts')}
                      className="text-[10px] font-extrabold text-[#059669] hover:underline cursor-pointer"
                    >
                      View All
                    </button>
                  </div>

                  {(() => {
                    const pinn = PinnEngine.evaluatePhysicsModel(batteryState);
                    const maxTemp = batteryState.maxTemperature || batteryState.temperature;
                    const activeAlerts: { title: string; desc: string; type: 'warning' | 'error' | 'info' }[] = [];

                    if (batteryState.connectionState === 'DISCONNECTED') {
                      activeAlerts.push({
                        title: 'BLE Disconnected (0V Zero State)',
                        desc: 'Connect battery via BLE GATT service to stream live parameters.',
                        type: 'info',
                      });
                    }
                    if (batteryState.connectionState === 'CONNECTED' && batteryState.safetyState !== 'HEALTHY') {
                      activeAlerts.push({
                        title: `BMS ${batteryState.safetyState} condition`,
                        desc: `Live BMS risk score: ${Math.round(batteryState.risk)}%. Inspect the fault details and affected cells.`,
                        type: batteryState.safetyState === 'CRITICAL' ? 'error' : 'warning',
                      });
                    } else if (batteryState.connectionState === 'CONNECTED' && pinn.thermalRunawayRiskPct >= 18) {
                      activeAlerts.push({
                        title: `${pinn.overallRiskLevel} battery risk`,
                        desc: `Live risk estimate is ${pinn.thermalRunawayRiskPct}%. ${pinn.recommendations[0]}`,
                        type: pinn.overallRiskLevel === 'CRITICAL' ? 'error' : 'warning',
                      });
                    }
                    const abnormalCells = batteryState.cells.filter((cell) => cell.status === 'WATCH' || cell.status === 'WARNING' || cell.status === 'CRITICAL');
                    if (abnormalCells.length > 0) {
                      activeAlerts.push({
                        title: `Abnormal cell${abnormalCells.length > 1 ? 's' : ''} detected`,
                        desc: `Cell${abnormalCells.length > 1 ? 's' : ''} ${abnormalCells.map((cell) => cell.id).join(', ')} flagged by the BMS.`,
                        type: abnormalCells.some((cell) => cell.status === 'CRITICAL') ? 'error' : 'warning',
                      });
                    }
                    if (pinn.cellImbalanceIndex > 0.025) {
                      activeAlerts.push({
                        title: 'Cell Imbalance Warning',
                        desc: `Cell variance is ${(pinn.cellImbalanceIndex * 1000).toFixed(0)}mV. Passive balancing recommended.`,
                        type: 'warning',
                      });
                    }
                    if (maxTemp > 40) {
                      activeAlerts.push({
                        title: 'Elevated Temperature Warning',
                        desc: `Max pack temp reached ${maxTemp}°C (Normal: 25-38°C). Avoid fast charging.`,
                        type: maxTemp > 50 ? 'error' : 'warning',
                      });
                    }
                    if (batteryState.soc > 0 && batteryState.soc < 20) {
                      activeAlerts.push({
                        title: 'Low State of Charge (SOC < 20%)',
                        desc: `Battery level is at ${Math.round(batteryState.soc)}%. Connect charger soon.`,
                        type: 'warning',
                      });
                    }

                    if (activeAlerts.length > 0) {
                      return (
                        <div className="space-y-1.5">
                          {activeAlerts.slice(0, 3).map((alert, idx) => (
                            <div
                              key={idx}
                              onClick={() => setActiveDrawerItem('alerts')}
                              className={`flex items-start gap-2.5 p-2 rounded-2xl border cursor-pointer transition ${
                                alert.type === 'error'
                                  ? 'bg-red-50/90 border-red-200 text-red-900 hover:bg-red-100'
                                  : alert.type === 'warning'
                                  ? 'bg-amber-50/90 border-amber-200 text-amber-900 hover:bg-amber-100'
                                  : 'bg-blue-50/90 border-blue-200 text-blue-900 hover:bg-blue-100'
                              }`}
                            >
                              <AlertCircle className={`w-4 h-4 mt-0.5 shrink-0 ${
                                alert.type === 'error' ? 'text-red-600' : alert.type === 'warning' ? 'text-amber-600' : 'text-blue-600'
                              }`} />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-extrabold truncate">{alert.title}</div>
                                <div className="text-[9px] font-semibold opacity-80 leading-tight mt-0.5">{alert.desc}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    return (
                      <div className="flex items-center gap-2.5 p-2 bg-[#F8FAFC] rounded-2xl border border-slate-100">
                        <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" />
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">No active alerts</div>
                          <div className="text-[9px] font-semibold text-slate-400">Live telemetry reports no current warning signals.</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

              </div>
            )}

            {/* TAB 2: BATTERY INTELLIGENCE & CELL MONITORING */}
            {activeTab === 'battery' && (
              <div className="space-y-6">
                {batteryState.connectionState !== 'CONNECTED' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between text-xs font-bold text-amber-900 shadow-sm animate-fadeIn">
                    <div className="flex items-center gap-2">
                      <Bluetooth className="w-4 h-4 text-amber-600 animate-pulse shrink-0" />
                      <span>Bluetooth BMS Disconnected — Connect hardware to stream live telemetry</span>
                    </div>
                    <button
                      onClick={() => setIsPairingModalOpen(true)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[10px] rounded-xl shadow-sm cursor-pointer shrink-0"
                    >
                      Connect BLE
                    </button>
                  </div>
                )}

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-md space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div>
                      <h2 className="text-base sm:text-lg font-black text-slate-900 heading-tech uppercase">BATTERY PACK OVERVIEW</h2>
                      <p className="text-[11px] text-slate-500 font-semibold">{getPackArchitecture()}</p>
                    </div>
                    <span className={`text-[10px] font-mono font-bold px-3 py-1 rounded-full border shrink-0 ${
                      batteryState.connectionState === 'CONNECTED'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-slate-100 text-slate-600 border-slate-300'
                    }`}>
                      {batteryState.connectionState === 'CONNECTED' ? 'LIVE STREAM ACTIVE' : 'DISCONNECTED / STANDBY'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div className="text-[10px] font-bold text-slate-500">SOC / SOH</div>
                      <div className="text-base sm:text-lg font-extrabold text-emerald-600 mt-0.5">
                        {batteryState.connectionState === 'CONNECTED' ? `${Math.round(batteryState.soc)}% / ${batteryState.soh}%` : '0% / 0%'}
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div className="text-[10px] font-bold text-slate-500">VOLTAGE / CURRENT</div>
                      <div className="text-base sm:text-lg font-extrabold text-emerald-600 mt-0.5">
                        {batteryState.connectionState === 'CONNECTED' ? `${(batteryState.voltage || 0).toFixed(1)} V / ${(batteryState.current || 0).toFixed(1)} A` : '0.0 V / 0.0 A'}
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div className="text-[10px] font-bold text-slate-500">POWER / TEMP</div>
                      <div className="text-base sm:text-lg font-extrabold text-emerald-600 mt-0.5">
                        {batteryState.connectionState === 'CONNECTED' ? `${(batteryState.power || 0).toFixed(1)} kW / ${batteryState.maxTemperature || batteryState.temperature || 0} °C` : '0.0 kW / -- °C'}
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div className="text-[10px] font-bold text-slate-500">INTERNAL RESISTANCE</div>
                      <div className="text-base sm:text-lg font-extrabold text-emerald-600 mt-0.5">
                        {batteryState.connectionState === 'CONNECTED' ? `${batteryState.internalResistance} mΩ / cell` : 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Digital Twin Cell Matrix Grid */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-md space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h3 className="text-xs sm:text-sm font-black text-slate-900 uppercase heading-tech tracking-wide">
                      EV SCOOTER CELL MATRIX ({batteryState.connectionState === 'CONNECTED' ? batteryState.cells.length || 8 : 8} CELLS)
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] sm:text-[11px] font-bold">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Healthy</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Warning</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Critical</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                    {batteryState.connectionState === 'CONNECTED' && batteryState.cells && batteryState.cells.length > 0 ? (
                      batteryState.cells.map((c: any) => {
                        const cVoltage = c.voltage || 0;
                        const cTemp = c.temperature || 0;
                        const reportedRisk = c.risk || 0;
                        const cellStatus = c.status && c.status !== 'HEALTHY'
                          ? c.status
                          : reportedRisk >= 75 || cTemp >= 55
                          ? 'CRITICAL'
                          : reportedRisk >= 35 || cTemp >= 45
                          ? 'WARNING'
                          : 'HEALTHY';
                        const isAbnormal = cellStatus !== 'HEALTHY';
                        const statusColor = cellStatus === 'CRITICAL'
                          ? 'bg-red-100 border-red-500 text-red-700 animate-pulse shadow-red'
                          : isAbnormal
                          ? 'bg-amber-50 border-amber-400 text-amber-800'
                          : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100';

                        return (
                          <button
                            key={c.id}
                            onClick={() =>
                              setSelectedCell({
                                id: c.id,
                                voltage: cVoltage,
                                temp: cTemp,
                                deviation: (c.deviation || 0) * 1000,
                                status: cellStatus,
                                riskScore: Math.round(reportedRisk || (cellStatus === 'CRITICAL' ? 85 : cellStatus === 'WARNING' ? 55 : 5)),
                              })
                            }
                            className={`h-12 rounded-xl border flex flex-col items-center justify-center font-mono text-xs font-bold transition-all cursor-pointer ${statusColor}`}
                          >
                            <span>C0{c.id} ({cVoltage}V)</span>
                            <span className="text-[9px] font-normal opacity-80">{cTemp}°C</span>
                          </button>
                        );
                      })
                    ) : (
                      Array.from({ length: 8 }, (_, idx) => (
                        <div
                          key={idx + 1}
                          className="h-12 rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center font-mono text-xs text-slate-400 font-semibold"
                        >
                          <span>C0{idx + 1} (--V)</span>
                          <span className="text-[8px] opacity-70">STANDBY</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Selected Cell Modal */}
                {selectedCell && (
                  <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-3 animate-fadeIn">
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                        <div className="flex items-center gap-2">
                          <Zap className="w-5 h-5 text-emerald-600" />
                          <h3 className="text-lg font-black text-slate-900 heading-tech">CELL C{selectedCell.id < 10 ? `0${selectedCell.id}` : selectedCell.id} DIAGNOSTICS</h3>
                        </div>
                        <button onClick={() => setSelectedCell(null)} className="p-1 text-slate-400 hover:text-slate-800">
                          <X className="w-5 h-5 text-red-500" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500">VOLTAGE</div>
                          <div className="text-xl font-extrabold text-emerald-600">{selectedCell.voltage} V</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500">TEMPERATURE</div>
                          <div className={`text-xl font-extrabold ${selectedCell.status === 'CRITICAL' ? 'text-red-600' : selectedCell.status === 'HEALTHY' ? 'text-emerald-600' : 'text-amber-600'}`}>{selectedCell.temp} °C</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500">DEVIATION</div>
                          <div className="text-xl font-extrabold text-emerald-600">{selectedCell.deviation} mV</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500">RISK SCORE</div>
                          <div className={`text-xl font-extrabold ${selectedCell.riskScore >= 75 ? 'text-red-600' : selectedCell.riskScore >= 35 ? 'text-amber-600' : 'text-emerald-600'}`}>{selectedCell.riskScore}%</div>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500 uppercase">AI CELL DIAGNOSIS</div>
                        <div className="text-xs font-semibold text-slate-800 mt-1">
                          {selectedCell.status === 'CRITICAL'
                            ? 'The BMS marks this cell critical. Reduce load and inspect it before further operation.'
                            : selectedCell.status === 'WARNING' || selectedCell.status === 'WATCH'
                            ? `The BMS marks this cell ${selectedCell.status.toLowerCase()}. Monitor its voltage and temperature.`
                            : 'The BMS currently reports this cell as healthy.'}
                        </div>
                      </div>

                      <button
                        onClick={() => setSelectedCell(null)}
                        className="w-full py-2.5 bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-emerald uppercase"
                      >
                        CLOSE DIAGNOSTICS
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: AI GUARDIAN & EXPLAINABLE AI */}
            {activeTab === 'guardian' && (
              <div className="space-y-6">
                <div className="bg-white p-4 sm:p-6 rounded-2xl border-2 border-emerald-500/80 space-y-5 shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2.5">
                      <ShieldAlert className="w-6 h-6 text-emerald-600" />
                      <div>
                        <h2 className="text-base sm:text-xl font-black text-slate-900 heading-tech tracking-tight uppercase">
                          AI GUARDIAN SAFETY CENTER
                        </h2>
                        <p className="text-xs text-slate-500">Physics-Informed Neural Network (PINN) Safety Engine</p>
                      </div>
                    </div>
                    <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${
                      batteryState.connectionState !== 'CONNECTED'
                        ? 'bg-slate-100 text-slate-600 border-slate-300'
                        : PinnEngine.evaluatePhysicsModel(batteryState).overallRiskLevel === 'CRITICAL'
                        ? 'bg-red-50 text-red-700 border-red-300'
                        : PinnEngine.evaluatePhysicsModel(batteryState).overallRiskLevel === 'ELEVATED'
                        ? 'bg-orange-50 text-orange-700 border-orange-300'
                        : PinnEngine.evaluatePhysicsModel(batteryState).overallRiskLevel === 'WATCH'
                        ? 'bg-amber-50 text-amber-700 border-amber-300'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    }`}>
                      {batteryState.connectionState === 'CONNECTED' ? `STATUS: ${PinnEngine.evaluatePhysicsModel(batteryState).overallRiskLevel}` : 'STANDBY (NO LIVE DATA)'}
                    </span>
                  </div>

                  {(() => {
                    const isConn = batteryState.connectionState === 'CONNECTED';
                    const pinn = isConn ? PinnEngine.evaluatePhysicsModel(batteryState) : null;
                    const severityClass = pinn?.overallRiskLevel === 'CRITICAL'
                      ? 'text-red-700'
                      : pinn?.overallRiskLevel === 'ELEVATED'
                      ? 'text-orange-700'
                      : pinn?.overallRiskLevel === 'WATCH'
                      ? 'text-amber-700'
                      : 'text-emerald-700';

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center flex flex-col justify-between">
                          <div className="text-[9px] font-extrabold text-slate-500 uppercase">RISK SCORE</div>
                          <div className={`text-2xl font-black my-0.5 ${severityClass}`}>
                            {isConn ? `${pinn?.thermalRunawayRiskPct}%` : '--'}
                          </div>
                          <div className="text-[8px] font-mono text-slate-500">{isConn ? pinn?.overallRiskLevel || 'UNKNOWN' : 'STANDBY'}</div>
                        </div>

                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center flex flex-col justify-between">
                          <div className="text-[9px] font-extrabold text-slate-500 uppercase">LIVE BMS STATUS</div>
                          <div className={`text-base sm:text-2xl font-black my-0.5 ${severityClass}`}>
                            {isConn ? batteryState.safetyState : 'N/A'}
                          </div>
                          <div className="text-[8px] font-mono text-slate-500">FROM BATTERY PACKET</div>
                        </div>

                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center flex flex-col justify-between">
                          <div className="text-[9px] font-extrabold text-slate-500 uppercase">RECOMMENDED ACTION</div>
                          <div className={`text-xs font-extrabold my-0.5 ${severityClass}`}>
                            {!isConn ? 'STANDBY' : pinn?.overallRiskLevel === 'CRITICAL' ? 'STOP & INSPECT' : pinn?.overallRiskLevel === 'ELEVATED' ? 'REDUCE LOAD' : pinn?.overallRiskLevel === 'WATCH' ? 'MONITOR' : 'NORMAL USE'}
                          </div>
                          <div className="text-[8px] font-mono text-slate-500">BASED ON LIVE SIGNALS</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* EXPLAINABLE AI CONTRIBUTION BARS */}
                <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 space-y-4 shadow-md">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2">
                      <Info className="w-5 h-5 text-emerald-600" />
                      <h3 className="text-sm sm:text-lg font-black text-slate-900 heading-tech tracking-tight uppercase">
                        WHY DID RISK CHANGE? (EXPLAINABLE AI)
                      </h3>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">LIVE RISK SIGNALS · 0–100</span>
                  </div>

                  {batteryState.connectionState === 'CONNECTED' ? (
                    <div className="space-y-3 pt-1">
                      {PinnEngine.evaluatePhysicsModel(batteryState).riskFactors.map((item, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-700">
                            <span>{item.factor}</span>
                            <span className={`font-mono ${item.score >= 75 ? 'text-red-600' : item.score >= 35 ? 'text-amber-600' : 'text-emerald-600'}`}>{item.score}/100</span>
                          </div>
                          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                            <div className={`h-full ${item.score >= 75 ? 'bg-red-500' : item.score >= 35 ? 'bg-amber-500' : 'bg-emerald-500'} rounded-full transition-all duration-500`} style={{ width: `${item.score}%` }} />
                          </div>
                        </div>
                      ))}
                      <p className="text-[10px] text-slate-500">Scores show current signal levels; they are not percentages of causal contribution.</p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center space-y-2">
                      <div className="text-xs font-bold text-slate-600">Bluetooth BMS Disconnected</div>
                      <p className="text-[10px] text-slate-400">Connect Bluetooth BMS hardware to stream live battery parameters and calculate real-time PINN risk feature attributions.</p>
                      <button
                        onClick={() => setIsPairingModalOpen(true)}
                        className="px-3 py-1.5 bg-emerald-600 text-white font-extrabold text-[10px] rounded-xl shadow-sm cursor-pointer"
                      >
                        Connect BLE Hardware
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: WHAT-IF SIMULATOR */}
            {activeTab === 'simulator' && (
              <div className="space-y-6">
                {batteryState.connectionState !== 'CONNECTED' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3 shadow-sm animate-fadeIn">
                    <div className="flex items-center gap-2.5 text-amber-900 font-extrabold text-sm">
                      <Bluetooth className="w-5 h-5 text-amber-600 animate-pulse shrink-0" />
                      <span>BLUETOOTH BMS HARDWARE REQUIRED</span>
                    </div>
                    <p className="text-xs text-amber-800 font-medium">
                      What-If simulations require live battery telemetry baseline from your connected EV Scooter BMS hardware.
                    </p>
                    <button
                      onClick={() => setIsPairingModalOpen(true)}
                      className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Bluetooth className="w-4 h-4" />
                      <span>CONNECT BLUETOOTH BMS HARDWARE</span>
                    </button>
                  </div>
                )}

                {batteryState.connectionState === 'CONNECTED' && (
                  <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-3 flex items-center justify-between text-xs font-bold text-emerald-900 shadow-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>LIVE TELEMETRY BASELINE ACTIVE ({batteryState.maxTemperature || batteryState.temperature}°C • {Math.round(batteryState.soc)}% SOC)</span>
                    </div>
                    <span className="text-[10px] font-mono uppercase bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full font-extrabold">
                      CONNECTED
                    </span>
                  </div>
                )}

                <div className="bg-white p-6 rounded-2xl border-2 border-emerald-500/80 space-y-5 shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2.5">
                      <Cpu className="w-6 h-6 text-emerald-600" />
                      <div>
                        <h2 className="text-xl font-black text-slate-900 heading-tech uppercase">WHAT-IF BATTERY SIMULATOR</h2>
                        <p className="text-xs text-slate-500">Predictive Physics Model for EV Scooter Loads &amp; Thermal Stress</p>
                      </div>
                    </div>
                    <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${
                      batteryState.connectionState === 'CONNECTED'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-slate-100 text-slate-500 border-slate-300'
                    }`}>
                      {batteryState.connectionState === 'CONNECTED' ? 'PREDICTIVE TOOL' : 'LOCKED (BLE DISCONNECTED)'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 uppercase">EV SCOOTER SPEED: {simSpeed} KM/H</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={simSpeed}
                        disabled={batteryState.connectionState !== 'CONNECTED'}
                        onChange={(e) => setSimSpeed(Number(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 uppercase">AMBIENT TEMP: {simTemp} °C</label>
                      <input
                        type="range"
                        min="-10"
                        max="55"
                        value={simTemp}
                        disabled={batteryState.connectionState !== 'CONNECTED'}
                        onChange={(e) => setSimTemp(Number(e.target.value))}
                        className="w-full accent-red-500 cursor-pointer mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 uppercase">AUXILIARY LOAD (LIGHTS/ECU): {simAux} KW</label>
                      <input
                        type="range"
                        min="0"
                        max="1.0"
                        step="0.1"
                        value={simAux}
                        disabled={batteryState.connectionState !== 'CONNECTED'}
                        onChange={(e) => setSimAux(Number(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 uppercase">CHARGING MODE</label>
                      <select
                        value={simMode}
                        disabled={batteryState.connectionState !== 'CONNECTED'}
                        onChange={(e) => setSimMode(e.target.value)}
                        className="input-high-contrast mt-1 text-slate-900 bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <option value="FAST_CHARGE">EV Scooter Public Fast Charger (3.3 kW Ather / Ola Grid)</option>
                        <option value="FAST_HOME">Fast Home Charger (2.2 kW / 15A AC)</option>
                        <option value="NORMAL">Standard Portable Home Charger (1.2 kW / 5A AC)</option>
                        <option value="ECO_DRIVE">Regen Eco Driving Mode</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={runWhatIfSimulation}
                    disabled={isSimulating}
                    className="w-full py-3.5 bg-emerald-500 text-white font-extrabold text-sm rounded-xl hover:bg-emerald-600 transition uppercase tracking-wider shadow-emerald heading-tech disabled:opacity-50"
                  >
                    {batteryState.connectionState !== 'CONNECTED'
                      ? 'CONNECT BLE TO RUN SIMULATION'
                      : isSimulating
                      ? 'RUNNING PHYSICAL SIMULATION...'
                      : 'RUN SIMULATION'}
                  </button>
                </div>

                {batteryState.connectionState === 'CONNECTED' && simResults && (
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 animate-fadeIn shadow-md">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <h3 className="text-lg font-black text-slate-900 heading-tech uppercase">CURRENT VS SIMULATED COMPARISON</h3>
                      <span className="text-xs font-mono font-bold text-emerald-600">SIMULATED DATA</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500">PREDICTED TEMP</div>
                        <div className="text-2xl font-extrabold text-red-500 mt-1">{simResults.predictedTemp} °C</div>
                        <div className="text-[10px] text-slate-500 font-medium mt-0.5">Baseline: {simResults.baselineTemp}</div>
                      </div>

                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500">PREDICTED SOC</div>
                        <div className="text-2xl font-extrabold text-emerald-600 mt-1">{simResults.predictedSoc}%</div>
                        <div className="text-[10px] text-slate-500 font-medium mt-0.5">Baseline: {simResults.baselineSoc}</div>
                      </div>

                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500">SIMULATED RISK SCORE</div>
                        <div className="text-2xl font-extrabold text-red-500 mt-1">{simResults.riskScore}%</div>
                        <div className="text-[10px] text-slate-500 font-medium mt-0.5">Baseline: {simResults.baselineRisk}</div>
                      </div>

                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500">SAFE WINDOW</div>
                        <div className="text-lg font-extrabold text-emerald-600 mt-1">{simResults.safeWindow}</div>
                        <div className="text-[10px] text-slate-500 font-medium mt-0.5">{simResults.scooterModelName} PINN Model</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: ANALYTICS */}
            {activeTab === 'analytics' && (
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 shadow-md">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <h2 className="text-lg font-black text-slate-900 heading-tech uppercase">BATTERY TELEMETRY & RIDE ANALYTICS</h2>
                      <p className="text-xs text-slate-500">Historical Temperature, SOC, SOH & Imbalance Metrics</p>
                    </div>
                    <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300">
                      RESEARCH DATA
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                      <div className="text-xs font-bold text-slate-700 uppercase">TEMPERATURE VS TIME (°C)</div>
                      <div className="h-40 flex items-end gap-1.5 pt-4">
                        {[28, 30, 31, 33, 34, 34.2, 35, 36, 38, 40, 39, 37].map((v, idx) => (
                          <div key={idx} className="flex-1 bg-red-500 hover:bg-red-600 rounded-t transition-all" style={{ height: `${(v / 50) * 100}%` }} />
                        ))}
                      </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                      <div className="text-xs font-bold text-slate-700 uppercase">SOC VS TIME (%)</div>
                      <div className="h-40 flex items-end gap-1.5 pt-4">
                        {[100, 98, 94, 91, 88, 85, 84, 82, 79, 75, 72, 68].map((v, idx) => (
                          <div key={idx} className="flex-1 bg-emerald-500 hover:bg-emerald-600 rounded-t transition-all" style={{ height: `${v}%` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 6: OPERATOR PROFILE DASHBOARD */}
            {activeTab === 'profile' && (
              <ProfileScreen
                currentUser={currentUser}
                isDemoMode={isDemoMode}
                onLogout={handleLogout}
                onBackToDashboard={() => setActiveTab('home')}
                onProfileUpdated={(updated) => setCurrentUser(updated)}
              />
            )}
          </>
        )}
          </ErrorBoundary>
      </main>

      {/* 3. BOTTOM NAVIGATION */}
      <Navigation
        isVisible={isNavVisible}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveDrawerItem(null);
          setActiveTab(tab);
        }}
        onOpenDrawer={() => setIsDrawerOpen(true)}
      />

        {/* 4. DRAWER OVERLAY */}
        <MenuDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          onSelectDrawerItem={(item) => {
            setActiveDrawerItem(item);
          }}
          onLogout={handleLogout}
        />

        {/* 5. DEVELOPER BLE DIAGNOSTICS MODAL */}
        <BleDiagnosticsModal
          batteryState={batteryState}
          isOpen={isDiagnosticsOpen}
          onClose={() => setIsDiagnosticsOpen(false)}
        />

        {/* 6. BLUETOOTH BMS PAIRING MODAL */}
        <BluetoothPairingModal
          isOpen={isPairingModalOpen}
          onClose={() => setIsPairingModalOpen(false)}
        />
      </div>
    </div>
  );
}

export default App;
