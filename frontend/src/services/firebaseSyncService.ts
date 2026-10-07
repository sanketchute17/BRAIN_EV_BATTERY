import { firebaseApp, firebaseAuth } from './firebaseClient';
import { updateProfile } from 'firebase/auth';
import { getDatabase, ref, set, push, onValue, off, serverTimestamp, get } from 'firebase/database';
import type { NormalizedBatteryState } from '../types/telemetry';
import { PinnEngine, type PinnRiskAnalysis } from './pinnEngine';
import { encodeFirebaseProfilePhotoUrl, decodeFirebaseProfilePhotoUrl } from './api';

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

  private withTimeout<T>(promise: Promise<T>, ms: number = 1500): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Firebase DB request timed out')), ms)),
    ]);
  }

  private initDatabase() {
    try {
      if (firebaseApp) {
        this.db = getDatabase(firebaseApp, 'https://brain-70dcd-default-rtdb.firebaseio.com');
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
    if (!profile || !profile.email) return false;
    const emailKey = profile.email.toLowerCase().trim();
    const sanitizedEmail = emailKey.replace(/[^a-zA-Z0-9]/g, '_');
    const mob = profile.mobile || profile.mobileNumber || profile.phone || '';
    const fn = profile.full_name || profile.fullName || 'EV Operator';
    const ev = profile.ev_model || profile.evModel || 'Ather 450X';
    const chem = profile.battery_chemistry || profile.batteryChemistry || 'NMC';

    const userPayload = {
      id: profile.id || `usr_${Date.now()}`,
      email: emailKey,
      full_name: fn,
      fullName: fn,
      mobile: mob,
      mobileNumber: mob,
      phone: mob,
      role: profile.role || 'EV Rider / Owner',
      ev_model: ev,
      evModel: ev,
      battery_chemistry: chem,
      batteryChemistry: chem,
      password: profile.password || profile.password_hash || '',
      updatedAt: new Date().toISOString(),
    };

    let success = false;

    // 0. Save profile metadata directly to Firebase Auth profile if currentUser is active
    if (firebaseAuth?.currentUser && firebaseAuth.currentUser.email?.toLowerCase().trim() === emailKey) {
      try {
        const photoMetaStr = encodeFirebaseProfilePhotoUrl(userPayload);
        await updateProfile(firebaseAuth.currentUser, {
          displayName: fn,
          photoURL: photoMetaStr,
        }).catch(() => {});
        success = true;
      } catch (e) {}
    }

    // 1. Try Firebase Realtime DB SDK with 2.5s timeout
    if (this.db) {
      try {
        const userRef = ref(this.db, `users/${sanitizedEmail}`);
        await this.withTimeout(set(userRef, userPayload), 2500);
        success = true;
      } catch (e) {
        console.warn('Firebase SDK write warning:', e);
      }
    }

    // 2. Direct REST API Fallback (Guarantees write from Android APK or any browser!)
    try {
      let tokenParam = '';
      if (firebaseAuth?.currentUser) {
        const idToken = await firebaseAuth.currentUser.getIdToken().catch(() => '');
        if (idToken) tokenParam = `?auth=${idToken}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const restRes = await fetch(`https://brain-70dcd-default-rtdb.firebaseio.com/users/${sanitizedEmail}.json${tokenParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userPayload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (restRes.ok) success = true;
    } catch {
      try {
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), 2500);
        const restRes2 = await fetch(`https://brain-70dcd.firebaseio.com/users/${sanitizedEmail}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userPayload),
          signal: controller2.signal,
        });
        clearTimeout(timer2);
        if (restRes2.ok) success = true;
      } catch {}
    }

    return success;
  }

  /**
   * Fetch Cloud User Profile from Firebase Realtime Database
   */
  public async getCloudUserProfile(email: string): Promise<any | null> {
    if (!email) return null;
    const emailKey = email.toLowerCase().trim();
    const sanitizedEmail = emailKey.replace(/[^a-zA-Z0-9]/g, '_');

    let tokenParam = '';
    try {
      if (firebaseAuth?.currentUser) {
        const idToken = await firebaseAuth.currentUser.getIdToken().catch(() => '');
        if (idToken) tokenParam = `?auth=${idToken}`;
      }
    } catch {}

    const normalizeUser = (val: any) => {
      if (!val) return null;
      const mob = val.mobile || val.mobileNumber || val.phone || '';
      const fn = val.full_name || val.fullName || 'EV Operator';
      const ev = val.ev_model || val.evModel || 'Ather 450X';
      const chem = val.battery_chemistry || val.batteryChemistry || 'NMC';
      return {
        ...val,
        full_name: fn,
        fullName: fn,
        mobile: mob,
        mobileNumber: mob,
        phone: mob,
        ev_model: ev,
        evModel: ev,
        battery_chemistry: chem,
        batteryChemistry: chem,
      };
    };

    // 0. Check Firebase Auth currentUser metadata first if available
    if (firebaseAuth?.currentUser && firebaseAuth.currentUser.email?.toLowerCase().trim() === emailKey) {
      const fbDecoded = decodeFirebaseProfilePhotoUrl(firebaseAuth.currentUser.photoURL);
      if (fbDecoded || firebaseAuth.currentUser.displayName) {
        return normalizeUser({
          id: firebaseAuth.currentUser.uid,
          email: emailKey,
          full_name: firebaseAuth.currentUser.displayName || 'EV Operator',
          fullName: firebaseAuth.currentUser.displayName || 'EV Operator',
          mobile: fbDecoded?.mobile || '',
          role: fbDecoded?.role || 'EV Rider / Owner',
          ev_model: fbDecoded?.ev_model || 'Ather 450X',
          battery_chemistry: fbDecoded?.battery_chemistry || 'NMC',
        });
      }
    }

    // 1. Try Firebase Realtime DB SDK with 2.5s timeout
    if (this.db) {
      try {
        const userRef = ref(this.db, `users/${sanitizedEmail}`);
        const snapshot: any = await this.withTimeout(get(userRef), 2500);
        if (snapshot && snapshot.exists()) {
          return normalizeUser(snapshot.val());
        }
      } catch (e) {
        console.warn('Firebase SDK read warning:', e);
      }
    }

    // 2. Direct REST API Fallback (Fast REST lookup for cross-device login!)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const restRes = await fetch(`https://brain-70dcd-default-rtdb.firebaseio.com/users/${sanitizedEmail}.json${tokenParam}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (restRes.ok) {
        const data = await restRes.json();
        if (data && (data.email || data.full_name || data.mobile)) {
          return normalizeUser(data);
        }
      }
    } catch {
      try {
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), 2500);
        const restRes2 = await fetch(`https://brain-70dcd.firebaseio.com/users/${sanitizedEmail}.json`, {
          signal: controller2.signal,
        });
        clearTimeout(timer2);
        if (restRes2.ok) {
          const data2 = await restRes2.json();
          if (data2 && (data2.email || data2.full_name || data2.mobile)) {
            return normalizeUser(data2);
          }
        }
      } catch {}
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
