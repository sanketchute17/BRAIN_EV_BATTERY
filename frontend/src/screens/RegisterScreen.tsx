import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, User, Mail, Lock, Phone, ShieldCheck, Cpu, Edit3, CheckCircle2, Zap, QrCode, Smartphone, Check } from 'lucide-react';
import { apiService } from '../services/api';
import { bluetoothService } from '../services/bluetoothService';
import RealCameraQrScanner from '../components/RealCameraQrScanner';
import scooterBg from '../assets/scooter_bg.jpg';

interface RegisterScreenProps {
  onRegisterComplete: (email?: string) => void;
  onNavigateLogin: () => void;
}

export const RegisterScreen: React.FC<RegisterScreenProps> = ({
  onRegisterComplete,
  onNavigateLogin,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form State tailored for BRAIN proposed system
  const role = 'EV Rider / Owner';
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // EV Vehicle Select & Custom Manual Edit (Focused exclusively on EV Scooters)
  const [evSelect, setEvSelect] = useState('Ather 450X / 450 Apex');
  const [customEvModel, setCustomEvModel] = useState('');
  const [isCustomEv, setIsCustomEv] = useState(false);

  // Battery Chemistry Select & Custom Manual Edit
  const [chemistrySelect, setChemistrySelect] = useState('NMC (Nickel Manganese Cobalt)');
  const [customChemistry, setCustomChemistry] = useState('');
  const [isCustomChemistry, setIsCustomChemistry] = useState(false);

  // QR Pairing State
  const [showQrModal, setShowQrModal] = useState(false);
  const [isQrPaired, setIsQrPaired] = useState(false);
  const [pairedBatteryId, setPairedBatteryId] = useState('');

  const handleScanSuccess = (batteryId: string) => {
    const finalId = batteryId.trim() || 'BATTERY_PACK_01';
    bluetoothService.connectToCloudLaptopBatteryStream(finalId);
    bluetoothService.saveRecentDevice({
      id: finalId,
      name: `Digital Twin Battery (${finalId})`,
      type: 'QR Camera Paired Stream',
    });
    setIsQrPaired(true);
    setPairedBatteryId(finalId);
    setShowQrModal(false);
    setSuccessMsg(`✅ Digital Twin QR Camera Paired (${finalId})! Status: CONNECTED`);
  };

  const handleEvSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'CUSTOM_MANUAL') {
      setIsCustomEv(true);
    } else {
      setIsCustomEv(false);
      setEvSelect(val);
    }
  };

  const handleChemistrySelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'CUSTOM_MANUAL') {
      setIsCustomChemistry(true);
    } else {
      setIsCustomChemistry(false);
      setChemistrySelect(val);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please verify your password entry.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }

    const finalEvModel = isCustomEv ? customEvModel.trim() || 'Custom EV Scooter' : evSelect;
    const finalChemistry = isCustomChemistry ? customChemistry.trim() || 'Custom Lithium Cell' : chemistrySelect;

    setIsSubmitting(true);
    try {
      const res = await apiService.register({
        fullName,
        email,
        mobile,
        password,
        role,
        evModel: finalEvModel,
        batteryChemistry: finalChemistry,
      });

      setSuccessMsg(`Account created successfully! Redirecting to sign in...`);

      setTimeout(() => {
        onRegisterComplete(res.email);
      }, 1600);
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed. Please check your information.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full bg-slate-950 flex items-center justify-center p-0 sm:p-4 selection:bg-emerald-500/20 relative overflow-x-hidden overflow-y-auto">
      
      {/* MOBILE OPTIMIZED CONTAINER FRAME (Width: 100% on mobile, max 360px on desktop) */}
      <div className="w-full min-h-screen sm:w-[360px] sm:min-h-[800px] sm:h-[800px] sm:max-h-[800px] sm:rounded-[42px] relative shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] border-0 sm:border-[8px] sm:border-slate-900 bg-slate-900 text-slate-900 flex flex-col justify-between p-3.5 sm:p-4 z-10 overflow-y-auto shrink-0">
        
        {/* SCOOTER BACKGROUND OVERLAY */}
        <div 
          className="absolute inset-0 z-0 bg-[size:100%_100%] bg-center bg-no-repeat pointer-events-none opacity-30"
          style={{ backgroundImage: `url(${scooterBg})` }}
        />

        {/* Clean Header */}
        <div className="flex items-center gap-2.5 pt-1 pb-2 relative z-10 shrink-0 border-b border-slate-800/80 mb-1">
          <button
            type="button"
            onClick={onNavigateLogin}
            className="p-2 bg-slate-800/90 rounded-xl text-slate-300 hover:text-white transition border border-slate-700 shadow-sm cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-xs sm:text-sm font-black text-white tracking-wider uppercase truncate">OPERATOR REGISTRATION</h2>
            <p className="text-[9px] font-semibold text-emerald-400 truncate">BRAIN — EV Scooter Battery Risk Intelligence</p>
          </div>
        </div>

        {/* Form Card */}
        <div className="relative z-10 my-1 bg-white/95 backdrop-blur-md rounded-3xl p-3.5 sm:p-4 border border-slate-200 shadow-2xl space-y-2.5">
          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-red-600 text-white text-xs font-bold shadow-md">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-600 text-white text-xs font-extrabold shadow-md flex items-center gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-white" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* DIGITAL TWIN QR CODE PAIRING BANNER */}
          <div className="p-3 bg-gradient-to-r from-slate-900 to-emerald-950 rounded-2xl border border-emerald-500/40 text-white space-y-1.5 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-black text-emerald-400">
                <QrCode className="w-4 h-4" />
                <span>Pair Digital Twin Battery</span>
              </div>
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase ${isQrPaired ? 'bg-emerald-500 text-slate-950' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}`}>
                {isQrPaired ? 'PAIRED' : 'SCAN QR'}
              </span>
            </div>

            {isQrPaired ? (
              <div className="text-[10px] font-bold text-emerald-300 flex items-center gap-1.5 bg-emerald-900/50 p-2 rounded-xl border border-emerald-500/30">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Battery Paired: <strong className="font-mono text-white">{pairedBatteryId}</strong></span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <p className="text-[9px] font-semibold text-slate-300 leading-tight">
                  Scan QR from Digital Twin simulation screen to auto-connect battery.
                </p>
                <button
                  type="button"
                  onClick={() => setShowQrModal(true)}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] rounded-xl transition cursor-pointer active:scale-95 shrink-0 uppercase tracking-wider flex items-center gap-1"
                >
                  <QrCode className="w-3 h-3" />
                  <span>Scan QR</span>
                </button>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-2.5">

            {/* 2. FULL NAME */}
            <div>
              <label className="block text-[9px] font-black text-slate-700 uppercase tracking-wider mb-0.5">
                Full Name
              </label>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Sanket Chute"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            {/* 3. EMAIL & MOBILE */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[9px] font-black text-slate-700 uppercase tracking-wider mb-0.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@ev-brain.org"
                    className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-700 uppercase tracking-wider mb-0.5">
                  Mobile Number
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="+91 9876543210"
                    className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>
            </div>

            {/* 4. EV SCOOTER MODEL (STRICTLY EV SCOOTERS ONLY) */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[9px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-3 h-3 text-emerald-600" />
                  <span>EV Scooter Model</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomEv(!isCustomEv)}
                  className="text-[9px] font-extrabold text-emerald-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" />
                  {isCustomEv ? 'Select Preset' : 'Type Custom'}
                </button>
              </div>

              {isCustomEv ? (
                <div className="relative">
                  <Edit3 className="w-3.5 h-3.5 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={customEvModel}
                    onChange={(e) => setCustomEvModel(e.target.value)}
                    placeholder="Type EV scooter model (e.g. Ather 450X, Ola S1 Pro)"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-emerald-400 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              ) : (
                <div className="relative">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    value={evSelect}
                    onChange={handleEvSelectChange}
                    className="w-full pl-9 pr-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                  >
                    <option value="Ather 450X / 450 Apex">Ather 450X / 450 Apex</option>
                    <option value="Ola S1 Pro / S1 Air / S1 X">Ola S1 Pro / S1 Air / S1 X</option>
                    <option value="TVS iQube Electric">TVS iQube Electric</option>
                    <option value="Bajaj Chetak Electric">Bajaj Chetak Electric</option>
                    <option value="Hero Vida V1 Pro">Hero Vida V1 Pro</option>
                    <option value="Simple One EV">Simple One EV</option>
                    <option value="River Indie / Bounce Infinity">River Indie / Bounce Infinity</option>
                    <option value="Ampere Primus / Okinawa Praise">Ampere Primus / Okinawa Praise</option>
                    <option value="Smart BMS Hardware Rig">Smart BMS Rig (Testbed / Prototype)</option>
                    <option value="CUSTOM_MANUAL">✏️ Enter Custom EV Scooter Model...</option>
                  </select>
                </div>
              )}
            </div>

            {/* 5. BATTERY CHEMISTRY */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[9px] font-black text-slate-700 uppercase tracking-wider">
                  Battery Cell Chemistry
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomChemistry(!isCustomChemistry)}
                  className="text-[9px] font-extrabold text-emerald-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" />
                  {isCustomChemistry ? 'Select Preset' : 'Type Custom'}
                </button>
              </div>

              {isCustomChemistry ? (
                <div className="relative">
                  <Edit3 className="w-3.5 h-3.5 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={customChemistry}
                    onChange={(e) => setCustomChemistry(e.target.value)}
                    placeholder="Enter chemistry (e.g. NMC, LFP, LTO)"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-emerald-400 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              ) : (
                <div className="relative">
                  <Cpu className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    value={chemistrySelect}
                    onChange={handleChemistrySelectChange}
                    className="w-full pl-9 pr-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                  >
                    <option value="NMC (Nickel Manganese Cobalt)">NMC (Nickel Manganese Cobalt - High Density)</option>
                    <option value="LFP (Lithium Iron Phosphate)">LFP (Lithium Iron Phosphate - High Safety)</option>
                    <option value="NCA (Nickel Cobalt Aluminum)">NCA (Nickel Cobalt Aluminum Architecture)</option>
                    <option value="Solid State Lithium">Solid State Lithium (Next-Gen Matrix)</option>
                    <option value="CUSTOM_MANUAL">✏️ Type Custom Chemistry Manually...</option>
                  </select>
                </div>
              )}
            </div>

            {/* 6. PASSWORD & CONFIRM */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[9px] font-black text-slate-700 uppercase tracking-wider mb-0.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-700 uppercase tracking-wider mb-0.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-1.5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl transition flex items-center justify-center gap-2 shadow-lg uppercase tracking-wider cursor-pointer active:scale-[0.99]"
            >
              <span>{isSubmitting ? 'CREATING ACCOUNT...' : 'REGISTER OPERATOR ACCOUNT'}</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-center text-xs font-semibold text-slate-400 py-1.5 shrink-0">
          Already registered?{' '}
          <button
            type="button"
            onClick={onNavigateLogin}
            className="text-emerald-400 hover:underline font-extrabold cursor-pointer"
          >
            Sign In
          </button>
        </div>

        {/* REAL CAMERA QR SCANNER MODAL */}
        <RealCameraQrScanner
          isOpen={showQrModal}
          onClose={() => setShowQrModal(false)}
          onScanSuccess={handleScanSuccess}
          defaultBatteryId="BATTERY_PACK_01"
        />
      </div>
    </div>
  );
};

export default RegisterScreen;
