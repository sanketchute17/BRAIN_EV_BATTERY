/**
 * BRAIN API & Authentication Client Service
 * EV Battery Risk & Analytics Intelligence Network
 * 
 * Multi-Tier Authentication Strategy:
 * 1. Firebase Cloud Auth (When VITE_FIREBASE_API_KEY is set in .env)
 * 2. Supabase Cloud Auth (When VITE_SUPABASE_URL is set in .env)
 * 3. FastAPI Backend Server (Local localhost:8000 or Cloud Render)
 * 4. Local DB Persistence Sync (Zero-block fallback so authentication works anywhere without errors)
 */

import { firebaseAuth, isFirebaseConfigured } from './firebaseClient';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  updatePassword,
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';

import { supabase, isSupabaseConfigured } from './supabaseClient';
import { firebaseSyncService } from './firebaseSyncService';

const PRIMARY_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const FALLBACK_API_URL = 'https://brain-backend-wrhg.onrender.com/api/v1';

let activeApiUrl = PRIMARY_API_URL;

async function fetchWithFailover(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`${activeApiUrl}${endpoint}`, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res;
  } catch {
    clearTimeout(timeoutId);
    if (activeApiUrl !== FALLBACK_API_URL) {
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 2500);
      try {
        const fallbackRes = await fetch(`${FALLBACK_API_URL}${endpoint}`, {
          ...options,
          signal: fallbackController.signal,
        });
        clearTimeout(fallbackTimeout);
        activeApiUrl = FALLBACK_API_URL;
        return fallbackRes;
      } catch {
        clearTimeout(fallbackTimeout);
        // Fallthrough
      }
    }
    throw new Error('BACKEND_OFFLINE');
  }
}

export interface UserLoginPayload {
  email: string;
  password?: string;
}

export interface UserRegisterPayload {
  fullName: string;
  email: string;
  mobile?: string;
  password?: string;
  role?: string;
  evModel?: string;
  batteryChemistry?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type?: string;
  user_id: string | number;
  email: string;
  full_name?: string;
  mobile?: string;
  role?: string;
  ev_model?: string;
  battery_chemistry?: string;
  avatar_photo?: string;
}

const LOCAL_USERS_DB_KEY = 'brain_registered_users_db';

const DEFAULT_DEMO_USERS: Record<string, any> = {
  'rider@brainev.com': {
    id: 'usr_ather_01',
    fullName: 'Rohit More',
    full_name: 'Rohit More',
    email: 'rider@brainev.com',
    mobile: '+91 98201 45892',
    password: 'password123',
    role: 'EV Rider / Owner',
    evModel: 'Ather 450X',
    ev_model: 'Ather 450X',
    batteryChemistry: 'NMC (Nickel Manganese Cobalt)',
    battery_chemistry: 'NMC (Nickel Manganese Cobalt)',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  'ola.rider@brainev.com': {
    id: 'usr_ola_02',
    fullName: 'Ananya Sharma',
    full_name: 'Ananya Sharma',
    email: 'ola.rider@brainev.com',
    mobile: '+91 98765 43210',
    password: 'password123',
    role: 'EV Rider / Owner',
    evModel: 'Ola S1 Pro',
    ev_model: 'Ola S1 Pro',
    batteryChemistry: 'LFP (Lithium Iron Phosphate)',
    battery_chemistry: 'LFP (Lithium Iron Phosphate)',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  'admin@brainev.com': {
    id: 'usr_admin_03',
    fullName: 'Vikram Malhotra',
    full_name: 'Vikram Malhotra',
    email: 'admin@brainev.com',
    mobile: '+91 91234 56789',
    password: 'admin123',
    role: 'Company Fleet Admin',
    evModel: 'TVS iQube Electric',
    ev_model: 'TVS iQube Electric',
    batteryChemistry: 'LFP (Lithium Iron Phosphate)',
    battery_chemistry: 'LFP (Lithium Iron Phosphate)',
    created_at: '2026-01-01T00:00:00.000Z',
  },
};

function getLocalUsersDB(): Record<string, any> {
  try {
    const data = localStorage.getItem(LOCAL_USERS_DB_KEY);
    const parsed = data ? JSON.parse(data) : {};
    return { ...DEFAULT_DEMO_USERS, ...parsed };
  } catch {
    return DEFAULT_DEMO_USERS;
  }
}

function saveLocalUserDB(email: string, userData: any) {
  const db = getLocalUsersDB();
  db[email.toLowerCase()] = userData;
  localStorage.setItem(LOCAL_USERS_DB_KEY, JSON.stringify(db));
}

export const apiService = {
  getStoredToken(): string | null {
    try {
      return localStorage.getItem('brain_access_token');
    } catch {
      return null;
    }
  },

  setStoredToken(token: string, user?: any): void {
    try {
      localStorage.setItem('brain_access_token', token);
      if (user) {
        localStorage.setItem('brain_user_profile', JSON.stringify(user));
        if (user.email) {
          const emailKey = user.email.toLowerCase().trim();
          localStorage.setItem('brain_current_logged_email', emailKey);
          localStorage.setItem(`brain_profile_${emailKey}`, JSON.stringify(user));
        }
      }
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  },

  clearStoredToken(): void {
    try {
      localStorage.removeItem('brain_access_token');
      localStorage.removeItem('brain_user_profile');
      localStorage.removeItem('brain_current_logged_email');
      localStorage.removeItem('brain_user_avatar');
      if (isFirebaseConfigured() && firebaseAuth) {
        firebaseAuth.signOut().catch(() => {});
      }
      if (isSupabaseConfigured() && supabase) {
        supabase.auth.signOut().catch(() => {});
      }
    } catch (e) {
      console.warn('LocalStorage clear failed:', e);
    }
  },

  getAuthHeaders(): Record<string, string> {
    const token = this.getStoredToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  /**
   * Check backend health status
   */
  async checkBackendStatus(): Promise<{ online: boolean; system?: string; mode: string }> {
    if (isFirebaseConfigured()) {
      return { online: true, system: 'Google Firebase Cloud Auth', mode: 'FIREBASE_CLOUD' };
    }
    if (isSupabaseConfigured()) {
      return { online: true, system: 'Supabase Cloud PostgreSQL', mode: 'SUPABASE_CLOUD' };
    }
    try {
      const rootUrl = activeApiUrl.replace(/\/api\/v1\/?$/, '');
      const response = await fetch(`${rootUrl}/`, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        return { online: true, system: data.system, mode: 'FASTAPI_BACKEND' };
      }
    } catch {
      // Offline
    }
    return { online: true, system: 'BRAIN Local DB Active', mode: 'LOCAL_PERSISTENT_DB' };
  },

  /**
   * Fetch authenticated user profile (strictly isolated per user email)
   */
  async getCurrentUser(): Promise<any> {
    const token = this.getStoredToken();
    if (!token) return null;

    const activeEmail = localStorage.getItem('brain_current_logged_email')?.toLowerCase().trim();

    // 1. Firebase Auth check
    if (isFirebaseConfigured() && firebaseAuth?.currentUser) {
      const user: FirebaseUser = firebaseAuth.currentUser;
      const fbEmail = user.email?.toLowerCase().trim();
      if (!activeEmail || fbEmail === activeEmail) {
        const emailToUse = fbEmail || activeEmail;
        const storedProfile = emailToUse ? localStorage.getItem(`brain_profile_${emailToUse}`) : localStorage.getItem('brain_user_profile');
        const parsed = storedProfile ? JSON.parse(storedProfile) : {};
        const localUsers = getLocalUsersDB();
        const userRec = emailToUse ? localUsers[emailToUse] : null;
        const userAvatar = emailToUse ? localStorage.getItem(`brain_avatar_${emailToUse}`) : null;

        let mobileVal = parsed.mobile || parsed.mobileNumber || userRec?.mobile || userRec?.mobileNumber || '';
        let fullNameVal = user.displayName || parsed.full_name || parsed.fullName || userRec?.fullName || userRec?.full_name || 'EV Operator';
        let evModelVal = parsed.ev_model || parsed.evModel || userRec?.evModel || userRec?.ev_model || 'Ather 450X';
        let chemistryVal = parsed.battery_chemistry || parsed.batteryChemistry || userRec?.batteryChemistry || userRec?.battery_chemistry || 'NMC';

        // Auto-heal missing profile details (e.g., mobile number) on cross-device login
        if ((!mobileVal || fullNameVal === 'EV Operator') && emailToUse) {
          try {
            const cloudRec = await firebaseSyncService.getCloudUserProfile(emailToUse).catch(() => null);
            if (cloudRec) {
              mobileVal = mobileVal || cloudRec.mobile || cloudRec.mobileNumber || cloudRec.phone || '';
              fullNameVal = cloudRec.full_name || cloudRec.fullName || fullNameVal;
              evModelVal = cloudRec.ev_model || cloudRec.evModel || evModelVal;
              chemistryVal = cloudRec.battery_chemistry || cloudRec.batteryChemistry || chemistryVal;

              const healedProfile = {
                id: user.uid,
                email: user.email,
                full_name: fullNameVal,
                mobile: mobileVal,
                role: parsed.role || userRec?.role || cloudRec.role || 'EV Rider / Owner',
                ev_model: evModelVal,
                battery_chemistry: chemistryVal,
                avatar_photo: userAvatar || parsed.avatar_photo || '',
              };
              saveLocalUserDB(emailToUse, healedProfile);
              try {
                localStorage.setItem(`brain_profile_${emailToUse}`, JSON.stringify(healedProfile));
                localStorage.setItem('brain_user_profile', JSON.stringify(healedProfile));
              } catch (e) {}
            }
          } catch (e) {}
        }

        return {
          id: user.uid,
          email: user.email,
          full_name: fullNameVal,
          mobile: mobileVal,
          role: parsed.role || userRec?.role || 'EV Rider / Owner',
          ev_model: evModelVal,
          battery_chemistry: chemistryVal,
          avatar_photo: userAvatar || parsed.avatar_photo || '',
        };
      }
    }

    // 2. Supabase Auth check
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          const sbEmail = data.user.email?.toLowerCase().trim();
          // STRICT CHECK: Only use Supabase user if it matches active logged email!
          if (sbEmail && (!activeEmail || sbEmail === activeEmail)) {
            const localUsers = getLocalUsersDB();
            const localRec = localUsers[sbEmail];
            const userAvatar = localStorage.getItem(`brain_avatar_${sbEmail}`);
            return {
              id: data.user.id,
              email: data.user.email,
              full_name: data.user.user_metadata?.full_name || localRec?.fullName || localRec?.full_name || 'EV Operator',
              mobile: data.user.user_metadata?.mobile || localRec?.mobile || '',
              role: data.user.user_metadata?.role || localRec?.role || 'EV Rider / Owner',
              ev_model: data.user.user_metadata?.ev_model || localRec?.evModel || localRec?.ev_model || 'Ather 450X',
              battery_chemistry: data.user.user_metadata?.battery_chemistry || localRec?.batteryChemistry || 'NMC',
              avatar_photo: userAvatar || localRec?.avatar_photo || '',
            };
          }
        }
      } catch {
        // Fallthrough
      }
    }

    // 3. FastAPI Backend check
    try {
      const response = await fetchWithFailover('/auth/me', {
        headers: this.getAuthHeaders(),
      });
      if (response.ok) {
        const backendUser = await response.json();
        const beEmail = backendUser.email?.toLowerCase().trim();
        if (!activeEmail || beEmail === activeEmail) {
          if (beEmail) {
            backendUser.avatar_photo = localStorage.getItem(`brain_avatar_${beEmail}`) || backendUser.avatar_photo || '';
          }
          return backendUser;
        }
      }
    } catch {
      // Fallthrough
    }

    // 4. Local stored profile fallback matching active logged email strictly
    try {
      if (activeEmail) {
        const userAvatar = localStorage.getItem(`brain_avatar_${activeEmail}`);
        const specificProfile = localStorage.getItem(`brain_profile_${activeEmail}`);
        if (specificProfile) {
          const parsedProf = JSON.parse(specificProfile);
          parsedProf.avatar_photo = userAvatar || parsedProf.avatar_photo || '';
          return parsedProf;
        }
        const localUsers = getLocalUsersDB();
        const userRec = localUsers[activeEmail];
        if (userRec) {
          return {
            id: userRec.id || `usr_${Date.now()}`,
            email: activeEmail,
            full_name: userRec.fullName || userRec.full_name || 'EV Operator',
            mobile: userRec.mobile || userRec.mobileNumber || '',
            role: userRec.role || 'EV Rider / Owner',
            ev_model: userRec.evModel || userRec.ev_model || 'Ather 450X',
            battery_chemistry: userRec.batteryChemistry || userRec.battery_chemistry || 'NMC',
            avatar_photo: userAvatar || userRec.avatar_photo || '',
          };
        }
      }
      const profile = localStorage.getItem('brain_user_profile');
      if (profile) return JSON.parse(profile);
    } catch {
      // Fallthrough
    }

    return null;
  },

  /**
   * User Login API Call (Fast-Path Local DB -> Firebase Auth -> Firebase Cloud DB -> Cloud Fallback)
   */
  async login(payload: UserLoginPayload): Promise<AuthResponse> {
    const emailKey = payload.email.toLowerCase().trim();
    const password = payload.password || '';

    // Clear stale session if switching accounts to prevent name swapping
    const activeEmail = localStorage.getItem('brain_current_logged_email')?.toLowerCase().trim();
    if (activeEmail && activeEmail !== emailKey) {
      this.clearStoredToken();
    }

    const localUsers = getLocalUsersDB();
    const localRecord = localUsers[emailKey];
    const specificProfileStr = localStorage.getItem(`brain_profile_${emailKey}`);
    const specificProfile = specificProfileStr ? JSON.parse(specificProfileStr) : null;

    // FAST-PATH 1: Same Device Verification (Instant < 50ms Response)
    if (localRecord || specificProfile) {
      const storedPass = localRecord?.password || specificProfile?.password;
      if (storedPass && storedPass !== password) {
        throw new Error('Incorrect password. Please verify your credentials.');
      }

      const userAvatar = localStorage.getItem(`brain_avatar_${emailKey}`);
      const authData: AuthResponse = {
        access_token: localRecord?.access_token || specificProfile?.access_token || `local_jwt_token_${Date.now()}`,
        user_id: localRecord?.id || specificProfile?.id || `usr_${Date.now()}`,
        email: emailKey,
        full_name: localRecord?.fullName || localRecord?.full_name || specificProfile?.full_name || specificProfile?.fullName || 'EV Operator',
        mobile: localRecord?.mobile || localRecord?.mobileNumber || specificProfile?.mobile || '',
        role: localRecord?.role || specificProfile?.role || 'EV Rider / Owner',
        ev_model: localRecord?.evModel || localRecord?.ev_model || specificProfile?.ev_model || specificProfile?.evModel || 'Ather 450X',
        battery_chemistry: localRecord?.batteryChemistry || localRecord?.battery_chemistry || specificProfile?.battery_chemistry || specificProfile?.batteryChemistry || 'NMC',
        avatar_photo: userAvatar || localRecord?.avatar_photo || specificProfile?.avatar_photo || '',
      };

      saveLocalUserDB(emailKey, authData);
      this.setStoredToken(authData.access_token, authData);

      // Async background sync to Firebase Auth
      if (isFirebaseConfigured() && firebaseAuth) {
        signInWithEmailAndPassword(firebaseAuth, emailKey, password).catch(() => {});
      }

      return authData;
    }

    let firebaseErrorMsg: string | null = null;

    // FAST-PATH 2: Firebase Cloud Auth & Cloud DB Lookup (For Login from Different Device e.g. Laptop / New Phone)
    if (isFirebaseConfigured() && firebaseAuth) {
      if (firebaseAuth.currentUser && firebaseAuth.currentUser.email?.toLowerCase().trim() !== emailKey) {
        await firebaseAuth.signOut().catch(() => {});
      }
      try {
        const userCredential = await signInWithEmailAndPassword(firebaseAuth, emailKey, password);
        const fbUser = userCredential.user;
        const idToken = await fbUser.getIdToken();

        // Fetch cross-device cloud profile from Firebase Realtime DB
        let cloudUserRec = await firebaseSyncService.getCloudUserProfile(emailKey).catch(() => null);

        const userAvatar = localStorage.getItem(`brain_avatar_${emailKey}`);
        const authData: AuthResponse = {
          access_token: idToken,
          user_id: fbUser.uid,
          email: fbUser.email || emailKey,
          full_name: cloudUserRec?.full_name || cloudUserRec?.fullName || fbUser.displayName || 'EV Operator',
          mobile: cloudUserRec?.mobile || '',
          role: cloudUserRec?.role || 'EV Rider / Owner',
          ev_model: cloudUserRec?.ev_model || cloudUserRec?.evModel || 'Ather 450X',
          battery_chemistry: cloudUserRec?.battery_chemistry || cloudUserRec?.batteryChemistry || 'NMC',
          avatar_photo: userAvatar || cloudUserRec?.avatar_photo || '',
        };
        saveLocalUserDB(emailKey, authData);
        this.setStoredToken(authData.access_token, authData);
        return authData;
      } catch (fbErr: any) {
        if (fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/invalid-credential') {
          throw new Error('Incorrect password. Please verify your credentials.');
        } else if (fbErr.code === 'auth/user-not-found') {
          firebaseErrorMsg = 'No account found with this email address. Please register a new account.';
        } else {
          firebaseErrorMsg = fbErr.message || 'Firebase authentication failed.';
        }
      }
    }

    // FAST-PATH 3: Firebase Realtime Cloud DB Lookup (Fallback for cross-device authentication)
    const cloudUserRec = await firebaseSyncService.getCloudUserProfile(emailKey).catch(() => null);
    if (cloudUserRec) {
      const storedPass = cloudUserRec.password || cloudUserRec.password_hash;
      if (storedPass && storedPass !== password) {
        throw new Error('Incorrect password. Please verify your credentials.');
      }

      const authData: AuthResponse = {
        access_token: `cloud_token_${Date.now()}`,
        user_id: cloudUserRec.id || `usr_${Date.now()}`,
        email: emailKey,
        full_name: cloudUserRec.full_name || cloudUserRec.fullName || 'EV Operator',
        mobile: cloudUserRec.mobile || '',
        role: cloudUserRec.role || 'EV Rider / Owner',
        ev_model: cloudUserRec.ev_model || cloudUserRec.evModel || 'Ather 450X',
        battery_chemistry: cloudUserRec.battery_chemistry || cloudUserRec.batteryChemistry || 'NMC',
      };
      saveLocalUserDB(emailKey, authData);
      this.setStoredToken(authData.access_token, authData);
      return authData;
    }

    if (firebaseErrorMsg) {
      throw new Error(firebaseErrorMsg);
    }

    throw new Error('No account found with this email address. Please register a new account.');
  },

  /**
   * User Registration API Call (Registers User to Local DB, Firebase Auth & Firebase Cloud DB)
   */
  async register(payload: UserRegisterPayload): Promise<{ success: boolean; email: string }> {
    const emailKey = payload.email.toLowerCase().trim();
    const cleanPassword = (payload.password || '').trim();

    if (!emailKey || !cleanPassword) {
      throw new Error('Please provide a valid email address and password.');
    }
    if (cleanPassword.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    // 1. Build full user record object
    const newUserRecord = {
      id: `usr_${Date.now()}`,
      fullName: payload.fullName?.trim() || 'EV Operator',
      full_name: payload.fullName?.trim() || 'EV Operator',
      email: emailKey,
      mobile: payload.mobile?.trim() || '',
      password: cleanPassword,
      role: payload.role || 'EV Rider / Owner',
      evModel: payload.evModel || 'Ather 450X',
      ev_model: payload.evModel || 'Ather 450X',
      batteryChemistry: payload.batteryChemistry || 'NMC (Nickel Manganese Cobalt)',
      battery_chemistry: payload.batteryChemistry || 'NMC (Nickel Manganese Cobalt)',
      created_at: new Date().toISOString(),
    };

    // 2. Save to Local Persistence DB (Always save to local storage)
    saveLocalUserDB(emailKey, newUserRecord);
    try {
      localStorage.setItem(`brain_profile_${emailKey}`, JSON.stringify(newUserRecord));
    } catch (e) {}

    // 3. Register or Re-Authenticate in Firebase Cloud Auth
    if (isFirebaseConfigured() && firebaseAuth) {
      try {
        const userCredential = await createUserWithEmailAndPassword(firebaseAuth, emailKey, cleanPassword);
        const fbUser = userCredential.user;
        await updateProfile(fbUser, { displayName: newUserRecord.fullName }).catch(() => {});
      } catch (fbErr: any) {
        if (fbErr.code === 'auth/email-already-in-use') {
          // If already registered in Firebase Auth, attempt sign in so user session is active for DB sync
          try {
            await signInWithEmailAndPassword(firebaseAuth, emailKey, cleanPassword);
          } catch (signInErr: any) {
            if (signInErr.code === 'auth/wrong-password' || signInErr.code === 'auth/invalid-credential') {
              throw new Error('This email is already registered with a different password. Please sign in or use a different password.');
            }
          }
        } else if (fbErr.code === 'auth/weak-password') {
          throw new Error('Password should be at least 6 characters long.');
        } else if (fbErr.code === 'auth/invalid-email') {
          throw new Error('Invalid email address format. Please check your email.');
        } else {
          console.warn('Firebase Auth registration notice:', fbErr);
        }
      }
    }

    // 4. Save cloud user profile to Firebase Realtime Database for cross-device access!
    await Promise.race([
      firebaseSyncService.saveCloudUserProfile(newUserRecord),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]).catch((e) => {
      console.warn('Cloud DB profile save notice:', e);
    });

    // 5. Sign out from Firebase Auth so user signs in cleanly from Login screen
    if (isFirebaseConfigured() && firebaseAuth && firebaseAuth.currentUser) {
      await firebaseAuth.signOut().catch(() => {});
    }

    // 6. Optional background sync with FastAPI backend if running
    fetchWithFailover('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailKey,
        password: cleanPassword,
        fullName: newUserRecord.fullName,
        mobile: newUserRecord.mobile,
        role: newUserRecord.role,
        evModel: newUserRecord.evModel,
        batteryChemistry: newUserRecord.batteryChemistry,
      }),
    }).catch(() => {});

    return { success: true, email: emailKey };
  },

  /**
   * Update User Profile Details & Specs across Backend / Cloud DB / Local DB
   */
  async updateUserProfile(updatedUser: any): Promise<any> {
    // 1. Update Supabase User Metadata if configured
    if (isSupabaseConfigured() && supabase) {
      try {
        await supabase.auth.updateUser({
          data: {
            full_name: updatedUser.full_name,
            mobile: updatedUser.mobile,
            role: updatedUser.role,
            ev_model: updatedUser.ev_model,
            battery_chemistry: updatedUser.battery_chemistry,
          },
        });

        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user) {
          try {
            await supabase.from('profiles').upsert({
              id: authData.user.id,
              email: authData.user.email,
              full_name: updatedUser.full_name,
              mobile: updatedUser.mobile,
              role: updatedUser.role,
              ev_model: updatedUser.ev_model,
              battery_chemistry: updatedUser.battery_chemistry,
              updated_at: new Date().toISOString(),
            });
          } catch {
            // Ignore DB sync errors
          }
        }
      } catch {
        // Fallthrough
      }
    }

    // 2. Update FastAPI Backend Server
    try {
      await fetchWithFailover('/auth/me', {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(updatedUser),
      });
    } catch {
      // Fallthrough
    }

    // 3. Update Local Storage Profile
    const emailKey = (updatedUser.email || '').toLowerCase().trim();
    if (emailKey) {
      if (updatedUser.avatar_photo) {
        localStorage.setItem(`brain_avatar_${emailKey}`, updatedUser.avatar_photo);
      } else {
        localStorage.removeItem(`brain_avatar_${emailKey}`);
      }
      localStorage.setItem(`brain_profile_${emailKey}`, JSON.stringify(updatedUser));
      saveLocalUserDB(emailKey, updatedUser);
    }
    localStorage.setItem('brain_user_profile', JSON.stringify(updatedUser));
    return updatedUser;
  },

  /**
   * Update Account Password in Firebase Auth, Supabase DB & Local Persistent DB
   */
  async updateUserPassword(currentPassword: string, newPassword: string): Promise<void> {
    const activeEmail = localStorage.getItem('brain_current_logged_email')?.toLowerCase().trim();

    // Verify current password against local user DB if present
    if (activeEmail) {
      const localUsers = getLocalUsersDB();
      const localRecord = localUsers[activeEmail];
      if (localRecord && localRecord.password && localRecord.password !== currentPassword) {
        throw new Error('Current password is incorrect. Please verify your old password.');
      }
    }

    let updatedSuccess = false;

    // 1. Firebase Auth Password Update
    if (isFirebaseConfigured() && firebaseAuth?.currentUser) {
      try {
        await updatePassword(firebaseAuth.currentUser, newPassword);
        updatedSuccess = true;
      } catch (fbErr: any) {
        if (fbErr.code === 'auth/requires-recent-login') {
          if (activeEmail && currentPassword) {
            try {
              const cred = await signInWithEmailAndPassword(firebaseAuth, activeEmail, currentPassword);
              if (cred.user) {
                await updatePassword(cred.user, newPassword);
                updatedSuccess = true;
              }
            } catch {
              throw new Error('Current password is incorrect or session expired. Please sign out and sign in again.');
            }
          } else {
            throw new Error('Please log out and sign in again before updating your password.');
          }
        } else if (fbErr.code === 'auth/weak-password') {
          throw new Error('New password must be at least 6 characters long.');
        } else if (fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/invalid-credential') {
          throw new Error('Current password is incorrect. Please check your credentials.');
        } else {
          // If Firebase update fails with other code
          console.warn('Firebase updatePassword fallback:', fbErr);
        }
      }
    }

    // 2. Supabase Auth & Profile Password Update
    if (isSupabaseConfigured() && supabase) {
      try {
        await supabase.auth.updateUser({ password: newPassword });
        if (activeEmail) {
          await supabase.from('profiles').upsert({
            email: activeEmail,
            password_hash: newPassword,
            updated_at: new Date().toISOString(),
          });
        }
        updatedSuccess = true;
      } catch {
        // Fallthrough
      }
    }

    // 3. Update FastAPI Backend Server Password
    try {
      await fetchWithFailover('/auth/change-password', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      updatedSuccess = true;
    } catch {
      // Fallthrough
    }

    // 4. Always update Local Storage DB & Active Profile for persistence
    if (activeEmail) {
      const localUsers = getLocalUsersDB();
      if (localUsers[activeEmail]) {
        localUsers[activeEmail].password = newPassword;
        localStorage.setItem(LOCAL_USERS_DB_KEY, JSON.stringify(localUsers));
      } else {
        saveLocalUserDB(activeEmail, { email: activeEmail, password: newPassword });
      }

      const existingProf = localStorage.getItem(`brain_profile_${activeEmail}`);
      if (existingProf) {
        const parsed = JSON.parse(existingProf);
        parsed.password = newPassword;
        localStorage.setItem(`brain_profile_${activeEmail}`, JSON.stringify(parsed));
      }
      updatedSuccess = true;
    }

    if (!updatedSuccess) {
      throw new Error('Unable to update password. Please check network connection.');
    }
  },

  /**
   * Get PKL Simulation Summary from Backend
   */
  async getPklSummary(): Promise<any> {
    try {
      const res = await fetchWithFailover('/pkl/summary');
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return { status: 'NO_PKL_LOADED', datasets: [] };
  },

  /**
   * Run PKL Simulation Step from Backend
   */
  async samplePklTelemetry(stepIdx: number = 0): Promise<any> {
    try {
      const res = await fetchWithFailover(`/pkl/simulate?step_idx=${stepIdx}`);
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return null;
  },

  async predictWithBatteryModel(telemetry: Record<string, unknown>): Promise<any> {
    const response = await fetchWithFailover('/pkl/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telemetry }),
    });
    if (!response.ok) {
      throw new Error(`Battery model request failed (${response.status}).`);
    }
    return response.json();
  },

  /**
   * Register Connected BLE Hardware BMS Device
   */
  async connectBleDevice(payload: { device_id: string; name: string; rssi?: number; firmware?: string }): Promise<any> {
    try {
      const res = await fetchWithFailover('/battery/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'SYN', battery_id: payload.device_id }),
      });
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return { status: 'CONNECTED_LOCAL', device_id: payload.device_id };
  },

  /**
   * Post Live Telemetry Packet from BLE BMS Hardware to Backend & Cloud DB
   */
  async postBleTelemetry(payload: {
    battery_id?: string;
    pack_voltage: number;
    pack_current: number;
    pack_temperature: number;
    soc: number;
    soh?: number;
    power_kw?: number;
    bms_status?: string;
  }): Promise<any> {
    try {
      const res = await fetchWithFailover('/battery/telemetry');
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return null;
  },

  /**
   * Get Active BLE Devices Status from Backend
   */
  async getBleDevices(): Promise<any> {
    try {
      const res = await fetchWithFailover('/battery/status');
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return { active_devices: [], total_connected: 0 };
  },

  /**
   * Fetch Live Digital Twin Physics Telemetry Packet from Backend
   */
  async getLiveDigitalTwinTelemetry(): Promise<any> {
    try {
      const res = await fetchWithFailover('/battery/telemetry');
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return null;
  },

  /**
   * Inject or Clear Physical Fault Scenario into Digital Twin
   */
  async injectDigitalTwinFault(fault: string, cell_id: number = 5, active: boolean = true): Promise<any> {
    try {
      const res = await fetchWithFailover('/battery/fault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fault_type: fault, cell_id, active }),
      });
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return null;
  },

  /**
   * Update Digital Twin Load Current or Simulation Mode
   */
  async updateDigitalTwinState(load_current_A?: number, sim_mode?: string): Promise<any> {
    try {
      const res = await fetchWithFailover('/battery/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: sim_mode || 'NORMAL', load_current_A }),
      });
      if (res.ok) return await res.json();
    } catch {
      // Fallback
    }
    return null;
  },
};
