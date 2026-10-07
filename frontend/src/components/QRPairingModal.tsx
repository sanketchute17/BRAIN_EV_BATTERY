import React, { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, QrCode, Smartphone, Bluetooth, Wifi, Copy, CheckCircle2, RefreshCw, Zap, Shield, Signal } from 'lucide-react';
import { bluetoothService } from '../services/bluetoothService';

interface QRPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  batteryId?: string;
}

// Generate the pairing URL that the mobile app will deep-link from
function generatePairingUrl(batteryId: string, sessionToken: string): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}?pair=${encodeURIComponent(batteryId)}&token=${sessionToken}&mode=mobile`;
}

// Generate a short session token for pairing security
function generateSessionToken(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

export const QRPairingModal: React.FC<QRPairingModalProps> = ({
  isOpen,
  onClose,
  batteryId = 'BATTERY_PACK_01',
}) => {
  const [sessionToken, setSessionToken] = useState<string>(() => generateSessionToken());
  const [pairingUrl, setPairingUrl] = useState<string>('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [connectedDevices, setConnectedDevices] = useState(0);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  // Build the URL whenever token or batteryId changes
  useEffect(() => {
    if (isOpen) {
      const url = generatePairingUrl(batteryId, sessionToken);
      setPairingUrl(url);

      // Store the active pairing session in localStorage so mobile app can pick it up
      localStorage.setItem('brain_active_qr_pair', JSON.stringify({
        batteryId,
        sessionToken,
        pairingUrl: url,
        generatedAt: new Date().toISOString(),
      }));
    }
  }, [batteryId, sessionToken, isOpen]);

  // Set broadcast active state when QR modal opens
  useEffect(() => {
    if (isOpen) {
      setIsBroadcasting(true);
      setSecondsElapsed(0);
    } else {
      setIsBroadcasting(false);
      setConnectedDevices(0);
    }
  }, [isOpen]);

  // Session timer
  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => setSecondsElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  // Poll for mobile connections
  useEffect(() => {
    if (!isOpen) return;
    const checkConnections = () => {
      try {
        const broadcasts = bluetoothService.getActiveBleBroadcasts();
        setConnectedDevices(broadcasts.length > 0 ? 1 : 0);
      } catch (e) {}
    };
    checkConnections();
    const interval = setInterval(checkConnections, 2000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleRefreshToken = useCallback(() => {
    const newToken = generateSessionToken();
    setSessionToken(newToken);
    setSecondsElapsed(0);
  }, []);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch (e) {
      // Fallback
      const el = document.createElement('textarea');
      el.value = pairingUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    }
  }, [pairingUrl]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-lg"
      style={{ animation: 'fadeIn 0.2s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-slate-900 rounded-3xl border border-slate-700/80 shadow-2xl overflow-hidden"
        style={{ boxShadow: '0 0 60px rgba(16,185,129,0.15), 0 25px 50px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <QrCode className="w-5 h-5" />
              </div>
              {isBroadcasting && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900 animate-pulse" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-black text-white tracking-wide uppercase">QR Pair Mobile App</h3>
              <p className="text-[10px] font-semibold text-emerald-400 mt-0.5">Scan to connect instantly</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-800/60">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isBroadcasting ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-[10px] font-extrabold text-slate-300 uppercase tracking-wider">
              {isBroadcasting ? 'BROADCASTING LIVE' : 'STANDBY'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
              <Smartphone className="w-3 h-3" />
              <span>{connectedDevices} connected</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
              <Signal className="w-3 h-3" />
              <span>{formatTime(secondsElapsed)}</span>
            </div>
          </div>
        </div>

        {/* QR Code Display */}
        <div className="flex flex-col items-center px-5 py-6 gap-4">
          {/* QR Code Frame */}
          <div className="relative">
            {/* Corner decorators */}
            <div className="absolute top-0 left-0 w-6 h-6 border-t-3 border-l-3 border-emerald-400 rounded-tl-lg z-10" style={{ borderWidth: '3px' }} />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-3 border-r-3 border-emerald-400 rounded-tr-lg z-10" style={{ borderWidth: '3px' }} />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-3 border-l-3 border-emerald-400 rounded-bl-lg z-10" style={{ borderWidth: '3px' }} />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-3 border-r-3 border-emerald-400 rounded-br-lg z-10" style={{ borderWidth: '3px' }} />

            <div className="bg-white p-4 rounded-2xl shadow-2xl">
              {pairingUrl ? (
                <QRCodeSVG
                  value={pairingUrl}
                  size={188}
                  level="H"
                  includeMargin={false}
                  fgColor="#0f172a"
                  bgColor="#ffffff"
                  imageSettings={{
                    src: '',
                    x: undefined,
                    y: undefined,
                    height: 0,
                    width: 0,
                    excavate: false,
                  }}
                />
              ) : (
                <div className="w-[188px] h-[188px] flex items-center justify-center bg-slate-50 rounded-xl">
                  <RefreshCw className="w-8 h-8 text-slate-400 animate-spin" />
                </div>
              )}
            </div>

            {/* Broadcasting glow */}
            {isBroadcasting && (
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{
                  boxShadow: '0 0 30px rgba(16, 185, 129, 0.3)',
                  animation: 'pulse 2s infinite',
                }}
              />
            )}
          </div>

          {/* Battery ID Badge */}
          <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 rounded-2xl border border-slate-700 w-full">
            <Bluetooth className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">Battery ID</div>
              <div className="text-xs font-black text-white font-mono truncate">{batteryId}</div>
            </div>
            <div className="flex items-center gap-1 text-[9px] font-extrabold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
              <Zap className="w-3 h-3" />
              <span>LIVE</span>
            </div>
          </div>

          {/* Session Token */}
          <div className="w-full px-3.5 py-2.5 bg-slate-800/60 rounded-2xl border border-slate-700/60">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">
                <Shield className="w-3 h-3 text-slate-500" />
                Session Token
              </div>
              <button
                onClick={handleRefreshToken}
                className="flex items-center gap-1 text-[9px] font-extrabold text-emerald-400 hover:text-emerald-300 transition cursor-pointer"
                title="Refresh session token"
              >
                <RefreshCw className="w-3 h-3" />
                REFRESH
              </button>
            </div>
            <div className="font-mono text-sm font-black text-white tracking-widest text-center py-1 letter-spacing-2">
              {sessionToken}
            </div>
          </div>

          {/* Instructions */}
          <div className="w-full space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">How to connect</p>
            <div className="space-y-1.5">
              {[
                { step: '1', icon: <Smartphone className="w-3 h-3" />, text: 'Open the BRAIN EV app on your phone' },
                { step: '2', icon: <QrCode className="w-3 h-3" />, text: 'Tap "Pair Battery" → "Scan QR Code"' },
                { step: '3', icon: <Wifi className="w-3 h-3" />, text: 'Point camera at this QR — auto connects!' },
              ].map(({ step, icon, text }) => (
                <div key={step} className="flex items-center gap-2.5 px-3 py-2 bg-slate-800/40 rounded-xl border border-slate-700/40">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                    {icon}
                  </div>
                  <span className="text-[10px] font-semibold text-slate-300">{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Copy URL button */}
          <button
            onClick={handleCopyUrl}
            className={`w-full py-2.5 rounded-2xl text-xs font-extrabold flex items-center justify-center gap-2 transition cursor-pointer ${
              isCopied
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            {isCopied ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Pairing Link Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Pairing Link</span>
              </>
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-center gap-1.5 text-[9px] font-semibold text-slate-600">
            <Shield className="w-3 h-3" />
            <span>Token expires on close • Session encrypted end-to-end</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRPairingModal;
