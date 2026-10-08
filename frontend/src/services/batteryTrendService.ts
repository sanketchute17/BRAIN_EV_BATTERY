/**
 * batteryTrendService.ts — Historical Battery Telemetry & Stress Analytics Engine
 * =================================================================================
 * BRAIN – Battery Risk and Analytics Intelligence Network
 * 
 * Functions:
 *   1. Buffers rolling telemetry history in localStorage & memory (up to 1,000 data points).
 *   2. Classifies each operating point into:
 *      - MINIMALIST (Eco / Minimal stress: <8A current, <32°C temp)
 *      - MODERATE (Normal operational load: 8A-25A current, 32°C-40°C temp)
 *      - HIGH_STRESS (Peak load / thermal spike: >25A current, >40°C temp, or cell imbalance >50mV)
 *      - CHARGING (Negative current input)
 *   3. Calculates overall battery stress index (0-100) using physical parameters.
 *   4. Formats time-series arrays for visual SVG/Canvas trend charts.
 *   5. Logs timestamped stress spike events for user analysis.
 */

import type { NormalizedBatteryState } from '../types/telemetry';
import { telemetrySocketService } from './telemetrySocket';

export type StressCategory = 'MINIMALIST' | 'MODERATE' | 'HIGH_STRESS' | 'CHARGING';

export interface TelemetryTrendPoint {
  timestamp: string;
  timeLabel: string;
  voltage: number;
  current: number;
  temperature: number;
  soc: number;
  soh: number;
  powerKw: number;
  cellImbalanceMv: number;
  stressCategory: StressCategory;
  stressScore: number; // 0 - 100
}

export interface StressEventLog {
  id: string;
  timestamp: string;
  category: StressCategory;
  title: string;
  description: string;
  currentA: number;
  tempC: number;
  stressScore: number;
}

export interface TrendAnalyticsSummary {
  totalPoints: number;
  minimalistPercent: number;
  moderatePercent: number;
  highStressPercent: number;
  chargingPercent: number;
  avgCurrentA: number;
  maxCurrentA: number;
  avgTempC: number;
  maxTempC: number;
  avgStressScore: number;
  maxStressScore: number;
  overallHealthCategory: 'OPTIMAL' | 'MODERATE STRESS' | 'HIGH STRESS ALERT';
}

class BatteryTrendService {
  private readonly STORAGE_KEY = 'brain_battery_trends_history_v1';
  private readonly MAX_HISTORY_POINTS = 1000;
  private history: TelemetryTrendPoint[] = [];
  private events: StressEventLog[] = [];
  private listeners: Set<() => void> = new Set();
  private lastRecordedMs: number = 0;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.history = parsed;
          }
        }
      }
    } catch (e) {
      this.history = [];
    }
  }

  private saveToStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        // Retain last MAX_HISTORY_POINTS
        if (this.history.length > this.MAX_HISTORY_POINTS) {
          this.history = this.history.slice(this.history.length - this.MAX_HISTORY_POINTS);
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.history));
      }
    } catch (e) {}
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch (e) {}
    });
  }

  /**
   * Evaluate Stress Category based on electrical and thermal parameters
   */
  public evaluateStress(currentA: number, tempC: number, powerKw: number, imbalanceMv: number): {
    category: StressCategory;
    score: number;
  } {
    const absCurr = Math.abs(currentA);

    if (currentA < -0.2) {
      return { category: 'CHARGING', score: Math.min(30, Math.round(absCurr * 2)) };
    }

    // Calculate normalized 0-100 Stress Score
    const currentStress = Math.min(45, (absCurr / 45.0) * 45);
    const tempStress = Math.min(40, (Math.max(0, tempC - 25.0) / 30.0) * 40);
    const imbalanceStress = Math.min(15, (imbalanceMv / 60.0) * 15);
    const rawScore = Math.round(currentStress + tempStress + imbalanceStress);
    const score = Math.max(0, Math.min(100, rawScore));

    let category: StressCategory = 'MINIMALIST';
    if (absCurr > 25.0 || tempC > 40.0 || imbalanceMv > 45.0 || score > 60) {
      category = 'HIGH_STRESS';
    } else if (absCurr >= 8.0 || tempC >= 32.0 || score >= 25) {
      category = 'MODERATE';
    } else {
      category = 'MINIMALIST';
    }

    return { category, score };
  }

  /**
   * Record Telemetry Snapshot into rolling trend history
   */
  public recordSnapshot(state: NormalizedBatteryState): void {
    const nowMs = Date.now();
    // Throttle recording to max 1 point per 800ms
    if (nowMs - this.lastRecordedMs < 800) return;
    this.lastRecordedMs = nowMs;

    const volt = state.voltage || 25.6;
    const curr = state.current || 0.0;
    const temp = state.maxTemperature || state.temperature || 25.0;
    const soc = state.soc ?? 84;
    const soh = state.soh ?? 96.4;
    const powerKw = state.power || +((volt * curr) / 1000.0).toFixed(2);

    // Calculate Cell Imbalance (Max V - Min V in mV)
    let imbalanceMv = 0;
    if (state.cells && state.cells.length > 0) {
      const vList = state.cells.map((c) => c.voltage).filter((v) => v > 0);
      if (vList.length > 0) {
        const maxV = Math.max(...vList);
        const minV = Math.min(...vList);
        imbalanceMv = Math.round((maxV - minV) * 1000);
      }
    }

    const { category, score } = this.evaluateStress(curr, temp, powerKw, imbalanceMv);
    const timeObj = new Date();
    const timeLabel = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const point: TelemetryTrendPoint = {
      timestamp: timeObj.toISOString(),
      timeLabel,
      voltage: +volt.toFixed(2),
      current: +curr.toFixed(2),
      temperature: +temp.toFixed(1),
      soc: Math.round(soc),
      soh: +soh.toFixed(1),
      powerKw: +powerKw.toFixed(2),
      cellImbalanceMv: imbalanceMv,
      stressCategory: category,
      stressScore: score,
    };

    this.history.push(point);

    // Log High Stress Event if triggered
    if (category === 'HIGH_STRESS') {
      const lastEvent = this.events[0];
      // Deduplicate events within 10 seconds
      if (!lastEvent || nowMs - new Date(lastEvent.timestamp).getTime() > 10000) {
        let reason = 'Peak Power Draw';
        if (curr > 28.0) reason = `High Current Load (${curr.toFixed(1)} A)`;
        else if (temp > 40.0) reason = `Thermal Spike (${temp.toFixed(1)} °C)`;
        else if (imbalanceMv > 45.0) reason = `Cell Voltage Deviation (${imbalanceMv} mV)`;

        this.events.unshift({
          id: `EVT_${nowMs}`,
          timestamp: timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          category: 'HIGH_STRESS',
          title: `Battery High Stress Detected: ${reason}`,
          description: `Current: ${curr.toFixed(1)}A | Temp: ${temp.toFixed(1)}°C | Imbalance: ${imbalanceMv}mV`,
          currentA: curr,
          tempC: temp,
          stressScore: score,
        });

        // Limit event log size to 50
        if (this.events.length > 50) this.events.pop();
      }
    }

    this.saveToStorage();
    this.notify();
  }

  /**
   * Sync rolling historical buffer from FastAPI backend (/battery/history)
   */
  public async syncBackendHistory(): Promise<void> {
    try {
      const backendHistory = await telemetrySocketService.fetchHistory(300);
      if (Array.isArray(backendHistory) && backendHistory.length > 0) {
        backendHistory.forEach((packet: any) => {
          const volt = packet.pack?.voltage_V ?? packet.pack?.voltage ?? 25.6;
          const curr = packet.pack?.current_A ?? packet.pack?.current ?? 0;
          const temp = packet.thermal?.max_temperature_C ?? packet.thermal?.max_temperature ?? 25;
          const soc = packet.cells && packet.cells.length > 0 ? (packet.cells[0].soc ?? 84) : 84;
          const powerKw = packet.pack?.power_W ? +(packet.pack.power_W / 1000).toFixed(2) : +((volt * curr) / 1000).toFixed(2);
          const timeObj = new Date(packet.timestamp || Date.now());

          let imbalanceMv = 0;
          if (packet.cells && packet.cells.length > 0) {
            const vList = packet.cells.map((c: any) => c.voltage_V ?? c.voltage ?? 0).filter((v: number) => v > 0);
            if (vList.length > 0) {
              imbalanceMv = Math.round((Math.max(...vList) - Math.min(...vList)) * 1000);
            }
          }

          const { category, score } = this.evaluateStress(curr, temp, powerKw, imbalanceMv);
          const point: TelemetryTrendPoint = {
            timestamp: timeObj.toISOString(),
            timeLabel: timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            voltage: +volt.toFixed(2),
            current: +curr.toFixed(2),
            temperature: +temp.toFixed(1),
            soc: Math.round(soc),
            soh: packet.battery?.soh || 96.4,
            powerKw: +powerKw.toFixed(2),
            cellImbalanceMv: imbalanceMv,
            stressCategory: category,
            stressScore: score,
          };

          if (!this.history.some((h) => h.timestamp === point.timestamp)) {
            this.history.push(point);
          }
        });

        this.history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        this.saveToStorage();
        this.notify();
      }
    } catch (e) {}
  }

  /**
   * Get filtered history by time range
   */
  public getHistory(timeRangeWindow: '5M' | '15M' | '1H' | '24H' | 'ALL' = 'ALL'): TelemetryTrendPoint[] {
    if (this.history.length === 0) return [];
    if (timeRangeWindow === 'ALL') return this.history;

    const now = Date.now();
    let durationMs = 5 * 60 * 1000;
    if (timeRangeWindow === '15M') durationMs = 15 * 60 * 1000;
    else if (timeRangeWindow === '1H') durationMs = 60 * 60 * 1000;
    else if (timeRangeWindow === '24H') durationMs = 24 * 60 * 60 * 1000;

    return this.history.filter((p) => now - new Date(p.timestamp).getTime() <= durationMs);
  }

  /**
   * Get logged stress events
   */
  public getStressEvents(): StressEventLog[] {
    return this.events;
  }

  /**
   * Compute aggregated analytics summary
   */
  public getAnalyticsSummary(timeRangeWindow: '5M' | '15M' | '1H' | '24H' | 'ALL' = 'ALL'): TrendAnalyticsSummary {
    const pts = this.getHistory(timeRangeWindow);
    if (pts.length === 0) {
      return {
        totalPoints: 0,
        minimalistPercent: 100,
        moderatePercent: 0,
        highStressPercent: 0,
        chargingPercent: 0,
        avgCurrentA: 0,
        maxCurrentA: 0,
        avgTempC: 22.5,
        maxTempC: 22.5,
        avgStressScore: 5,
        maxStressScore: 5,
        overallHealthCategory: 'OPTIMAL',
      };
    }

    let minimalistCount = 0;
    let moderateCount = 0;
    let highStressCount = 0;
    let chargingCount = 0;

    let sumCurrent = 0;
    let maxCurrent = 0;
    let sumTemp = 0;
    let maxTemp = 0;
    let sumStress = 0;
    let maxStress = 0;

    pts.forEach((p) => {
      if (p.stressCategory === 'MINIMALIST') minimalistCount++;
      else if (p.stressCategory === 'MODERATE') moderateCount++;
      else if (p.stressCategory === 'HIGH_STRESS') highStressCount++;
      else if (p.stressCategory === 'CHARGING') chargingCount++;

      const absCurr = Math.abs(p.current);
      sumCurrent += absCurr;
      if (absCurr > maxCurrent) maxCurrent = absCurr;

      sumTemp += p.temperature;
      if (p.temperature > maxTemp) maxTemp = p.temperature;

      sumStress += p.stressScore;
      if (p.stressScore > maxStress) maxStress = p.stressScore;
    });

    const total = pts.length;
    const minimalistPercent = Math.round((minimalistCount / total) * 100);
    const moderatePercent = Math.round((moderateCount / total) * 100);
    const highStressPercent = Math.round((highStressCount / total) * 100);
    const chargingPercent = Math.round((chargingCount / total) * 100);

    const avgCurrentA = +(sumCurrent / total).toFixed(1);
    const avgTempC = +(sumTemp / total).toFixed(1);
    const avgStressScore = Math.round(sumStress / total);

    let overallHealthCategory: 'OPTIMAL' | 'MODERATE STRESS' | 'HIGH STRESS ALERT' = 'OPTIMAL';
    if (highStressPercent > 20 || maxTemp > 45.0 || maxStress > 75) {
      overallHealthCategory = 'HIGH STRESS ALERT';
    } else if (highStressPercent > 5 || avgStressScore > 35) {
      overallHealthCategory = 'MODERATE STRESS';
    }

    return {
      totalPoints: total,
      minimalistPercent,
      moderatePercent,
      highStressPercent,
      chargingPercent,
      avgCurrentA,
      maxCurrentA: +maxCurrent.toFixed(1),
      avgTempC,
      maxTempC: +maxTemp.toFixed(1),
      avgStressScore,
      maxStressScore: maxStress,
      overallHealthCategory,
    };
  }

  /**
   * Clear recorded trend history
   */
  public clearHistory(): void {
    this.history = [];
    this.events = [];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.STORAGE_KEY);
      }
    } catch (e) {}
    this.notify();
  }
}

export const batteryTrendService = new BatteryTrendService();
export default batteryTrendService;
