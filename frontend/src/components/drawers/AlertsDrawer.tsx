import React, { useState } from 'react';
import type { NormalizedBatteryState } from '../../types/telemetry';
import { ArrowLeft, AlertTriangle, ShieldAlert, Power, CheckCircle2, Radio, Bell, Info, Activity, AlertCircle } from 'lucide-react';
import { PinnEngine } from '../../services/pinnEngine';

interface AlertsDrawerProps {
  batteryState: NormalizedBatteryState;
  onBack: () => void;
}

export const AlertsDrawer: React.FC<AlertsDrawerProps> = ({ batteryState, onBack }) => {
  const [isContactorCutoff, setIsContactorCutoff] = useState(false);

  const maxTemp = batteryState.maxTemperature || batteryState.temperature;
  const isConnected = batteryState.connectionState === 'CONNECTED';
  const maxCellVoltage = isConnected && batteryState.cells.length ? Math.max(...batteryState.cells.map((cell) => cell.voltage)) : null;
  const minCellVoltage = isConnected && batteryState.cells.length ? Math.min(...batteryState.cells.map((cell) => cell.voltage)) : null;
  const cellDeltaMv = maxCellVoltage !== null && minCellVoltage !== null ? (maxCellVoltage - minCellVoltage) * 1000 : null;
  const pinn = PinnEngine.evaluatePhysicsModel(batteryState);

  // Compute Minor & Major Battery Problems
  const minorProblems: { title: string; desc: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }[] = [];

  if (isConnected && batteryState.safetyState !== 'HEALTHY') {
    minorProblems.push({
      title: `BMS ${batteryState.safetyState} condition`,
      desc: `The live BMS reports a risk score of ${Math.round(batteryState.risk)}%. Review battery faults and cell readings.`,
      severity: batteryState.safetyState === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
    });
  }

  if (isConnected && batteryState.safetyState === 'HEALTHY' && pinn.thermalRunawayRiskPct >= 18) {
    minorProblems.push({
      title: `${pinn.overallRiskLevel} battery risk`,
      desc: `Live risk estimate is ${pinn.thermalRunawayRiskPct}%. ${pinn.recommendations[0]}`,
      severity: pinn.thermalRunawayRiskPct >= 75 ? 'HIGH' : 'MEDIUM',
    });
  }

  const abnormalCells = batteryState.cells.filter((cell) => cell.status !== 'HEALTHY' || cell.risk >= 35);
  if (isConnected && abnormalCells.length > 0) {
    minorProblems.push({
      title: `Abnormal cell${abnormalCells.length > 1 ? 's' : ''} detected`,
      desc: `Cell${abnormalCells.length > 1 ? 's' : ''} ${abnormalCells.map((cell) => cell.id).join(', ')} flagged by live BMS telemetry.`,
      severity: abnormalCells.some((cell) => cell.status === 'CRITICAL' || cell.risk >= 75) ? 'HIGH' : 'MEDIUM',
    });
  }

  if (isConnected && pinn.cellImbalanceIndex > 0.025) {
    minorProblems.push({
      title: 'Cell Voltage Imbalance Warning',
      desc: `Cell variance is ${(pinn.cellImbalanceIndex * 1000).toFixed(0)}mV. Passive balancing recommended.`,
      severity: 'MEDIUM',
    });
  }

  if (isConnected && maxTemp > 40) {
    minorProblems.push({
      title: 'Elevated Operating Temperature',
      desc: `Battery max temp reached ${maxTemp}°C (Normal: 25-38°C). Avoid prolonged fast charging.`,
      severity: maxTemp > 50 ? 'HIGH' : 'MEDIUM',
    });
  }

  if (isConnected && batteryState.internalResistance > 1.5) {
    minorProblems.push({
      title: 'Increased Internal Resistance (Esr)',
      desc: `Resistance at ${batteryState.internalResistance} mΩ/cell. Slight ohmic heating expected.`,
      severity: 'LOW',
    });
  }

  if (isConnected && batteryState.soc > 0 && batteryState.soc < 20) {
    minorProblems.push({
      title: 'Low State of Charge (SOC < 20%)',
      desc: `Battery level is at ${Math.round(batteryState.soc)}%. Connect charger to prevent cell deep discharge.`,
      severity: 'LOW',
    });
  }

  const isEmergency = isConnected && (batteryState.safetyState === 'CRITICAL' || pinn.thermalRunawayRiskPct >= 75 || maxTemp > 55 || isContactorCutoff);
  const displayedStatus = !isConnected ? 'NO LIVE DATA' : isEmergency ? 'CRITICAL' : batteryState.safetyState !== 'HEALTHY' ? batteryState.safetyState : pinn.overallRiskLevel;
  const statusClass = !isConnected
    ? 'bg-slate-50 text-slate-600 border-slate-300'
    : isEmergency
    ? 'bg-red-50 text-red-700 border-red-300'
    : displayedStatus === 'ELEVATED'
    ? 'bg-orange-50 text-orange-700 border-orange-300'
    : displayedStatus === 'WATCH' || displayedStatus === 'WARNING'
    ? 'bg-amber-50 text-amber-700 border-amber-300'
    : 'bg-emerald-50 text-emerald-700 border-emerald-300';

  return (
    <div className="space-y-4 animate-fadeIn text-slate-900">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-black text-slate-900 heading-tech uppercase flex items-center gap-1.5 truncate">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
              ALERTS &amp; BATTERY ISSUES MODE
            </h2>
            <p className="text-[11px] text-slate-500 font-semibold truncate">
              Real-Time Safety Protection &amp; Minor Problem Monitoring
            </p>
          </div>
        </div>
        <span
          className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border shrink-0 ${statusClass}`}
        >
          {displayedStatus}
        </span>
      </div>

      {/* High Voltage Contactor Safety Banner */}
      <div
        className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 shadow-sm ${isEmergency ? 'bg-red-50 border-red-300 text-red-900' : !isConnected ? 'bg-slate-50 border-slate-300 text-slate-700' : displayedStatus === 'HEALTHY' || displayedStatus === 'SAFE' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-amber-50 border-amber-300 text-amber-900'}`}
      >
        <div className="flex items-center gap-3.5">
          <div className={`p-3 rounded-xl ${isEmergency ? 'bg-red-500 text-white animate-pulse' : !isConnected ? 'bg-slate-500 text-white' : displayedStatus === 'HEALTHY' || displayedStatus === 'SAFE' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-extrabold uppercase">
              SOFTWARE ISOLATION OVERRIDE: {isContactorCutoff ? 'ACTIVE' : 'INACTIVE'}
            </div>
            <div className="text-xs font-black mt-0.5">
              {!isConnected ? 'Connect a battery to receive live safety status.' : isEmergency ? 'Critical live signal detected. Reduce load and inspect before continuing.' : displayedStatus === 'HEALTHY' || displayedStatus === 'SAFE' ? 'No current abnormal live signals reported.' : 'A live warning is present. Check the battery readings below.'}
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsContactorCutoff(!isContactorCutoff)}
          className={`px-3.5 py-2 rounded-xl font-extrabold text-xs transition shadow-sm cursor-pointer flex items-center gap-1.5 uppercase tracking-wider ${
            isContactorCutoff ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          <Power className="w-3.5 h-3.5" />
          <span>{isContactorCutoff ? 'CLEAR OVERRIDE' : 'SIMULATE ISOLATION'}</span>
        </button>
      </div>

      {/* MINOR BATTERY ISSUES SECTION */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            BATTERY WARNINGS &amp; ANOMALIES ({minorProblems.length})
          </h3>
          <span className="text-[10px] font-mono text-slate-400">PINN Diagnostic Engine</span>
        </div>

        {!isConnected ? (
          <div className="p-3 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl flex items-center gap-2 text-xs font-bold">
            <Radio className="w-4 h-4 text-slate-500 shrink-0" />
            <span>No live battery data is connected, so the app cannot confirm that warnings are clear.</span>
          </div>
        ) : minorProblems.length > 0 ? (
          <div className="space-y-2">
            {minorProblems.map((prob, i) => (
              <div
                key={i}
                className={`p-3 rounded-xl border flex items-start gap-3 ${
                  prob.severity === 'HIGH'
                    ? 'bg-red-50 border-red-200 text-red-900'
                    : prob.severity === 'MEDIUM'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-blue-50 border-blue-200 text-blue-900'
                }`}
              >
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-black">{prob.title}</div>
                  <div className="text-[11px] font-semibold mt-0.5 opacity-90">{prob.desc}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 bg-emerald-50/70 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>No active battery warnings or cell anomalies are present in the latest live readings.</span>
          </div>
        )}
      </div>

      {/* Live Parameter Protection Threshold Cards */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-600" />
            SAFETY PARAMETER PROTECTION THRESHOLDS
          </h3>
          <span className="text-[10px] font-mono font-bold text-slate-400">Fixed BMS Safety Rules</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[10px] font-extrabold text-slate-400 uppercase">MAX TEMP LIMIT</div>
            <div className="text-sm font-black text-slate-900">55.0 °C</div>
            <div className="text-[10px] font-mono flex justify-between">
              <span className="text-slate-500">Live Pack Max:</span>
              <span className={`font-bold ${!isConnected ? 'text-slate-400' : maxTemp > 55 ? 'text-red-600' : maxTemp > 40 ? 'text-amber-600' : 'text-emerald-600'}`}>{isConnected ? `${maxTemp} °C` : 'N/A'}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[10px] font-extrabold text-slate-400 uppercase">OVER-VOLTAGE LIMIT</div>
            <div className="text-sm font-black text-slate-900">4.20 V / cell</div>
            <div className="text-[10px] font-mono flex justify-between">
              <span className="text-slate-500">Live Max Cell:</span>
              <span className={`font-bold ${maxCellVoltage === null ? 'text-slate-400' : maxCellVoltage >= 4.2 ? 'text-red-600' : 'text-emerald-600'}`}>{maxCellVoltage === null ? 'N/A' : `${maxCellVoltage.toFixed(2)} V`}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[10px] font-extrabold text-slate-400 uppercase">UNDER-VOLTAGE LIMIT</div>
            <div className="text-sm font-black text-slate-900">2.50 V / cell</div>
            <div className="text-[10px] font-mono flex justify-between">
              <span className="text-slate-500">Live Min Cell:</span>
              <span className={`font-bold ${minCellVoltage === null ? 'text-slate-400' : minCellVoltage <= 2.5 ? 'text-red-600' : 'text-emerald-600'}`}>{minCellVoltage === null ? 'N/A' : `${minCellVoltage.toFixed(2)} V`}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-[10px] font-extrabold text-slate-400 uppercase">CELL IMBALANCE LIMIT</div>
            <div className="text-sm font-black text-slate-900">30 mV (0.030V)</div>
            <div className="text-[10px] font-mono flex justify-between">
              <span className="text-slate-500">Live Delta:</span>
              <span className={`font-bold ${cellDeltaMv === null ? 'text-slate-400' : cellDeltaMv > 30 ? 'text-red-600' : cellDeltaMv > 20 ? 'text-amber-600' : 'text-emerald-600'}`}>{cellDeltaMv === null ? 'N/A' : `${cellDeltaMv.toFixed(1)} mV`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live System Safety Alarms */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-red-600" />
            CRITICAL HARDWARE ALARM LOGS
          </h3>
          <span className="text-[10px] font-mono text-slate-400">Continuous Monitor</span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="font-semibold text-slate-700">Thermal Runaway Limit (&gt; 55°C)</span>
            <span className={`font-mono font-bold ${!isConnected ? 'text-slate-400' : maxTemp > 55 ? 'text-red-600' : 'text-emerald-600'}`}>
              {!isConnected ? 'NO LIVE DATA' : maxTemp > 55 ? 'TRIGGERED' : 'CLEAR'} ({isConnected ? `${maxTemp}°C` : 'N/A'})
            </span>
          </div>

          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="font-semibold text-slate-700">Cell Over-Voltage Cutoff (&gt; 4.2V)</span>
            <span className={`font-mono font-bold ${maxCellVoltage === null ? 'text-slate-400' : maxCellVoltage > 4.2 ? 'text-red-600' : 'text-emerald-600'}`}>{maxCellVoltage === null ? 'NO LIVE DATA' : maxCellVoltage > 4.2 ? 'TRIGGERED' : 'CLEAR'}</span>
          </div>

          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="font-semibold text-slate-700">Cell Under-Voltage Cutoff (&lt; 2.5V)</span>
            <span className={`font-mono font-bold ${minCellVoltage === null ? 'text-slate-400' : minCellVoltage < 2.5 ? 'text-red-600' : 'text-emerald-600'}`}>{minCellVoltage === null ? 'NO LIVE DATA' : minCellVoltage < 2.5 ? 'TRIGGERED' : 'CLEAR'}</span>
          </div>

          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="font-semibold text-slate-700">Cell Imbalance (&gt; 30mV)</span>
            <span className={`font-mono font-bold ${cellDeltaMv === null ? 'text-slate-400' : cellDeltaMv > 30 ? 'text-red-600' : 'text-emerald-600'}`}>{cellDeltaMv === null ? 'NO LIVE DATA' : cellDeltaMv > 30 ? 'TRIGGERED' : 'CLEAR'}</span>
          </div>

          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="font-semibold text-slate-700">PINN Thermal Risk Score</span>
            <span className={`font-mono font-bold ${!isConnected ? 'text-slate-400' : pinn.thermalRunawayRiskPct >= 75 ? 'text-red-600' : pinn.thermalRunawayRiskPct >= 35 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {isConnected ? `${pinn.thermalRunawayRiskPct}% (${pinn.overallRiskLevel})` : 'N/A (NO LIVE DATA)'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertsDrawer;
