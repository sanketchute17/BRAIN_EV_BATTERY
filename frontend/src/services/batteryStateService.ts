import type {
  NormalizedBatteryState,
  RawBleTelemetryPayload,
  BatterySourceMode,
  ConnectionState,
  HealthStatus,
  CellTelemetry,
} from '../types/telemetry';
import { BLE_CONFIG } from './bleConfig';

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

export type BatteryStateListener = (state: NormalizedBatteryState) => void;

class BatteryStateService {
  private listeners: Set<BatteryStateListener> = new Set();
  private connectionStartTime: number | null = null;
  private lastPacketArrivalMs: number | null = null;

  // System notifications state feed (starts empty until active events/connections occur)
  private notifications: SystemNotification[] = [];

  // Initial State for BRAIN Virtual Battery Simulation (8S LFP)
  private state: NormalizedBatteryState = {
    source: 'LIVE_BLE',
    connectionState: 'DISCONNECTED',
    deviceName: 'BRAIN Virtual Battery Simulation (8S LFP)',
    deviceId: 'BRAIN-SIM-8S',
    rssi: -42,
    lastUpdated: new Date().toISOString(),
    soc: 0,
    soh: 0,
    voltage: 0.0,
    current: 0.0,
    power: 0.0,
    temperature: 0.0,
    maxTemperature: 0.0,
    minTemperature: 0.0,
    internalResistance: 1.2,
    cycleCount: 428,
    estimatedRange: 0,
    risk: 0,
    safetyState: 'HEALTHY',
    ambientTemperature: 22.5,
    charging: {
      active: false,
      current: 0,
      power: 0,
      temperature: 0.0,
      durationSeconds: 0,
    },
    cells: Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      voltage: 0.0,
      temperature: 0.0,
      deviation: 0.0,
      risk: 0,
      status: 'HEALTHY' as HealthStatus,
    })),
    diagnostics: {
      deviceName: 'BRAIN Virtual Battery Simulation (8S LFP)',
      deviceId: 'BRAIN-SIM-8S',
      rssi: -42,
      connectionState: 'DISCONNECTED',
      serviceUuid: BLE_CONFIG.SERVICE_UUID,
      telemetryCharUuid: BLE_CONFIG.TELEMETRY_CHAR_UUID,
      notificationsActive: false,
      packetsReceived: 0,
      packetsLost: 0,
      lastSequenceNumber: null,
      lastPacketTimestamp: null,
      telemetryFrequencyHz: 0,
      approxLatencyMs: 0,
      connectionDurationSec: 0,
    },
  };

  /**
   * Subscribe to global normalized battery state updates
   */
  public subscribe(listener: BatteryStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((cb) => cb(snapshot));
  }

  /**
   * Notification management methods
   */
  public getNotifications(): SystemNotification[] {
    return [...this.notifications];
  }

  public clearNotifications(): void {
    this.notifications = [];
    this.notify();
  }

  public dismissNotification(id: string): void {
    this.notifications = this.notifications.filter((n) => n.id !== id);
    this.notify();
  }

  public addNotification(notification: Omit<SystemNotification, 'id' | 'timestamp'>): void {
    const newNotif: SystemNotification = {
      ...notification,
      id: 'notif-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.notifications = [newNotif, ...this.notifications].slice(0, 25);
    this.notify();
  }

  /**
   * Get immutable snapshot of current state
   */
  public getSnapshot(): NormalizedBatteryState {
    let durationSec = this.state.diagnostics.connectionDurationSec;
    if (this.connectionStartTime && this.state.connectionState === 'CONNECTED') {
      durationSec = Math.floor((Date.now() - this.connectionStartTime) / 1000);
    }

    return {
      ...this.state,
      charging: { ...this.state.charging },
      cells: this.state.cells.map((c) => ({ ...c })),
      diagnostics: {
        ...this.state.diagnostics,
        connectionDurationSec: durationSec,
      },
    };
  }

  /**
   * Validate incoming raw BLE telemetry payload against contract schema
   */
  public validateTelemetryPayload(data: any): data is RawBleTelemetryPayload {
    if (!data || typeof data !== 'object') return false;
    if (data.protocolVersion !== BLE_CONFIG.PROTOCOL_VERSION) return false;
    if (data.messageType !== 'TELEMETRY') return false;
    if (typeof data.sequenceNumber !== 'number') return false;
    if (!data.pack || typeof data.pack.soc !== 'number' || typeof data.pack.voltage !== 'number') return false;
    return true;
  }

  /**
   * Process and ingest live BLE telemetry packet
   */
  public processLiveBleTelemetry(
    payload: RawBleTelemetryPayload,
    deviceInfo: { name: string; id: string; rssi?: number }
  ) {
    const nowMs = Date.now();
    let approxLatencyMs = 0;
    if (payload.timestamp && payload.timestamp > 0) {
      approxLatencyMs = Math.max(0, nowMs - payload.timestamp);
    } else if (this.lastPacketArrivalMs) {
      approxLatencyMs = Math.max(0, nowMs - this.lastPacketArrivalMs);
    }
    this.lastPacketArrivalMs = nowMs;

    let packetsLost = this.state.diagnostics.packetsLost;
    const lastSeq = this.state.diagnostics.lastSequenceNumber;
    if (lastSeq !== null && payload.sequenceNumber > lastSeq + 1) {
      packetsLost += payload.sequenceNumber - lastSeq - 1;
    }

    const packetsReceived = this.state.diagnostics.packetsReceived + 1;
    const previousSafetyState = this.state.safetyState;
    const incomingSafetyState = payload.pack.safetyState || 'HEALTHY';

    if (incomingSafetyState !== previousSafetyState) {
      if (incomingSafetyState === 'CRITICAL' || incomingSafetyState === 'WARNING') {
        this.addNotification({
          title: `Battery ${incomingSafetyState} condition`,
          message: `The live BMS reports risk ${Math.round(payload.pack.risk || 0)}%. Review the fault and cell readings.`,
          type: incomingSafetyState === 'CRITICAL' ? 'error' : 'warning',
        });
      } else if (incomingSafetyState === 'HEALTHY' && previousSafetyState !== 'HEALTHY') {
        this.addNotification({
          title: 'Battery condition recovered',
          message: 'The latest live BMS packet reports a healthy condition.',
          type: 'success',
        });
      }
    }

    // Check for alerts / triggers
    const maxTemp = payload.pack.maxTemperature || payload.pack.temperature;
    if (maxTemp > 45 && !this.notifications.some((n) => n.title.includes('High Temperature Warning'))) {
      this.addNotification({
        title: 'High Temperature Warning',
        message: `Pack temp elevated at ${maxTemp}°C. Thermal monitoring active.`,
        type: 'warning',
      });
    }

    // Calculate PINN physics-based dynamic SOH if incoming payload SOH is static default or undefined
    const cycleCount = payload.pack.cycleCount || 428;
    const ir = payload.pack.internalResistance || 1.2;
    const cycleDeg = cycleCount * 0.015;
    const irDeg = Math.max(0, ir - 1.0) * 4.0;
    const tempPen = maxTemp > 40 ? (maxTemp - 40) * 0.5 : 0;
    const computedSoh = +(Math.max(60.0, Math.min(100.0, 100.0 - cycleDeg - irDeg - tempPen))).toFixed(1);
    const activeSoh = (payload.pack.soh && payload.pack.soh !== 96.4) ? payload.pack.soh : computedSoh;

    this.state = {
      ...this.state,
      source: 'LIVE_BLE',
      connectionState: 'CONNECTED',
      deviceName: deviceInfo.name,
      deviceId: deviceInfo.id,
      rssi: deviceInfo.rssi ?? this.state.rssi ?? -62,
      lastUpdated: new Date().toISOString(),

      soc: payload.pack.soc,
      soh: activeSoh,
      voltage: payload.pack.voltage,
      current: payload.pack.current,
      power: payload.pack.power,
      temperature: payload.pack.temperature,
      maxTemperature: payload.pack.maxTemperature || payload.pack.temperature,
      minTemperature: payload.pack.minTemperature || payload.pack.temperature,
      internalResistance: payload.pack.internalResistance || 1.2,
      cycleCount: payload.pack.cycleCount || 428,
      estimatedRange: payload.pack.estimatedRange || Math.round(payload.pack.soc * 4.1),
      risk: payload.pack.risk,
      safetyState: incomingSafetyState,

      ambientTemperature: payload.environment?.ambientTemperature ?? 29.0,
      charging: payload.charging || {
        active: false,
        current: 0,
        power: 0,
        temperature: payload.pack.temperature,
        durationSeconds: 0,
      },

      cells: payload.cells && payload.cells.length > 0
        ? payload.cells.map((c) => ({
            id: c.id,
            voltage: c.voltage,
            temperature: c.temperature,
            deviation: c.deviation || 0,
            risk: c.risk || 0,
            status: c.status || 'HEALTHY',
          }))
        : this.state.cells,

      diagnostics: {
        ...this.state.diagnostics,
        deviceName: deviceInfo.name,
        deviceId: deviceInfo.id,
        rssi: deviceInfo.rssi ?? this.state.rssi ?? -62,
        connectionState: 'CONNECTED',
        notificationsActive: true,
        packetsReceived,
        packetsLost,
        lastSequenceNumber: payload.sequenceNumber,
        lastPacketTimestamp: new Date().toISOString(),
        telemetryFrequencyHz: 1.0,
        approxLatencyMs,
      },
    };

    this.notify();
  }

  /**
   * Set Connection State (Scanning, Connecting, Reconnecting)
   */
  public setConnectionState(
    connState: ConnectionState,
    deviceInfo?: { name?: string; id?: string; rssi?: number }
  ) {
    const prevConn = this.state.connectionState;

    if (connState === 'CONNECTED' && !this.connectionStartTime) {
      this.connectionStartTime = Date.now();
      this.addNotification({
        title: `${deviceInfo?.name || this.state.deviceName || 'BLE Battery'} Connected`,
        message: 'Connected via Bluetooth GATT Service. Live parameters streaming.',
        type: 'success',
      });
    } else if (connState === 'DISCONNECTED' && prevConn === 'CONNECTED') {
      this.connectionStartTime = null;
      this.addNotification({
        title: 'BLE Connection Disconnected',
        message: 'Bluetooth GATT stream closed. 0V Zero State active.',
        type: 'warning',
      });
    }

    const newSource: BatterySourceMode =
      connState === 'CONNECTED'
        ? 'LIVE_BLE'
        : this.state.source === 'LIVE_BLE'
        ? 'LAST_KNOWN'
        : this.state.source;

    const isDisconnected = connState === 'DISCONNECTED';

    this.state = {
      ...this.state,
      source: newSource,
      connectionState: connState,
      deviceName: deviceInfo?.name || this.state.deviceName,
      deviceId: deviceInfo?.id || this.state.deviceId,
      rssi: deviceInfo?.rssi ?? this.state.rssi,
      ...(isDisconnected
        ? {
            soc: 0,
            voltage: 0,
            current: 0,
            power: 0,
            temperature: 0,
            maxTemperature: 0,
            minTemperature: 0,
            estimatedRange: 0,
            risk: 0,
            cells: Array.from({ length: 8 }, (_, i) => ({
              id: i + 1,
              voltage: 0.00,
              temperature: 0.0,
              deviation: 0.00,
              risk: 0,
              status: 'HEALTHY' as HealthStatus,
            })),
          }
        : {}),
      diagnostics: {
        ...this.state.diagnostics,
        connectionState: connState,
        deviceName: deviceInfo?.name || this.state.deviceName,
        deviceId: deviceInfo?.id || this.state.deviceId,
        notificationsActive: connState === 'CONNECTED',
      },
    };

    this.notify();
  }

  /**
   * Explicitly set Demo Mode
   */
  public setDemoMode(active: boolean) {
    this.state = {
      ...this.state,
      source: active ? 'DEMO' : 'LAST_KNOWN',
    };
    this.notify();
  }
}

export const batteryStateService = new BatteryStateService();
export default batteryStateService;
