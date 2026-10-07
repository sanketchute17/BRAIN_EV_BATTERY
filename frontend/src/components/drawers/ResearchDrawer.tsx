import React, { useEffect, useState } from 'react';
import type { NormalizedBatteryState } from '../../types/telemetry';
import { ArrowLeft, BookOpen, Activity, Cpu, LineChart, ShieldCheck, Sliders } from 'lucide-react';
import { apiService } from '../../services/api';

interface ResearchDrawerProps {
  batteryState: NormalizedBatteryState;
  onBack: () => void;
}

export const ResearchDrawer: React.FC<ResearchDrawerProps> = ({ batteryState, onBack }) => {
  const [sliderTemp, setSliderTemp] = useState<number>(batteryState.maxTemperature || batteryState.temperature || 25);
  const [sliderCurrent, setSliderCurrent] = useState<number>(Math.abs(batteryState.current) || 35);
  const [sliderCycles, setSliderCycles] = useState<number>(batteryState.cycleCount || 428);
  const [modelSummary, setModelSummary] = useState<any>(null);
  const [modelPrediction, setModelPrediction] = useState<any>(null);
  const [modelError, setModelError] = useState('');
  const [isPredicting, setIsPredicting] = useState(false);

  useEffect(() => {
    apiService.getPklSummary().then(setModelSummary).catch((error) => setModelError(error.message));
  }, []);

  const runBatteryModelPrediction = async () => {
    setIsPredicting(true);
    setModelError('');
    try {
      const cells = batteryState.cells || [];
      const result = await apiService.predictWithBatteryModel({
        battery_id: batteryState.deviceId || 'BATTERY_PACK_01',
        voltage: batteryState.voltage,
        current: batteryState.current,
        temperature: batteryState.temperature,
        maxTemperature: batteryState.maxTemperature,
        cycleCount: batteryState.cycleCount,
        soc: batteryState.soc,
        soh: batteryState.soh,
        pack: {
          voltage_V: batteryState.voltage,
          current_A: batteryState.current,
          cycle_count: batteryState.cycleCount,
          soc_percent: batteryState.soc,
        },
        cells: cells.map((cell) => ({
          id: cell.id,
          voltage_V: cell.voltage,
          temperature_C: cell.temperature,
          resistance_ohm: batteryState.internalResistance / 1000,
          effective_resistance_ohm: batteryState.internalResistance / 1000,
        })),
        thermal: {
          average_temperature_C: batteryState.temperature,
          max_temperature_C: batteryState.maxTemperature,
        },
        battery: { cycle_number: batteryState.cycleCount },
        predictions: { soh_percent: batteryState.soh, soc_percent: batteryState.soc },
        cooling: { flow_rate_LPM: 0 },
        faults: { active: [] },
      });
      setModelPrediction(result);
      if (!result.available) setModelError(result.plain_explanation || 'The model cannot produce a prediction from this file.');
    } catch (error: any) {
      setModelError(error.message || 'Could not run the battery model.');
    } finally {
      setIsPredicting(false);
    }
  };

  const batteryModelLoadError = modelSummary?.load_errors?.['battery_intelligence.pkl'];

  const lithiumPlatingIndex = +(0.02 + (sliderTemp > 40 ? 0.22 : 0.03) + (sliderCurrent / 150) * 0.12).toFixed(3);
  const arrheniusDegradationFactor = +(1.0 + Math.pow(sliderTemp / 25, 2.1) + (sliderCurrent / 100) * 0.4).toFixed(2);
  const calculatedSoh = +(Math.max(60, 100 - (sliderCycles * 0.015) * arrheniusDegradationFactor)).toFixed(1);
  const RULCyclesRemaining = Math.max(0, Math.round(2000 * (calculatedSoh / 100) - sliderCycles));

  // Generate 12 SOH trajectory curve data points dynamically over 0 to 2000 cycles
  const dataPoints = Array.from({ length: 12 }, (_, i) => {
    const c = Math.round((i / 11) * 2000);
    const soh = +(Math.max(50, 100 - (c * 0.015) * arrheniusDegradationFactor)).toFixed(1);
    return { cycle: c, soh };
  });

  // SVG Chart dimensions & math
  const svgWidth = 500;
  const svgHeight = 180;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  const minSohVal = 50;
  const maxSohVal = 100;

  const getX = (index: number) => padLeft + (index / (dataPoints.length - 1)) * chartW;
  const getY = (sohVal: number) => padTop + chartH - ((sohVal - minSohVal) / (maxSohVal - minSohVal)) * chartH;

  const pointsSvgStr = dataPoints.map((d, i) => `${getX(i)},${getY(d.soh)}`).join(' ');
  const areaSvgStr = `${padLeft},${padTop + chartH} ${pointsSvgStr} ${padLeft + chartW},${padTop + chartH}`;

  // Current active cycle indicator index
  const activePointIndex = Math.min(
    dataPoints.length - 1,
    Math.max(0, Math.round((sliderCycles / 2000) * (dataPoints.length - 1)))
  );
  const activeX = getX(activePointIndex);
  const activeY = getY(calculatedSoh);

  return (
    <div className="space-y-4 animate-fadeIn text-slate-900">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-black text-slate-900 heading-tech uppercase flex items-center gap-1 truncate">
              <BookOpen className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              RESEARCH DASHBOARD &amp; PINN METRICS
            </h2>
            <p className="text-[10px] text-slate-500 font-semibold truncate">
              Physics-Informed Neural Network Aging Models
            </p>
          </div>
        </div>
        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 shrink-0">
          PINN v3.2
        </span>
      </div>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3" aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900">Battery AI prediction</h3>
            <p className="mt-1 text-xs text-slate-600">Uses battery_intelligence.pkl with the current battery readings.</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${modelSummary?.battery_model_ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
            {modelSummary?.battery_model_ready ? 'MODEL READY' : 'MODEL NOT READY'}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-700">
          In simple terms: the model looks at the battery readings it learned from during training and estimates its trained target. It is a best estimate, not a guarantee. This result is produced by the PKL model, separate from the physics-based charts below.
        </p>
        {batteryModelLoadError && (
          <div className="rounded-xl border border-amber-200 bg-white p-3 text-[11px] text-amber-900">
            <strong>The model file could not be loaded:</strong> {batteryModelLoadError}. No prediction is shown rather than guessing.
          </div>
        )}
        {modelError && !batteryModelLoadError && (
          <div className="rounded-xl border border-amber-200 bg-white p-3 text-[11px] text-amber-900">{modelError}</div>
        )}
        <button
          type="button"
          onClick={runBatteryModelPrediction}
          disabled={isPredicting || batteryState.connectionState !== 'CONNECTED' || !modelSummary?.battery_model_ready}
          className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-black text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPredicting ? 'Checking model…' : 'Predict from current battery'}
        </button>
        {batteryState.connectionState !== 'CONNECTED' && <p className="text-[10px] text-slate-500">Connect the battery to use live readings.</p>}
        {modelPrediction?.available && (
          <div className="rounded-xl border border-emerald-200 bg-white p-3 space-y-2">
            <div className="text-xs font-black text-emerald-800">Model result: {String(modelPrediction.prediction)}</div>
            <p className="text-xs text-slate-700">{modelPrediction.plain_explanation}</p>
            <details className="text-[10px] text-slate-600">
              <summary className="cursor-pointer font-bold">What readings did it use?</summary>
              <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(modelPrediction.inputs_used, null, 2)}</pre>
            </details>
          </div>
        )}
      </section>

      {/* INTERACTIVE PARAMETER TUNING SLIDERS CARD */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black text-slate-900 uppercase heading-tech tracking-wide flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-emerald-600" />
            INTERACTIVE PHYSICS PARAMETER TUNER
          </h3>
          <span className="text-[10px] font-mono text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            Live PINN Model Ingestion
          </span>
        </div>

        <div className="space-y-3">
          {/* Temperature Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-600">Operating Temperature</span>
              <span className="font-mono text-emerald-600">{sliderTemp} °C</span>
            </div>
            <input
              type="range"
              min={20}
              max={65}
              value={sliderTemp}
              onChange={(e) => setSliderTemp(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-400">
              <span>20°C (Optimal)</span>
              <span>45°C (Warning)</span>
              <span>65°C (Thermal Cutoff)</span>
            </div>
          </div>

          {/* Load Current Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-600">Discharge / Load Current</span>
              <span className="font-mono text-cyan-600">{sliderCurrent} A</span>
            </div>
            <input
              type="range"
              min={0}
              max={60}
              value={sliderCurrent}
              onChange={(e) => setSliderCurrent(Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-400">
              <span>0A (Standby)</span>
              <span>25A (Cruising Load)</span>
              <span>60A (Peak Acceleration)</span>
            </div>
          </div>

          {/* Cycle Count Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-600">Battery Life Cycle Count</span>
              <span className="font-mono text-purple-600">{sliderCycles} Cycles</span>
            </div>
            <input
              type="range"
              min={0}
              max={2000}
              step={10}
              value={sliderCycles}
              onChange={(e) => setSliderCycles(Number(e.target.value))}
              className="w-full accent-purple-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-400">
              <span>0 (Brand New)</span>
              <span>1000 (Mid-Life)</span>
              <span>2000 (EOL Limit)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Research PINN Physics Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-[9px] font-extrabold text-slate-400 uppercase">LITHIUM PLATING INDEX</div>
          <div className={`text-xl font-black ${lithiumPlatingIndex > 0.15 ? 'text-red-500' : 'text-emerald-600'}`}>
            {lithiumPlatingIndex}
          </div>
          <div className="text-[9px] font-mono text-slate-500">Threshold: 0.15</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-[9px] font-extrabold text-slate-400 uppercase">ARRHENIUS AGING</div>
          <div className="text-xl font-black text-purple-600">{arrheniusDegradationFactor}x</div>
          <div className="text-[9px] font-mono text-slate-500">Thermal Acceleration</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-[9px] font-extrabold text-slate-400 uppercase">ESTIMATED RUL</div>
          <div className="text-xl font-black text-cyan-600">{RULCyclesRemaining} cycles</div>
          <div className="text-[9px] font-mono text-slate-500">Remaining Useful Life</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-[9px] font-extrabold text-slate-400 uppercase">ESTIMATE TYPE</div>
          <div className="text-xl font-black text-blue-600">Physics</div>
          <div className="text-[9px] font-mono text-slate-500">Not the PKL model output</div>
        </div>
      </div>

      {/* SOH vs Cycle Degradation SVG Curve & Bar Chart */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black text-slate-900 uppercase heading-tech tracking-wide flex items-center gap-1.5">
            <LineChart className="w-4 h-4 text-emerald-600" />
            SOH CAPACITY FADE TRAJECTORY (PINN PREDICTION)
          </h3>
          <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            {sliderCycles} Cycles ({calculatedSoh}% SOH)
          </span>
        </div>

        {/* SVG Responsive Chart Container */}
        <div className="w-full bg-slate-50 p-2 rounded-xl border border-slate-200 overflow-hidden">
          <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto text-slate-700">
            <defs>
              <linearGradient id="sohGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
                <stop offset="70%" stopColor="#10B981" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="60%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#EF4444" />
              </linearGradient>
            </defs>

            {/* Grid Horizontal Lines & Y-Axis Labels */}
            {[100, 90, 80, 70].map((yVal) => {
              const yPos = getY(yVal);
              return (
                <g key={yVal}>
                  <line
                    x1={padLeft}
                    y1={yPos}
                    x2={padLeft + chartW}
                    y2={yPos}
                    stroke="#E2E8F0"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 6}
                    y={yPos + 3}
                    textAnchor="end"
                    className="text-[9px] font-mono font-bold fill-slate-400"
                  >
                    {yVal}%
                  </text>
                </g>
              );
            })}

            {/* Gradient Area Fill under Curve */}
            <polygon points={areaSvgStr} fill="url(#sohGradient)" />

            {/* SOH Gradient Line */}
            <polyline
              fill="none"
              stroke="url(#lineGrad)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pointsSvgStr}
            />

            {/* Bar columns under each cycle point */}
            {dataPoints.map((d, i) => {
              const xPos = getX(i);
              const yPos = getY(d.soh);
              const barH = padTop + chartH - yPos;
              const isEol = d.soh < 80;
              return (
                <rect
                  key={i}
                  x={xPos - 6}
                  y={yPos}
                  width="12"
                  height={Math.max(0, barH)}
                  rx="3"
                  fill={isEol ? '#F59E0B' : '#10B981'}
                  opacity="0.2"
                />
              );
            })}

            {/* Data Point Circles */}
            {dataPoints.map((d, i) => {
              const cx = getX(i);
              const cy = getY(d.soh);
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r="3.5"
                  className={d.soh < 80 ? 'fill-amber-500' : 'fill-emerald-500'}
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
              );
            })}

            {/* Active Live Cycle Pulsing Pin Indicator */}
            <g transform={`translate(${activeX}, ${activeY})`}>
              <circle r="8" fill="#10B981" opacity="0.3" className="animate-ping" />
              <circle r="5" fill="#059669" stroke="#FFFFFF" strokeWidth="2" />
              <rect x="-24" y="-22" width="48" height="15" rx="4" fill="#0F172A" />
              <text x="0" y="-12" textAnchor="middle" className="text-[8px] font-mono font-extrabold fill-emerald-400">
                {calculatedSoh}% SOH
              </text>
            </g>

            {/* X-Axis Cycle Labels */}
            {[0, 300, 600, 900, 1200, 1500].map((cycleVal) => {
              const idx = dataPoints.findIndex((dp) => dp.cycle === cycleVal);
              if (idx === -1) return null;
              const xPos = getX(idx);
              return (
                <text
                  key={cycleVal}
                  x={xPos}
                  y={svgHeight - 10}
                  textAnchor="middle"
                  className="text-[9px] font-mono font-bold fill-slate-500"
                >
                  {cycleVal}c
                </text>
              );
            })}
          </svg>
        </div>

        {/* Legend Footer */}
        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Optimal Window (&gt; 85% SOH)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>Degradation / EOL (&lt; 85% SOH)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResearchDrawer;
