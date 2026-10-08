import React, { useState, useEffect } from 'react';
import type { NormalizedBatteryState } from '../../types/telemetry';
import { batteryTrendService } from '../../services/batteryTrendService';
import type { StressCategory, TelemetryTrendPoint } from '../../services/batteryTrendService';
import { firebaseSyncService } from '../../services/firebaseSyncService';
import {
  ArrowLeft,
  Activity,
  Zap,
  Thermometer,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Clock,
  Trash2,
  Download,
  Filter,
  AlertTriangle,
  Info,
  Layers,
  BarChart2,
  Cloud,
  CloudUpload,
  CheckCircle2
} from 'lucide-react';

interface BatteryTrendsDrawerProps {
  batteryState: NormalizedBatteryState;
  onBack: () => void;
}

export const BatteryTrendsDrawer: React.FC<BatteryTrendsDrawerProps> = ({ batteryState, onBack }) => {
  const [timeWindow, setTimeWindow] = useState<'5M' | '15M' | '1H' | '24H' | 'ALL'>('ALL');
  const [activeMetric, setActiveMetric] = useState<'STRESS' | 'CURRENT' | 'TEMP' | 'VOLTAGE'>('STRESS');
  const [hoveredPoint, setHoveredPoint] = useState<TelemetryTrendPoint | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<{ mode: string; timestamp: string } | null>(null);
  const [, setRefreshTick] = useState(0);

  useEffect(() => {
    // Record current state snapshot
    batteryTrendService.recordSnapshot(batteryState);

    // Sync backend history buffer from FastAPI (/battery/history)
    batteryTrendService.syncBackendHistory();

    // Subscribe to periodic trend updates
    const unsubscribe = batteryTrendService.subscribe(() => {
      setRefreshTick((prev) => prev + 1);
    });

    return () => unsubscribe();
  }, [batteryState]);

  const historyPoints = batteryTrendService.getHistory(timeWindow);
  const summary = batteryTrendService.getAnalyticsSummary(timeWindow);
  const events = batteryTrendService.getStressEvents();

  const handleCloudSync = async () => {
    setIsSyncingCloud(true);
    const res = await firebaseSyncService.syncAnalyticsAndTrendsToCloud(
      batteryState.deviceId || 'BATTERY_PACK_01',
      summary,
      historyPoints,
      events
    );
    setCloudSyncStatus({ mode: res.mode, timestamp: res.timestamp });
    setIsSyncingCloud(false);
  };

  const handleExportCsv = () => {
    if (historyPoints.length === 0) return;
    const headers = 'Timestamp,Voltage_V,Current_A,Temperature_C,SOC_Percent,SOH_Percent,Power_kW,CellImbalance_mV,StressScore,Category\n';
    const rows = historyPoints
      .map(
        (p) =>
          `"${p.timestamp}",${p.voltage},${p.current},${p.temperature},${p.soc},${p.soh},${p.powerKw},${p.cellImbalanceMv},${p.stressScore},"${p.stressCategory}"`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `BRAIN_Battery_Trends_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear historical battery trend logs?')) {
      batteryTrendService.clearHistory();
    }
  };

  // Helper SVG Path builder for continuous multi-color line chart
  const renderSvgChart = () => {
    if (historyPoints.length < 2) {
      return (
        <div className="h-44 flex flex-col items-center justify-center text-slate-400 text-xs font-mono">
          <Activity className="w-8 h-8 text-slate-300 animate-pulse mb-2" />
          <span>Collecting real-time battery trend telemetry points...</span>
          <span className="text-[10px] text-slate-400 mt-1">Connect BLE or Digital Twin to record packet history</span>
        </div>
      );
    }

    const width = 500;
    const height = 150;
    const padding = 24;

    let getVal = (p: TelemetryTrendPoint) => p.stressScore;
    let maxVal = 100;
    let minVal = 0;
    let unit = 'Pts';
    let lineColor = '#10b981'; // Emerald
    let refThresholdVal: number | null = 60; // Stress Limit
    let refThresholdLabel = 'HIGH STRESS LIMIT (60 Pts)';

    if (activeMetric === 'CURRENT') {
      getVal = (p) => Math.abs(p.current);
      maxVal = Math.max(30, ...historyPoints.map((p) => Math.abs(p.current))) * 1.15;
      minVal = 0;
      unit = 'A';
      lineColor = '#3b82f6'; // Blue
      refThresholdVal = 25.0;
      refThresholdLabel = 'HIGH LOAD CURRENT (25.0 A)';
    } else if (activeMetric === 'TEMP') {
      getVal = (p) => p.temperature;
      maxVal = Math.max(45, ...historyPoints.map((p) => p.temperature)) * 1.08;
      minVal = Math.min(20, ...historyPoints.map((p) => p.temperature)) * 0.92;
      unit = '°C';
      lineColor = '#ef4444'; // Red
      refThresholdVal = 40.0;
      refThresholdLabel = 'THERMAL WARNING LIMIT (40.0 °C)';
    } else if (activeMetric === 'VOLTAGE') {
      getVal = (p) => p.voltage;
      maxVal = Math.max(30, ...historyPoints.map((p) => p.voltage)) * 1.05;
      minVal = Math.min(20, ...historyPoints.map((p) => p.voltage)) * 0.95;
      unit = 'V';
      lineColor = '#8b5cf6'; // Purple
      refThresholdVal = null;
    }

    const valRange = maxVal - minVal || 1;
    const stepX = (width - padding * 2) / (historyPoints.length - 1);

    const calculatedPoints = historyPoints.map((p, i) => {
      const x = padding + i * stepX;
      const val = getVal(p);
      const y = height - padding - ((val - minVal) / valRange) * (height - padding * 2);
      return { x, y, val, point: p };
    });

    const pointsStr = calculatedPoints.map((cp) => `${cp.x.toFixed(1)},${cp.y.toFixed(1)}`).join(' ');

    // Fill area gradient points
    const firstX = padding;
    const lastX = padding + (historyPoints.length - 1) * stepX;
    const fillStr = `${firstX},${height - padding} ${pointsStr} ${lastX},${height - padding}`;

    const latestPoint = historyPoints[historyPoints.length - 1];
    const currentVal = getVal(latestPoint);
    const activeHover = hoveredPoint || latestPoint;

    return (
      <div className="relative space-y-1.5">
        {/* Metric Header & Live Value Indicator */}
        <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 px-1">
          <span>RANGE: {minVal.toFixed(1)} {unit} – {maxVal.toFixed(1)} {unit}</span>
          <span className="font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
            {activeHover ? activeHover.timeLabel : ''} : <span style={{ color: lineColor }}>{(activeHover ? getVal(activeHover) : currentVal).toFixed(1)} {unit}</span>
          </span>
        </div>

        {/* Interactive Tooltip Card */}
        {activeHover && (
          <div className="bg-slate-900 border border-slate-700 text-white p-2 rounded-xl text-[10px] flex items-center justify-between shadow-md">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded font-black text-[9px] uppercase ${
                activeHover.stressCategory === 'MINIMALIST'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : activeHover.stressCategory === 'MODERATE'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : activeHover.stressCategory === 'HIGH_STRESS'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
              }`}>
                {activeHover.stressCategory}
              </span>
              <span>TIME: <b>{activeHover.timeLabel}</b></span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <span>V: <b>{activeHover.voltage}V</b></span>
              <span>I: <b>{activeHover.current}A</b></span>
              <span>T: <b>{activeHover.temperature}°C</b></span>
              <span>SOC: <b>{activeHover.soc}%</b></span>
              <span>STRESS: <b className="text-amber-400">{activeHover.stressScore}</b></span>
            </div>
          </div>
        )}

        {/* Chart Canvas */}
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-950 p-2 select-none">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-38 overflow-visible">
            <defs>
              <linearGradient id={`chartGrad_${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.45" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
            <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#475569" strokeWidth="1" />

            {/* Safety Threshold Reference Line */}
            {refThresholdVal !== null && refThresholdVal >= minVal && refThresholdVal <= maxVal && (
              <g>
                {(() => {
                  const refY = height - padding - ((refThresholdVal - minVal) / valRange) * (height - padding * 2);
                  return (
                    <>
                      <line x1={padding} y1={refY} x2={width - padding} y2={refY} stroke="#ef4444" strokeDasharray="4 2" strokeWidth="1.2" opacity="0.75" />
                      <text x={padding + 4} y={refY - 3} fill="#f87171" fontSize="8" fontWeight="bold">
                        {refThresholdLabel}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}

            {/* Filled area */}
            <polygon points={fillStr} fill={`url(#chartGrad_${activeMetric})`} />

            {/* Main Polyline Waveform */}
            <polyline
              fill="none"
              stroke={lineColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pointsStr}
            />

            {/* Color-Coded Data Point Circles */}
            {calculatedPoints.map((cp, idx) => {
              const cat = cp.point.stressCategory;
              const pointColor =
                cat === 'MINIMALIST'
                  ? '#10b981' // Green
                  : cat === 'MODERATE'
                  ? '#f59e0b' // Amber
                  : cat === 'HIGH_STRESS'
                  ? '#ef4444' // Red
                  : '#3b82f6'; // Blue Charging

              const isHovered = activeHover && activeHover.timestamp === cp.point.timestamp;

              return (
                <g key={idx} className="cursor-pointer" onClick={() => setHoveredPoint(cp.point)}>
                  <circle
                    cx={cp.x}
                    cy={cp.y}
                    r={isHovered ? 6 : cat === 'HIGH_STRESS' ? 3.5 : 2}
                    fill={pointColor}
                    stroke="#0f172a"
                    strokeWidth={isHovered ? 2 : 1}
                  />
                  {cat === 'HIGH_STRESS' && (
                    <circle cx={cp.x} cy={cp.y} r="6" fill="none" stroke="#ef4444" strokeWidth="1" className="animate-ping" opacity="0.6" />
                  )}
                </g>
              );
            })}
          </svg>

          {/* X Axis Timestamps */}
          <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 px-1 pt-1 border-t border-slate-800">
            <span>{historyPoints[0]?.timeLabel}</span>
            <span>{historyPoints[Math.floor(historyPoints.length / 2)]?.timeLabel}</span>
            <span>{latestPoint?.timeLabel}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-fadeIn text-slate-900 pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-black text-slate-900 heading-tech uppercase flex items-center gap-1.5 flex-wrap">
              <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>BATTERY STRESS &amp; HISTORICAL TRENDS</span>
            </h2>
            <p className="text-[10px] text-slate-500 font-semibold truncate">
              Analyze when battery load increased, thermal spikes occurred, or minimalist mode was active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300">
            {summary.totalPoints} SNAPSHOTS LOGGED
          </span>
        </div>
      </div>

      {/* OVERALL STRESS SUMMARY BANNER */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 font-mono">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {summary.overallHealthCategory === 'OPTIMAL' ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : summary.overallHealthCategory === 'MODERATE STRESS' ? (
              <Activity className="w-5 h-5 text-amber-500 shrink-0" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <div>
              <div className="text-xs font-black text-slate-900">
                OVERALL OPERATING PROFILE: <span className={
                  summary.overallHealthCategory === 'OPTIMAL'
                    ? 'text-emerald-600'
                    : summary.overallHealthCategory === 'MODERATE STRESS'
                    ? 'text-amber-600'
                    : 'text-red-600'
                }>{summary.overallHealthCategory}</span>
              </div>
              <div className="text-[10px] text-slate-500 font-semibold">
                Average Stress Index: {summary.avgStressScore}/100 | Peak Stress: {summary.maxStressScore}/100
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {(['5M', '15M', '1H', '24H', 'ALL'] as const).map((win) => (
              <button
                key={win}
                onClick={() => setTimeWindow(win)}
                className={`px-2 py-1 text-[9px] font-bold rounded-lg transition cursor-pointer ${
                  timeWindow === win
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {win}
              </button>
            ))}
          </div>
        </div>

        {/* STRESS DISTRIBUTION PROGRESS BAR */}
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between items-center text-[10px] font-bold">
            <span className="text-emerald-700">🌱 MINIMALIST (ECO): {summary.minimalistPercent}%</span>
            <span className="text-amber-700">⚡ MODERATE: {summary.moderatePercent}%</span>
            <span className="text-red-700">🔥 HIGH STRESS: {summary.highStressPercent}%</span>
            {summary.chargingPercent > 0 && <span className="text-blue-700">🔌 CHARGING: {summary.chargingPercent}%</span>}
          </div>

          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex border border-slate-200 shadow-inner">
            <div style={{ width: `${summary.minimalistPercent}%` }} className="bg-emerald-500 transition-all duration-500" title={`Minimalist: ${summary.minimalistPercent}%`} />
            <div style={{ width: `${summary.moderatePercent}%` }} className="bg-amber-400 transition-all duration-500" title={`Moderate: ${summary.moderatePercent}%`} />
            <div style={{ width: `${summary.highStressPercent}%` }} className="bg-red-500 transition-all duration-500" title={`High Stress: ${summary.highStressPercent}%`} />
            <div style={{ width: `${summary.chargingPercent}%` }} className="bg-blue-500 transition-all duration-500" title={`Charging: ${summary.chargingPercent}%`} />
          </div>
        </div>

        {/* METRICS METRIC KPI CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          <div className="p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-200/80">
            <div className="text-[9px] text-emerald-800 font-bold uppercase flex items-center gap-1">
              <Zap className="w-3 h-3 text-emerald-600" /> MINIMALIST TIME
            </div>
            <div className="text-base font-black text-emerald-900 mt-0.5">{summary.minimalistPercent}%</div>
            <div className="text-[9px] text-emerald-700 font-medium">&lt;8A Current Draw</div>
          </div>

          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <div className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1">
              <Activity className="w-3 h-3 text-blue-600" /> MAX CURRENT
            </div>
            <div className="text-base font-black text-slate-900 mt-0.5">{summary.maxCurrentA} A</div>
            <div className="text-[9px] text-slate-500 font-medium">Avg: {summary.avgCurrentA} A</div>
          </div>

          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <div className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1">
              <Thermometer className="w-3 h-3 text-red-500" /> MAX TEMP
            </div>
            <div className="text-base font-black text-slate-900 mt-0.5">{summary.maxTempC} °C</div>
            <div className="text-[9px] text-slate-500 font-medium">Avg: {summary.avgTempC} °C</div>
          </div>

          <div className="p-2.5 bg-red-50/60 rounded-xl border border-red-200/80">
            <div className="text-[9px] text-red-800 font-bold uppercase flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-red-600" /> HIGH STRESS TIME
            </div>
            <div className="text-base font-black text-red-900 mt-0.5">{summary.highStressPercent}%</div>
            <div className="text-[9px] text-red-700 font-medium">&gt;25A or &gt;40°C Spike</div>
          </div>
        </div>
      </div>

      {/* VISUAL TREND CHART CONTAINER */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 font-mono">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-xs font-black text-slate-900 uppercase">TELEMETRY TREND WAVEFORM</span>
          </div>

          <div className="flex items-center gap-1">
            {(['STRESS', 'CURRENT', 'TEMP', 'VOLTAGE'] as const).map((metric) => (
              <button
                key={metric}
                onClick={() => setActiveMetric(metric)}
                className={`px-2 py-0.5 text-[9px] font-bold rounded-md transition cursor-pointer ${
                  activeMetric === metric
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {metric}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Waveform Plot */}
        {renderSvgChart()}
      </div>

      {/* STRESS EVENTS TIMELINE FEED */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 font-mono">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-xs font-black text-slate-900 uppercase">LOGGED HIGH STRESS EVENTS</span>
          </div>
          <span className="text-[10px] text-slate-500 font-bold">{events.length} EVENTS</span>
        </div>

        {events.length === 0 ? (
          <div className="p-4 bg-emerald-50/50 border border-emerald-200/60 rounded-xl text-center text-xs text-emerald-800 space-y-1">
            <ShieldCheck className="w-6 h-6 text-emerald-600 mx-auto" />
            <div className="font-bold">NO HIGH STRESS SPIKES DETECTED</div>
            <div className="text-[10px] text-emerald-700">Battery operating within minimalist &amp; normal thermal/current safety thresholds.</div>
          </div>
        ) : (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {events.map((evt) => (
              <div key={evt.id} className="p-2.5 bg-red-50/80 border border-red-200 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-black text-red-900 text-[11px] flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    {evt.title}
                  </span>
                  <span className="text-[9px] text-red-700 font-bold bg-white px-1.5 py-0.5 rounded-md border border-red-200">
                    {evt.timestamp}
                  </span>
                </div>
                <div className="text-[10px] text-red-800 font-medium">{evt.description}</div>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        {cloudSyncStatus && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between font-mono">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>CLOUD SYNCED: <b className="text-emerald-700">{cloudSyncStatus.mode}</b></span>
            </div>
            <span className="text-[10px] text-emerald-700 font-bold">{cloudSyncStatus.timestamp}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200">
          <button
            onClick={handleCloudSync}
            disabled={isSyncingCloud}
            className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2 uppercase cursor-pointer disabled:opacity-50"
          >
            <CloudUpload className={`w-4 h-4 ${isSyncingCloud ? 'animate-bounce' : ''}`} />
            <span>{isSyncingCloud ? 'SYNCING CLOUD...' : 'SYNC TO CLOUD DB'}</span>
          </button>

          <button
            onClick={handleExportCsv}
            disabled={historyPoints.length === 0}
            className="py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition flex items-center justify-center gap-2 uppercase cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>EXPORT CSV</span>
          </button>

          <button
            onClick={handleClearHistory}
            disabled={historyPoints.length === 0}
            className="py-2.5 px-3 bg-red-50 hover:bg-red-100 text-red-700 font-extrabold text-xs rounded-xl border border-red-200 transition flex items-center justify-center gap-1.5 uppercase cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-600" />
            <span>CLEAR</span>
          </button>
        </div>
      </div>
    </div>
  );
};
