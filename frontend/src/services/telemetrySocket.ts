/**
 * telemetrySocket.ts — WebSocket Telemetry Client & Stale Data Manager
 * ====================================================================
 * BRAIN – Battery Risk and Analytics Intelligence Network
 * 
 * Manages:
 *   1. WebSocket connection to /ws/telemetry with auto-reconnect
 *   2. REST polling fallback (GET /battery/telemetry)
 *   3. Canonical schema validation & telemetry state subscription
 *   4. Stale Data Detection (data stale if no packet for > 2.5s)
 *   5. Fault injection (POST /battery/fault) & Scenario selection (POST /battery/scenario)
 */

import { batteryStateService } from './batteryStateService';

export interface CanonicalCellTelemetry {
  id: number;
  voltage_V: number;
  temperature_C: number;
  resistance_ohm: number;
  soc?: number;
  deviation?: number;
  risk?: number;
  status?: 'HEALTHY' | 'WATCH' | 'WARNING' | 'CRITICAL';
}

export interface CanonicalTelemetryPacket {
  battery_id: string;
  timestamp: string;
  sequence: number;
  transport?: string;
  device_name?: string;

  pack: {
    voltage_V: number;
    current_A: number;
    power_W: number;
    cycle_number?: number;
  };

  cells: CanonicalCellTelemetry[];

  thermal: {
    min_temperature_C: number;
    max_temperature_C: number;
    average_temperature_C: number;
  };

  cooling: {
    status: 'OK' | 'FAULT' | string;
    flow_rate_LPM: number;
  };

  battery: {
    cycle_number: number;
    capacity_Ah: number;
    resistance_ohm: number;
  };

  faults: {
    status: 'NORMAL' | 'WARNING' | 'CRITICAL' | string;
    active: string[];
  };

  // Prediction engine response (if connected)
  predictions?: {
    soc_percent?: number;
    soh_percent?: number;
    rul_cycles?: number;
    risk_status?: string;
  };
}

export type ConnectionStatusType = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';
export type StaleStatusType = 'LIVE' | 'DATA STALE';

export type TelemetryListener = (
  packet: CanonicalTelemetryPacket,
  connStatus: ConnectionStatusType,
  staleStatus: StaleStatusType
) => void;

class TelemetrySocketService {
  private socket: WebSocket | null = null;
  private listeners: Set<TelemetryListener> = new Set();
  
  private connectionStatus: ConnectionStatusType = 'DISCONNECTED';
  private staleStatus: StaleStatusType = 'DATA STALE';
  
  private lastPacketTime: number = 0;
  private latestPacket: CanonicalTelemetryPacket | null = null;
  
  private pollingTimer: number | null = null;
  private staleCheckTimer: number | null = null;
  private reconnectTimer: number | null = null;

  private baseUrl: string;
  private wsUrl: string;

  constructor() {
    this.baseUrl = this.getResolvedBaseUrl();
    this.wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws/telemetry';
    this.startStaleChecker();
  }

  public getResolvedBaseUrl(): string {
    const envUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
    if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
      return envUrl.replace(/\/$/, '').replace(/\/api\/v1$/, '');
    }
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const targetHost = (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1')
      ? currentHost
      : 'localhost';
    return `http://${targetHost}:8000`;
  }

  public subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    if (this.latestPacket) {
      listener(this.latestPacket, this.connectionStatus, this.staleStatus);
    }
    if (this.connectionStatus === 'DISCONNECTED') {
      this.connect();
    }
    return () => this.listeners.delete(listener);
  }

  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setConnectionState('CONNECTING');

    try {
      this.socket = new WebSocket(this.wsUrl);

      this.socket.onopen = () => {
        this.setConnectionState('CONNECTED');
        this.stopPolling();
      };

      this.socket.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (this.validatePacket(raw)) {
            this.handleIncomingPacket(raw);
          }
        } catch (e) {
          console.warn('[TELEMETRY WS] Packet parse error:', e);
        }
      };

      this.socket.onerror = () => {
        this.setConnectionState('ERROR');
        this.startPollingFallback();
      };

      this.socket.onclose = () => {
        this.setConnectionState('DISCONNECTED');
        this.startPollingFallback();
        this.scheduleReconnect();
      };
    } catch (e) {
      this.setConnectionState('ERROR');
      this.startPollingFallback();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private startPollingFallback(): void {
    if (this.pollingTimer) return;
    const poll = async () => {
      try {
        const res = await fetch(`${this.baseUrl}/battery/telemetry`);
        if (res.ok) {
          const raw = await res.json();
          if (this.validatePacket(raw)) {
            this.setConnectionState('CONNECTED');
            this.handleIncomingPacket(raw);
          }
        } else {
          this.setConnectionState('DISCONNECTED');
        }
      } catch (e) {
        this.setConnectionState('DISCONNECTED');
      }
    };
    poll();
    this.pollingTimer = window.setInterval(poll, 1000);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private startStaleChecker(): void {
    if (this.staleCheckTimer) return;
    this.staleCheckTimer = window.setInterval(() => {
      const now = Date.now();
      if (this.lastPacketTime > 0 && now - this.lastPacketTime > 2500) {
        if (this.staleStatus !== 'DATA STALE') {
          this.staleStatus = 'DATA STALE';
          this.notify();
        }
      }
    }, 500);
  }

  private validatePacket(data: any): data is CanonicalTelemetryPacket {
    if (!data || typeof data !== 'object') return false;
    return Boolean(
      data.battery_id &&
      data.pack &&
      typeof data.pack.voltage_V === 'number' &&
      Array.isArray(data.cells) &&
      data.thermal &&
      data.cooling &&
      data.battery &&
      data.faults
    );
  }

  private handleIncomingPacket(packet: CanonicalTelemetryPacket): void {
    this.lastPacketTime = Date.now();
    this.staleStatus = 'LIVE';
    this.latestPacket = packet;
    this.notify();

    if (packet.transport !== 'LAN_BLUETOOTH_BRIDGE') return;

    // Directly bridge incoming telemetry to batteryStateService so UI updates live
    try {
      const pack = packet.pack || {};
      const thermal = packet.thermal || {};
      const cells = packet.cells || [];
      const volt = pack.voltage_V ?? (pack as any).voltage ?? 27.2;
      const curr = pack.current_A ?? (pack as any).current ?? 15.0;
      const powerKw = pack.power_W ? +(pack.power_W / 1000).toFixed(2) : +((volt * curr) / 1000).toFixed(2);
      const maxTemp = thermal.max_temperature_C ?? (thermal as any).max_temperature ?? 28.5;
      const minTemp = thermal.min_temperature_C ?? (thermal as any).min_temperature ?? 28.0;
      const soc = cells.length > 0 ? (cells[0].soc ?? 54.3) : 54.3;
      const faultStatus = packet.faults?.status || 'NORMAL';
      const activeFaults = packet.faults?.active || [];
      const isFault = faultStatus !== 'NORMAL' || activeFaults.length > 0;
      const safetyState = faultStatus === 'CRITICAL' ? 'CRITICAL' : isFault ? 'WARNING' : 'HEALTHY';
      const bmsRisk = faultStatus === 'CRITICAL' ? 85 : isFault ? 55 : 5;

      const stateSnapshot = batteryStateService.getSnapshot();
      if (stateSnapshot.connectionState === 'CONNECTED' || stateSnapshot.connectionState === 'CONNECTING') {
        batteryStateService.processLiveBleTelemetry(
          {
            protocolVersion: '1.0',
            messageType: 'TELEMETRY',
            sequenceNumber: packet.sequence || Date.now(),
            timestamp: Date.now(),
            pack: {
              soc: Math.round(soc),
              soh: packet.predictions?.soh_percent || 98.0,
              voltage: volt,
              current: curr,
              power: powerKw,
              temperature: maxTemp,
              maxTemperature: maxTemp,
              minTemperature: minTemp,
              internalResistance: packet.battery?.resistance_ohm || 0.021,
              cycleCount: packet.battery?.cycle_number || 75,
              estimatedRange: Math.round(soc * 4.1),
              risk: bmsRisk,
              safetyState,
            },
            environment: { ambientTemperature: 25.0 },
            charging: { active: false, current: 0, power: 0, temperature: maxTemp, durationSeconds: 0 },
            cells: cells.slice(0, 8).map((c, idx) => {
              const cell = c as CanonicalCellTelemetry;
              const cellTemp = cell.temperature_C ?? maxTemp;
              const cellStatus = cell.status || (cellTemp >= 55 ? 'CRITICAL' : cellTemp >= 45 ? 'WARNING' : 'HEALTHY');
              return {
                id: cell.id || idx + 1,
                voltage: cell.voltage_V ?? 3.40,
                temperature: cellTemp,
                deviation: cell.deviation ?? 0.01,
                risk: cell.risk ?? (cellStatus === 'CRITICAL' ? 85 : cellStatus === 'WARNING' ? 55 : 2),
                status: cellStatus,
              };
            }),
          },
          {
            name: stateSnapshot.deviceName || 'Digital Twin Battery (BATTERY_PACK_01)',
            id: stateSnapshot.deviceId || 'BATTERY_PACK_01',
            rssi: -42,
          }
        );
      }
    } catch (e) {
      console.warn('[TELEMETRY WS] Battery state sync error:', e);
    }
  }

  private setConnectionState(state: ConnectionStatusType): void {
    this.connectionStatus = state;
    this.notify();
  }

  private notify(): void {
    if (this.latestPacket) {
      this.listeners.forEach(cb => cb(this.latestPacket!, this.connectionStatus, this.staleStatus));
    }
  }

  // ── Fault & Scenario Action Dispatchers ──

  public async injectFault(faultType: string, severity: number = 0.30, cellId: number = 5, active: boolean = true): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}/battery/fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_type: faultType,
          severity,
          cell_id: cellId,
          active
        })
      });
      return await res.json();
    } catch (e) {
      return { status: 'ERROR', message: 'Fault dispatch failed' };
    }
  }

  public async setScenario(scenario: string, loadCurrentA?: number): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}/battery/scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario,
          load_current_A: loadCurrentA
        })
      });
      return await res.json();
    } catch (e) {
      return { status: 'ERROR', message: 'Scenario dispatch failed' };
    }
  }

  public async fetchHistory(limit: number = 300): Promise<CanonicalTelemetryPacket[]> {
    try {
      const res = await fetch(`${this.baseUrl}/battery/history?limit=${limit}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {}
    return [];
  }
}

export const telemetrySocketService = new TelemetrySocketService();
export default telemetrySocketService;
