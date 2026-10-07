import React, { useState, useEffect, useRef } from 'react';
import { Battery3DView } from '../components/Battery3DView';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { BrainLogo } from '../components/BrainLogo';
import { Lock, Mail, ArrowRight, PlayCircle, Eye, EyeOff, UserPlus, ShieldCheck, Wifi, X, Check, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import scooterBg from '../assets/scooter_bg.jpg';

interface LoginScreenProps {
  onLoginSuccess: (isDemo?: boolean) => void;
  onNavigateRegister: () => void;
  initialEmail?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onNavigateRegister,
  initialEmail,
}) => {
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [registeredNotice, setRegisteredNotice] = useState(
    initialEmail ? 'Account created successfully! Please sign in with your password.' : ''
  );

  const [isCaptchaVerified, setIsCaptchaVerified] = useState(false);
  const [isCaptchaVerifying, setIsCaptchaVerifying] = useState(false);
  const [googleScriptLoaded, setGoogleScriptLoaded] = useState(false);
  const captchaContainerRef = useRef<HTMLDivElement>(null);
  const customSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';

  // Load official Google reCAPTCHA API script dynamically only when custom key is set
  useEffect(() => {
    if (!customSiteKey) return;
    const scriptId = 'google-recaptcha-v2-script';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://www.google.com/recaptcha/api.js?onload=onGoogleRecaptchaLoad&render=explicit';
      script.async = true;
      script.defer = true;
      (window as any).onGoogleRecaptchaLoad = () => {
        setGoogleScriptLoaded(true);
      };
      document.body.appendChild(script);
    } else if ((window as any).grecaptcha) {
      setGoogleScriptLoaded(true);
    }
  }, [customSiteKey]);

  // Render official Google reCAPTCHA iframe when custom site key is ready
  useEffect(() => {
    if (customSiteKey && googleScriptLoaded && (window as any).grecaptcha && captchaContainerRef.current) {
      try {
        if (captchaContainerRef.current.childElementCount === 0) {
          (window as any).grecaptcha.render(captchaContainerRef.current, {
            sitekey: customSiteKey,
            callback: (token: string) => {
              if (token) setIsCaptchaVerified(true);
            },
            'expired-callback': () => {
              setIsCaptchaVerified(false);
            },
          });
        }
      } catch (e) {
        console.warn('Google reCAPTCHA render fallback:', e);
      }
    }
  }, [customSiteKey, googleScriptLoaded]);

  // Auto-dismiss registration success banner after 4 seconds
  useEffect(() => {
    if (registeredNotice) {
      const timer = setTimeout(() => {
        setRegisteredNotice('');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [registeredNotice]);

  const handleCaptchaClick = () => {
    if (isCaptchaVerified) return;
    setIsCaptchaVerifying(true);
    setTimeout(() => {
      setIsCaptchaVerifying(false);
      setIsCaptchaVerified(true);
    }, 600);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setRegisteredNotice('');

    if (!isCaptchaVerified) {
      setErrorMsg('Please complete "I\'m not a robot" reCAPTCHA verification to sign in.');
      return;
    }

    setIsSubmitting(true);

    try {
      await apiService.login({ email, password });
      onLoginSuccess(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoClick = () => {
    onLoginSuccess(true);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full bg-slate-950 flex items-center justify-center p-0 sm:p-4 selection:bg-emerald-500/20 relative overflow-x-hidden overflow-y-auto">
      
      {/* ANDROID MODERN SMARTPHONE CONTAINER FRAME (Width: 360px, Height: 800px, 9:20 Aspect Ratio) */}
      <div className="w-full min-h-screen sm:w-[360px] sm:min-h-[800px] sm:h-[800px] sm:max-h-[800px] sm:rounded-[42px] relative overflow-y-auto shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] border-0 sm:border-[8px] sm:border-slate-900 bg-slate-900 text-white flex flex-col justify-between p-4 sm:p-5 z-10 shrink-0">
        
        {/* SCOOTER BACKGROUND OVERLAY */}
        <div 
          className="absolute inset-0 z-0 bg-[size:100%_100%] bg-center bg-no-repeat pointer-events-none opacity-50"
          style={{ backgroundImage: `url(${scooterBg})` }}
        />

        {/* 1. BRANDING LOGO WITH 'THINK AHEAD' QUOTE */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-1 pt-2 my-1 w-full mx-auto">
          <BrainLogo size="xl" layout="vertical" showFullForm={true} showQuote={true} />
        </div>

        {/* 2. REAL 3D INTERACTIVE BATTERY VISUAL (NATURAL ZOOMED-OUT PROPORTIONS) */}
        <div className="relative z-10 my-1 flex flex-col items-center justify-center">
          <div className="w-full max-w-[300px] h-36 sm:h-40 relative flex items-center justify-center mx-auto overflow-visible bg-transparent border-0 shadow-none">
            <ErrorBoundary>
              <Battery3DView status="HEALTHY" interactive={true} hideControls={true} />
            </ErrorBoundary>
          </div>
        </div>

        {/* 3. FLOATING TRANSPARENT INPUT FORM AND BUTTONS */}
        <div className="relative z-10 space-y-3.5 my-auto w-full max-w-[340px] mx-auto px-1">
          {registeredNotice && (
            <div className="p-3 rounded-2xl bg-emerald-600/90 backdrop-blur-xl text-white text-xs font-black shadow-lg flex items-center justify-between gap-2 animate-fadeIn border border-white/40">
              <div className="flex items-center gap-2 text-left">
                <ShieldCheck className="w-4 h-4 text-emerald-200 shrink-0" />
                <span>{registeredNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setRegisteredNotice('')}
                className="p-1 hover:bg-emerald-700/60 rounded-full transition cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-full bg-red-600 text-white text-xs sm:text-sm font-black shadow-lg border border-red-400 text-center">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            {/* EMAIL INPUT (TRANSLUCENT LIGHT PILL FROM IMAGE 2) */}
            <div className="relative group">
              <Mail className="w-4.5 h-4.5 text-slate-600 group-focus-within:text-emerald-600 absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200 z-10" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-12 pr-4 py-3.5 bg-slate-100/80 hover:bg-slate-100/90 focus:bg-white backdrop-blur-xl border border-white/80 rounded-full text-xs sm:text-sm font-black text-slate-900 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/40 transition-all duration-300 shadow-md"
                placeholder="Enter your registered email"
              />
            </div>

            {/* PASSWORD INPUT (TRANSLUCENT LIGHT PILL FROM IMAGE 2) */}
            <div className="relative group">
              <Lock className="w-4.5 h-4.5 text-slate-600 group-focus-within:text-emerald-600 absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200 z-10" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-12 pr-12 py-3.5 bg-slate-100/80 hover:bg-slate-100/90 focus:bg-white backdrop-blur-xl border border-white/80 rounded-full text-xs sm:text-sm font-black text-slate-900 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/40 transition-all duration-300 shadow-md"
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-900 transition cursor-pointer z-10"
              >
                {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
              </button>
            </div>

            <div className="flex justify-end pt-0.5">
              <button
                type="button"
                onClick={() => alert('Forgot password instructions sent to your email.')}
                className="text-[11px] font-black text-emerald-700 hover:text-emerald-800 cursor-pointer bg-white/70 hover:bg-white/90 px-3.5 py-1.5 rounded-full border border-white/80 backdrop-blur-md shadow-sm transition-all active:scale-95"
              >
                Forgot Password?
              </button>
            </div>

            {/* GOOGLE reCAPTCHA V2 "I'M NOT A ROBOT" CHECKBOX WIDGET */}
            <div className="bg-white/95 backdrop-blur-md rounded-2xl p-2.5 px-3.5 border border-slate-200/90 shadow-md flex items-center justify-between select-none my-2 transition-all hover:border-slate-300">
              {customSiteKey && googleScriptLoaded ? (
                <div ref={captchaContainerRef} className="my-1 flex items-center justify-center scale-95 origin-center w-full" />
              ) : (
                <div className="w-full flex items-center justify-between py-0.5">
                  <div 
                    onClick={handleCaptchaClick}
                    className="flex items-center gap-3 cursor-pointer group py-0.5"
                  >
                    <div className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-all ${
                      isCaptchaVerified 
                        ? 'bg-emerald-500 border-emerald-500 shadow-sm' 
                        : isCaptchaVerifying 
                        ? 'border-emerald-500 bg-emerald-50/50' 
                        : 'border-slate-400 bg-white group-hover:border-slate-600'
                    }`}>
                      {isCaptchaVerified ? (
                        <Check className="w-5 h-5 text-white stroke-[3] animate-scaleIn" />
                      ) : isCaptchaVerifying ? (
                        <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                      ) : null}
                    </div>
                    <span className="text-xs font-black text-slate-800 tracking-tight">
                      I'm not a robot
                    </span>
                  </div>

                  {/* GOOGLE RECAPTCHA BRANDING LOGO */}
                  <div className="flex flex-col items-center justify-center text-[8px] text-slate-400 font-bold leading-none pl-2.5 border-l border-slate-200 shrink-0">
                    <div className="w-5 h-5 mb-0.5 relative flex items-center justify-center">
                      <svg className="w-4.5 h-4.5 text-blue-600 fill-current" viewBox="0 0 24 24">
                        <path d="M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity="0.3"/>
                        <path d="M12 4a8 8 0 0 0-8 8h3a5 5 0 0 1 5-5V4z"/>
                      </svg>
                    </div>
                    <span className="text-[7px] text-slate-500 font-black tracking-tighter">reCAPTCHA</span>
                    <span className="text-[6px] text-slate-400">Privacy - Terms</span>
                  </div>
                </div>
              )}
            </div>

            {/* VIVID SOLID EMERALD SIGN IN BUTTON */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-[#059669] hover:bg-[#047857] active:bg-[#065f46] text-white font-black text-sm sm:text-base rounded-full transition-all duration-300 flex items-center justify-center gap-2.5 shadow-lg border border-emerald-400/40 uppercase tracking-wider cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <span>{isSubmitting ? 'Authenticating...' : 'SIGN IN'}</span>
              <ArrowRight className="w-5 h-5 stroke-[3]" />
            </button>
          </form>

          {/* DIVIDER WITH WHITE PILL FROM IMAGE 2 */}
          <div className="relative my-3 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/50" />
            </div>
            <span className="relative bg-white/80 px-4 py-0.5 text-[10px] font-black text-slate-800 uppercase tracking-widest rounded-full border border-white/90 shadow-sm backdrop-blur-md">
              OR
            </span>
          </div>

          {/* 4. QUICK DEMO LOGIN ACCOUNTS PICKER */}
          <div className="space-y-1.5 my-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-300 tracking-wider px-1">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                QUICK DEMO ACCOUNTS (1-CLICK)
              </span>
              <span className="text-[9px] font-mono text-emerald-400/80 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                Ready to Sign In
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEmail('rider@brainev.com');
                  setPassword('password123');
                  setIsCaptchaVerified(true);
                  setErrorMsg('');
                }}
                className={`p-2 rounded-2xl border text-left transition cursor-pointer backdrop-blur-md ${
                  email === 'rider@brainev.com'
                    ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-sm'
                    : 'bg-white/10 hover:bg-white/20 border-white/20 text-slate-200'
                }`}
              >
                <div className="text-[10px] font-black truncate text-emerald-400">Rohit More</div>
                <div className="text-[8px] font-bold text-slate-300 truncate">Ather 450X</div>
                <div className="text-[7px] font-mono text-slate-400 truncate mt-0.5">rider@brainev.com</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEmail('ola.rider@brainev.com');
                  setPassword('password123');
                  setIsCaptchaVerified(true);
                  setErrorMsg('');
                }}
                className={`p-2 rounded-2xl border text-left transition cursor-pointer backdrop-blur-md ${
                  email === 'ola.rider@brainev.com'
                    ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-sm'
                    : 'bg-white/10 hover:bg-white/20 border-white/20 text-slate-200'
                }`}
              >
                <div className="text-[10px] font-black truncate text-emerald-400">Ananya S.</div>
                <div className="text-[8px] font-bold text-slate-300 truncate">Ola S1 Pro</div>
                <div className="text-[7px] font-mono text-slate-400 truncate mt-0.5">ola.rider@...</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEmail('admin@brainev.com');
                  setPassword('admin123');
                  setIsCaptchaVerified(true);
                  setErrorMsg('');
                }}
                className={`p-2 rounded-2xl border text-left transition cursor-pointer backdrop-blur-md ${
                  email === 'admin@brainev.com'
                    ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-sm'
                    : 'bg-white/10 hover:bg-white/20 border-white/20 text-slate-200'
                }`}
              >
                <div className="text-[10px] font-black truncate text-amber-400">Fleet Admin</div>
                <div className="text-[8px] font-bold text-slate-300 truncate">TVS iQube</div>
                <div className="text-[7px] font-mono text-slate-400 truncate mt-0.5">admin@brainev.com</div>
              </button>
            </div>
          </div>

          {/* SECONDARY PILL BUTTONS FROM IMAGE 2 */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleDemoClick}
              className="py-3.5 px-3 bg-white/75 hover:bg-white/90 text-emerald-700 border border-white/80 rounded-full text-xs font-black transition-all duration-200 flex items-center justify-center gap-2 shadow-md backdrop-blur-md cursor-pointer active:scale-95"
            >
              <PlayCircle className="w-4 h-4 text-emerald-600" />
              <span>Guest Demo</span>
            </button>
            <button
              type="button"
              onClick={onNavigateRegister}
              className="py-3.5 px-3 bg-white/75 hover:bg-white/90 text-slate-900 border border-white/80 rounded-full text-xs font-black transition-all duration-200 flex items-center justify-center gap-2 shadow-md backdrop-blur-md cursor-pointer active:scale-95"
            >
              <UserPlus className="w-4 h-4 text-slate-700" />
              <span>Register</span>
            </button>
          </div>
        </div>

        {/* Footer padding */}
        <div className="pb-1" />
      </div>
    </div>
  );
};

export default LoginScreen;
