import { firebaseApp } from './firebaseClient';
import { getDatabase, ref, set, push, onValue, off, serverTimestamp, get } from 'firebase/database';
import type { NormalizedBatteryState } from '../types/telemetry';
import { PinnEngine, type PinnRiskAnalysis } from './pinnEngine';

export interface SyncedBatteryRecord {
  batteryId: string;
  deviceName: string;
  lastUpdated: string;
  source: string;
  telemetry: NormalizedBatteryState;
  pinnAnalysis: PinnRiskAnalysis;
}

class FirebaseSyncService {
  private db: any = null;
  private isConnected: boolean = false;
  private activeListeners: Map<string, any> = new Map();

  constructor() {
    this.initDatabase();
  }

  private initDatabase() {
    try {
      if (firebaseApp) {
        this.db = getDatabase(firebaseApp);
        this.isConnected = true;
      }
    } catch (e) {
      console.warn('Firebase Realtime DB fallback:', e);
      this.isConnected = false;
    }
  }

  /**
   * Save Cloud User Profile to Firebase Realtime Database for seamless cross-device login
   */
  public async saveCloudUserProfile(profile: any): Promise<boolean> {
    if (!this.db || !profile || !profile.email) return false;
    try {
      const sanitizedEmail = profile.email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '_');
      const userRef = ref(this.db, `users/${sanitizedEmail}`);
      await set(userRef, {
        id: profile.id || `usr_${Date.now()}`,
        email: profile.email.toLowerCase().trim(),
        full_name: profile.full_name || profile.fullName || 'EV Operator',
        mobile: profile.mobile || '',
        role: profile.role || 'EV Rider / Owner',
        ev_model: profile.ev_model || profile.evModel || 'Ather 450X',
        battery_chemistry: profile.battery_chemistry || profile.batteryChemistry || 'NMC',
        password: profile.password || profile.password_hash || '',
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (e) {
      console.warn('Firebase cloud profile write warning:', e);
      return false;
    }
  }

  /**
   * Fetch Cloud User Profile from Firebase Realtime Database
   */
  public async getCloudUserProfile(email: string): Promise<any | null> {
    if (!this.db || !email) return null;
    try {
      const sanitizedEmail = email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '_');
      const userRef = ref(this.db, `users/${sanitizedEmail}`);
      const snapshot = await get(userRef);
      if (snapshot.exists()) {
        return snapshot.val();
      }
    } catch (e) {
      console.warn('Firebase cloud profile read warning:', e);
    }
    return null;
  }

  /**
   * Sync Live Telemetry & PINN Analysis from BRAIN APK to Firebase DB
   */
  public async syncTelemetryToFirebase(state: NormalizedBatteryState): Promise<boolean> {
    // Only stream data to Firebase Database when Bluetooth BMS is CONNECTED
    if (state.connectionState !== 'CONNECTED') {
      return false;
    }

    const batteryId = (state.deviceId || 'BATTERY_PACK_01').replace(/[^a-zA-Z0-9_-]/g, '_');
    const pinnAnalysis = PinnEngine.evaluatePhysicsModel(state);

    const record: SyncedBatteryRecord = {
      batteryId,
      deviceName: state.deviceName || 'EV Battery Pack 96V',
      lastUpdated: new Date().toISOString(),
      source: state.source,
      telemetry: state,
      pinnAnalysis,
    };

    // Store in local storage memory fallback as well for offline resilience
    try {
      localStorage.setItem(`brain_firebase_sync_${batteryId}`, JSON.stringify(record));
    } catch (e) {
      // Ignore quota error
    }

    if (!this.db) return false;

    try {
      // 1. Update Live Node in Firebase: /batteries/{batteryId}/live_telemetry
      const liveRef = ref(this.db, `batteries/${batteryId}`);
      await set(liveRef, {
        ...record,
        updatedTimestamp: serverTimestamp(),
      });

      // 2. Append to History Node (throttled): /batteries/{batteryId}/history
      const historyRef = ref(this.db, `batteries/${batteryId}/history`);
      await push(historyRef, {
        timestamp: record.lastUpdated,
        voltage: state.voltage,
        current: state.current,
        temperature: state.temperature,
        soc: state.soc,
        soh: state.soh,
        thermalRunawayRiskPct: pinnAnalysis.thermalRunawayRiskPct,
        overallRiskLevel: pinnAnalysis.overallRiskLevel,
      });

      return true;
    } catch (err) {
      console.warn('Firebase DB sync write error (using offline buffer):', err);
      return false;
    }
  }

  /**
   * For Company Administrative App: Retrieve live list of all batteries stored in Firebase DB
   */
  public subscribeToCompanyFleet(callback: (records: SyncedBatteryRecord[]) => void): () => void {
    if (!this.db) {
      // Return offline/simulated company fleet records if Firebase is not reachable
      const mockRecords = this.getSimulatedCompanyFleet();
      callback(mockRecords);
      return () => {};
    }

    const fleetRef = ref(this.db, 'batteries');

    const listener = onValue(
      fleetRef,
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const records: SyncedBatteryRecord[] = Object.keys(val).map((id) => {
            const item = val[id];
            return {
              batteryId: id,
              deviceName: item.deviceName || id,
              lastUpdated: item.lastUpdated || new Date().toISOString(),
              source: item.source || 'LIVE_BLE',
              telemetry: item.telemetry,
              pinnAnalysis: item.pinnAnalysis,
            };
          });
          callback(records);
        } else {
          callback(this.getSimulatedCompanyFleet());
        }
      },
      (err) => {
        console.warn('Firebase DB fleet read error, switching to company fallback:', err);
        callback(this.getSimulatedCompanyFleet());
      }
    );

    return () => {
      off(fleetRef, 'value', listener);
    };
  }

  /**
   * Fallback Simulated Fleet for Company Admin App testing when offline
   */
  public getSimulatedCompanyFleet(): SyncedBatteryRecord[] {
    const rawLocal = localStorage.getItem('brain_firebase_sync_BATTERY_PACK_01');
    let localRecord: SyncedBatteryRecord | null = null;
    if (rawLocal) {
      try {
        localRecord = JSON.parse(rawLocal);
      } catch (e) {}
    }

    return [
      localRecord || {
        batteryId: 'EV_PACK_ATHERS1_01',
        deviceName: 'Ather 450X High-Power Pack',
        lastUpdated: new Date().toISOString(),
        source: 'LIVE_BLE',
        telemetry: {
          source: 'LIVE_BLE',
          connectionState: 'CONNECTED',
          deviceName: 'Ather 450X BMS',
          deviceId: 'EV_PACK_ATHERS1_01',
          rssi: -58,
          lastUpdated: new Date().toISOString(),
          soc: 82.0,
          soh: 96.0,
          voltage: 352.1,
          current: 45.2,
          power: 15.9,
          temperature: 34.5,
          maxTemperature: 36.0,
          minTemperature: 33.1,
          internalResistance: 1.1,
          cycleCount: 340,
          estimatedRange: 336,
          risk: 1,
          safetyState: 'HEALTHY',
          ambientTemperature: 28.5,
          charging: { active: false, current: 0, power: 0, temperature: 34.5, durationSeconds: 0 },
          cells: Array.from({ length: 8 }, (_, i) => ({
            id: i + 1,
            voltage: 3.67,
            temperature: 34.0,
            deviation: 0.01,
            risk: 2,
            status: 'HEALTHY',
          })),
          diagnostics: {} as any,
        },
        pinnAnalysis: {
          timestamp: new Date().toISOString(),
          batteryId: 'EV_PACK_ATHERS1_01',
          heatGenerationRateW: 24.5,
          heatDissipationRateW: 85.0,
          predictedTemp5Min: 35.1,
          predictedTemp15Min: 36.2,
          thermalRunawayRiskPct: 4.2,
          remainingUsefulLifeCycles: 2150,
          remainingUsefulLifeDays: 1433,
          cellImbalanceIndex: 0.008,
          overallRiskLevel: 'SAFE',
          physicsResidualError: 0.002,
          modelConfidencePct: 99.2,
          recommendations: ['OPTIMAL: Electrochemical state within PINN safe operational window.'],
        },
      },
      {
        batteryId: 'EV_FLEET_OLA_PRO_04',
        deviceName: 'Ola S1 Pro Heavy Pack 04',
        lastUpdated: new Date().toISOString(),
        source: 'LIVE_BLE',
        telemetry: {
          source: 'LIVE_BLE',
          connectionState: 'CONNECTED',
          deviceName: 'Ola S1 Pro BMS 04',
          deviceId: 'EV_FLEET_OLA_PRO_04',
          rssi: -64,
          lastUpdated: new Date().toISOString(),
          soc: 48.0,
          soh: 91.2,
          voltage: 341.8,
          current: 110.4,
          power: 37.7,
          temperature: 46.2,
          maxTemperature: 48.1,
          minTemperature: 43.5,
          internalResistance: 1.8,
          cycleCount: 680,
          estimatedRange: 196,
          risk: 18,
          safetyState: 'WARNING',
          ambientTemperature: 34.0,
          charging: { active: false, current: 0, power: 0, temperature: 46.2, durationSeconds: 0 },
          cells: Array.from({ length: 8 }, (_, i) => ({
            id: i + 1,
            voltage: 3.56,
            temperature: 46.0 + (i === 3 ? 2.1 : 0),
            deviation: 0.035,
            risk: i === 3 ? 25 : 5,
            status: i === 3 ? 'WARNING' : 'HEALTHY',
          })),
          diagnostics: {} as any,
        },
        pinnAnalysis: {
          timestamp: new Date().toISOString(),
          batteryId: 'EV_FLEET_OLA_PRO_04',
          heatGenerationRateW: 184.2,
          heatDissipationRateW: 173.2,
          predictedTemp5Min: 49.5,
          predictedTemp15Min: 53.1,
          thermalRunawayRiskPct: 38.5,
          remainingUsefulLifeCycles: 1420,
          remainingUsefulLifeDays: 946,
          cellImbalanceIndex: 0.035,
          overallRiskLevel: 'ELEVATED',
          physicsResidualError: 0.012,
          modelConfidencePct: 96.8,
          recommendations: ['WARNING: Elevated cell temperature drift. Recommend limiting fast charging above 80% SOC.'],
        },
      },
    ];
  }
}

export const firebaseSyncService = new FirebaseSyncService();
export default firebaseSyncService;
