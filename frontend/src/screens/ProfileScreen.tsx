import React, { useState, useRef } from 'react';
import {
  User,
  Mail,
  Phone,
  Car,
  Cpu,
  Lock,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Key,
  Server,
  Zap,
  Edit3,
  Camera,
  Trash2
} from 'lucide-react';
import { apiService } from '../services/api';

interface ProfileScreenProps {
  currentUser: any;
  isDemoMode?: boolean;
  onLogout: () => void;
  onBackToDashboard: () => void;
  onProfileUpdated?: (updatedUser: any) => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  currentUser,
  isDemoMode = false,
  onLogout,
  onBackToDashboard,
  onProfileUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(currentUser?.full_name || currentUser?.fullName || '');
  const [mobile, setMobile] = useState(currentUser?.mobile || currentUser?.mobileNumber || currentUser?.phone || '');
  const [role, setRole] = useState(currentUser?.role || 'EV Rider / Owner');
  const [evModel, setEvModel] = useState(currentUser?.ev_model || currentUser?.evModel || '');
  const [batteryChemistry, setBatteryChemistry] = useState(currentUser?.battery_chemistry || currentUser?.batteryChemistry || '');
  const [avatarPhoto, setAvatarPhoto] = useState<string>(currentUser?.avatar_photo || '');

  const getPackArchitecture = (modelStr: string) => {
    const m = (modelStr || '').toLowerCase();
    if (m.includes('ola')) {
      return '70V Nominal • 19S Cell Architecture';
    } else if (m.includes('ather')) {
      return '51.1V Nominal • 14S Cell Architecture';
    } else if (m.includes('tvs') || m.includes('iqube')) {
      return '52V Nominal • 14S Cell Architecture';
    } else if (m.includes('bajaj') || m.includes('chetak') || m.includes('vida') || m.includes('hero')) {
      return '50.4V Nominal • 14S Cell Architecture';
    } else if (m.includes('simple')) {
      return '51.2V Nominal • 16S Cell Architecture';
    }
    return '51.2V Nominal • 14S-16S EV Pack Architecture';
  };

  // Keep form inputs updated when currentUser prop finishes loading or updates
  React.useEffect(() => {
    if (currentUser) {
      setFullName(currentUser.full_name || currentUser.fullName || '');
      setMobile(currentUser.mobile || currentUser.mobileNumber || currentUser.phone || '');
      setRole(currentUser.role || 'EV Rider / Owner');
      setEvModel(currentUser.ev_model || currentUser.evModel || '');
      setBatteryChemistry(currentUser.battery_chemistry || currentUser.batteryChemistry || '');
      if (currentUser.avatar_photo) {
        setAvatarPhoto(currentUser.avatar_photo);
      }
    }
  }, [currentUser]);

  // Password reset state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Profile info update state
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const userEmail = currentUser?.email?.toLowerCase().trim();

  // Handle Photo Upload via file input
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setProfileMsg({ type: 'error', text: 'Image size exceeds 5MB limit. Please choose a smaller photo.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Photo = reader.result as string;
      setAvatarPhoto(base64Photo);
      if (userEmail) {
        localStorage.setItem(`brain_avatar_${userEmail}`, base64Photo);
      }
      
      setProfileMsg({ type: 'success', text: 'Profile photo uploaded successfully! Click "Save Profile Changes" to confirm.' });
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setAvatarPhoto('');
    if (userEmail) {
      localStorage.removeItem(`brain_avatar_${userEmail}`);
    }
    localStorage.removeItem('brain_user_avatar');
    setProfileMsg({ type: 'success', text: 'Profile photo removed. Reverted to initials avatar.' });
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);

    if (isDemoMode) {
      setPasswordMsg({ type: 'error', text: 'Password changes disabled in View-Only Demo Mode.' });
      return;
    }

    if (!currentPassword) {
      setPasswordMsg({ type: 'error', text: 'Please enter your current password.' });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'New password must be at least 6 characters long.' });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match. Please verify.' });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      await apiService.updateUserPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordMsg({ type: 'success', text: 'Password updated successfully in Cloud Database!' });
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err.message || 'Failed to update password in database.' });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);

    if (isDemoMode) {
      setProfileMsg({ type: 'error', text: 'Actions locked in View-Only Demo Mode. Please Register or Sign In to save custom profile data.' });
      return;
    }

    const updatedUser = {
      ...currentUser,
      full_name: fullName,
      mobile: mobile,
      role: role,
      ev_model: evModel,
      battery_chemistry: batteryChemistry,
      avatar_photo: avatarPhoto,
    };

    try {
      await apiService.updateUserProfile(updatedUser);
      if (avatarPhoto && userEmail) {
        localStorage.setItem(`brain_avatar_${userEmail}`, avatarPhoto);
      }

      if (onProfileUpdated) {
        onProfileUpdated(updatedUser);
      }

      setProfileMsg({ type: 'success', text: 'Operator profile details & EV specifications saved successfully!' });
    } catch (err: any) {
      setProfileMsg({ type: 'error', text: err.message || 'Failed to sync profile changes.' });
    }
  };

  // Get user initials for profile avatar fallback
  const getInitials = (name: string) => {
    if (!name) return 'OP';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="space-y-4 animate-fadeIn pb-6">
      
      {/* HIDDEN FILE INPUT FOR PHOTO UPLOAD */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handlePhotoSelect}
        accept="image/*"
        className="hidden"
      />

      {/* 1. OPERATOR AVATAR & HEADER CARD */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-5 text-white shadow-xl border border-slate-700/80 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        
        <div className="flex items-center gap-4 relative z-10">
          {/* AVATAR CIRCLE WITH PHOTO UPLOAD TRIGGER */}
          <div className="relative group">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-emerald-600 to-emerald-400 p-1 shadow-lg shrink-0 flex items-center justify-center cursor-pointer relative overflow-hidden transition transform hover:scale-105"
              title="Click to upload profile photo"
            >
              {avatarPhoto ? (
                <img
                  src={avatarPhoto}
                  alt={fullName}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center font-black text-xl sm:text-2xl text-emerald-400 tracking-wider">
                  {getInitials(fullName)}
                </div>
              )}

              {/* CAMERA OVERLAY ON HOVER */}
              <div className="absolute inset-0 bg-slate-950/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-6 h-6 text-white" />
              </div>
            </button>

            {avatarPhoto && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                title="Remove photo"
                className="absolute -bottom-1 -right-1 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full border border-slate-800 shadow-md transition cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* USER IDENTITY DETAILS */}
          <div className="space-y-1 flex-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold text-emerald-300 uppercase tracking-wider">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>{role}</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white truncate tracking-tight">
              {fullName}
            </h2>
            <p className="text-xs text-slate-300 font-mono truncate">
              {currentUser?.email || 'operator@brain-ev.org'}
            </p>
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] font-extrabold text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer pt-0.5"
            >
              <Camera className="w-3 h-3" />
              <span>{avatarPhoto ? 'Change Photo' : 'Upload Profile Photo'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. EV VEHICLE & BATTERY SPECIFICATIONS CARD */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                EV VEHICLE & BATTERY SPECIFICATIONS
              </h3>
              <p className="text-[10px] font-semibold text-slate-400">Registered Platform Configuration</p>
            </div>
          </div>
          <span className="text-[9px] font-mono font-extrabold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            REGISTERED
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
            <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">
              PRIMARY EV SCOOTER / VEHICLE
            </span>
            <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
              <Car className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">{evModel}</span>
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
            <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">
              CELL CHEMISTRY
            </span>
            <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-purple-600 shrink-0" />
              <span className="truncate">{batteryChemistry}</span>
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
            <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">
              NOMINAL PACK ARCHITECTURE
            </span>
            <div className="font-extrabold text-emerald-700 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">{getPackArchitecture(evModel)}</span>
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
            <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">
              BMS FIRMWARE VERSION
            </span>
            <div className="font-mono font-bold text-slate-700 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-slate-500 shrink-0" />
              <span>BRAIN Smart BMS v2.4.1</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. OPERATOR PROFILE EDIT & SPECIFICATIONS FORM */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3.5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
            <Edit3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              OPERATOR ACCOUNT PROFILE & SPECS
            </h3>
            <p className="text-[10px] font-semibold text-slate-400">Update identity, mobile contact & EV configuration</p>
          </div>
        </div>

        {profileMsg && (
          <div
            className={`p-3 rounded-xl text-xs font-bold shadow-sm flex items-center gap-2 ${
              profileMsg.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {profileMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{profileMsg.text}</span>
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-3">
          {/* SYSTEM ROLE */}
          <div>
            <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
              SYSTEM ROLE / USE CASE
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
            >
              <option value="EV Rider / Owner">EV Rider / Owner (Personal Pack Monitoring)</option>
              <option value="Fleet Operations Manager">Fleet Operations Manager (Multi EV Fleet)</option>
              <option value="Battery Researcher / Engineer">Battery Researcher / Engineer (PINN AI & PKL Telemetry)</option>
            </select>
          </div>

          {/* FULL NAME & MOBILE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                FULL NAME
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Sanket Chute"
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                MOBILE NUMBER (SMS ALERTS)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  required
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="+1 (555) 019-2834"
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          </div>

          {/* EV VEHICLE MODEL & CHEMISTRY */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                EV SCOOTER MODEL
              </label>
              <div className="relative">
                <Car className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={evModel}
                  onChange={(e) => setEvModel(e.target.value)}
                  placeholder="e.g. Ather 450X, Ola S1 Pro"
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                BATTERY CELL CHEMISTRY
              </label>
              <div className="relative">
                <Cpu className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={batteryChemistry}
                  onChange={(e) => setBatteryChemistry(e.target.value)}
                  placeholder="NMC (Nickel Manganese Cobalt)"
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm uppercase cursor-pointer"
          >
            <span>SAVE PROFILE CHANGES</span>
          </button>
        </form>
      </div>

      {/* 4. SECURITY & PASSWORD RESET CARD */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3.5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
          <div className="p-2 rounded-xl bg-orange-50 text-orange-600">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              SECURITY & RESET PASSWORD
            </h3>
            <p className="text-[10px] font-semibold text-slate-400">Update account access password</p>
          </div>
        </div>

        {passwordMsg && (
          <div
            className={`p-3 rounded-xl text-xs font-bold shadow-sm flex items-center gap-2 ${
              passwordMsg.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {passwordMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{passwordMsg.text}</span>
          </div>
        )}

        <form onSubmit={handlePasswordReset} className="space-y-3">
          <div>
            <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
              CURRENT PASSWORD
            </label>
            <div className="relative">
              <Key className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full pl-9 pr-2 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                NEW PASSWORD
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-2 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                CONFIRM NEW PASSWORD
              </label>
              <div className="relative">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-2 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isUpdatingPassword}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm uppercase cursor-pointer"
          >
            <Key className="w-3.5 h-3.5" />
            <span>{isUpdatingPassword ? 'SAVING TO DATABASE...' : 'UPDATE PASSWORD IN DATABASE'}</span>
          </button>
        </form>
      </div>

      {/* 5. DATABASE CONNECTION & SIGN OUT */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 text-center">
        <div className="inline-flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1 rounded-full text-[10px] font-mono font-bold text-slate-700">
          <Server className="w-3.5 h-3.5 text-emerald-600" />
          <span>Active Session ID: {currentUser?.id || 'usr_2026'}</span>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-black text-xs sm:text-sm rounded-2xl transition flex items-center justify-center gap-2 shadow-lg uppercase tracking-wider cursor-pointer active:scale-[0.99]"
        >
          <LogOut className="w-4 h-4 stroke-[2.5]" />
          <span>SIGN OUT OF ACCOUNT</span>
        </button>
      </div>
    </div>
  );
};

export default ProfileScreen;
