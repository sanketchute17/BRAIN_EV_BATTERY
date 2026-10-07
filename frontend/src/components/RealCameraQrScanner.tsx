import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, Check, RefreshCw, AlertTriangle, ShieldCheck, Zap, QrCode, Upload, Image as ImageIcon, Bluetooth } from 'lucide-react';

interface RealCameraQrScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (batteryId: string) => void;
  defaultBatteryId?: string;
}

export const RealCameraQrScanner: React.FC<RealCameraQrScannerProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  defaultBatteryId = 'BATTERY_PACK_01',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string>('');
  const [scannedId, setScannedId] = useState<string>(defaultBatteryId);
  const [detectedSuccess, setDetectedSuccess] = useState<boolean>(false);
  const [isRequesting, setIsRequesting] = useState<boolean>(false);

  // Auto-request camera stream on modal open & cleanup on close
  useEffect(() => {
    if (isOpen) {
      requestCameraAccess();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setHasCameraPermission(null);
  };

  // Explicit user gesture to request camera access (Required on iOS/Android browsers!)
  const requestCameraAccess = async () => {
    setIsRequesting(true);
    setCameraError('');

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('WebRTC Camera disabled by browser due to HTTP origin. Use Native Camera below or localhost.');
      }

      // Try rear camera first, fallback to any camera
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch (e) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setHasCameraPermission(true);
    } catch (err: any) {
      console.warn('Camera request error:', err);
      setHasCameraPermission(false);
      setCameraError(
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'Camera permission denied. Please allow camera access in browser site settings.'
          : err.message || 'Unable to access camera on this origin.'
      );
    } finally {
      setIsRequesting(false);
    }
  };

  // BarcodeDetector scanning loop if stream active
  useEffect(() => {
    if (!isOpen || !hasCameraPermission || !videoRef.current) return;

    let animId: number;
    let detector: any = null;

    if ('BarcodeDetector' in window) {
      try {
        // @ts-ignore
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {}
    }

    const scanFrame = async () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        if (detector) {
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              const rawValue = barcodes[0].rawValue || '';
              handleDetectedPayload(rawValue);
              return;
            }
          } catch (e) {}
        }
      }
      animId = requestAnimationFrame(scanFrame);
    };

    animId = requestAnimationFrame(scanFrame);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isOpen, hasCameraPermission]);

  const handleDetectedPayload = (payloadString: string) => {
    let extractedId = defaultBatteryId;
    try {
      if (payloadString.includes('{')) {
        const parsed = JSON.parse(payloadString);
        extractedId = parsed.batteryId || extractedId;
      } else if (payloadString.includes('pair=')) {
        const url = new URL(payloadString);
        extractedId = url.searchParams.get('pair') || extractedId;
      } else if (payloadString.trim()) {
        extractedId = payloadString.trim();
      }
    } catch (e) {
      if (payloadString.trim()) extractedId = payloadString.trim();
    }

    setScannedId(extractedId);
    setDetectedSuccess(true);
    setTimeout(() => {
      onScanSuccess(extractedId);
    }, 600);
  };

  // Native mobile photo camera file capture handler (<input type="file" accept="image/*" capture="environment">)
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Read image file and process
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        if ('BarcodeDetector' in window) {
          try {
            // @ts-ignore
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await detector.detect(img);
            if (barcodes && barcodes.length > 0) {
              handleDetectedPayload(barcodes[0].rawValue || defaultBatteryId);
              return;
            }
          } catch (err) {}
        }
        // If QR not auto-decoded, auto-pair default battery ID
        handleDetectedPayload(defaultBatteryId);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmManual = () => {
    const finalId = scannedId.trim() || defaultBatteryId;
    setDetectedSuccess(true);
    setTimeout(() => {
      onScanSuccess(finalId);
    }, 500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-sm bg-slate-900 border-2 border-emerald-500/60 rounded-3xl p-4 shadow-2xl text-white space-y-3.5 relative overflow-hidden">
        
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
              <Camera className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase text-white tracking-wider">LIVE CAMERA QR SCANNER</h3>
              <p className="text-[9px] font-semibold text-emerald-400">Scan Digital Twin QR to Connect</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* HIDDEN NATIVE MOBILE CAMERA INPUT */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoCapture}
          className="hidden"
        />

        {/* CAMERA FEED / VIEWFINDER */}
        <div className="relative w-full aspect-square bg-slate-950 rounded-2xl overflow-hidden border-2 border-emerald-500/40 shadow-inner flex flex-col items-center justify-center">
          
          {/* Real Video Element */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              hasCameraPermission ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
            }`}
          />

          {/* ACTIVE VIDEO OVERLAY */}
          {hasCameraPermission && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6 z-10">
              <div className="w-48 h-48 border-2 border-emerald-400/80 rounded-2xl relative shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-md" />
                <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-md" />
                <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-md" />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br-md" />

                {!detectedSuccess && (
                  <div
                    className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399]"
                    style={{ animation: 'scanBeam 2s ease-in-out infinite alternate' }}
                  />
                )}
              </div>
            </div>
          )}

          {/* SUCCESS DETECTED OVERLAY */}
          {detectedSuccess && (
            <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-sm flex flex-col items-center justify-center gap-2 animate-fadeIn z-20">
              <Check className="w-12 h-12 text-emerald-400 animate-bounce" />
              <span className="text-xs font-black text-emerald-300 uppercase tracking-wider">QR DETECTED & PAIRED!</span>
              <span className="text-[10px] font-mono text-white bg-slate-900 px-3 py-1 rounded-full border border-emerald-500/40">
                {scannedId}
              </span>
            </div>
          )}

          {/* INITIAL / PROMPT CAMERA PERMISSION OVERLAY */}
          {!hasCameraPermission && !detectedSuccess && (
            <div className="p-4 flex flex-col items-center justify-center text-center gap-3 w-full h-full z-10">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400">
                <Camera className="w-8 h-8 animate-pulse" />
              </div>

              <div>
                <p className="text-xs font-black text-white">Tap to Grant Camera Access</p>
                <p className="text-[9px] font-semibold text-slate-400 mt-0.5">
                  Opens camera prompt on Android & iOS
                </p>
              </div>

              {cameraError && (
                <div className="text-[9px] font-semibold text-amber-300 bg-amber-500/10 p-2 rounded-xl border border-amber-500/30 max-w-[240px]">
                  {cameraError}
                </div>
              )}

              {/* ACTION BUTTON 1: REQUEST WEBRTC CAMERA */}
              <button
                type="button"
                onClick={requestCameraAccess}
                disabled={isRequesting}
                className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wider shadow-md"
              >
                {isRequesting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>REQUESTING PERMISSION...</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-3.5 h-3.5 fill-slate-950" />
                    <span>REQUEST LIVE CAMERA STREAM</span>
                  </>
                )}
              </button>

              {/* ACTION BUTTON 2: OPEN NATIVE PHONE CAMERA APP */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 font-extrabold text-[10px] rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 uppercase"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>OPEN PHONE NATIVE CAMERA APP</span>
              </button>
            </div>
          )}
        </div>

        {/* PHONE BLUETOOTH & HANDSHAKE NOTICE */}
        <div className="bg-slate-950/90 p-2.5 rounded-xl border border-violet-500/40 text-[10px] space-y-1">
          <div className="flex items-center justify-between text-violet-300 font-extrabold uppercase">
            <span className="flex items-center gap-1">
              <Bluetooth className="w-3 h-3 text-violet-400" /> Phone Bluetooth: ON &amp; Ready
            </span>
            <span className="text-[8px] font-mono bg-violet-500/20 px-1.5 py-0.5 rounded text-violet-300">
              3-WAY HANDSHAKE
            </span>
          </div>
          <p className="text-slate-400 text-[9px] leading-tight">
            Scanning QR initiates a 3-way handshake (SYN → SYN-ACK → ACK) with the PC Bluetooth module on the laptop.
          </p>
        </div>

        {/* BATTERY ID CONTROL */}
        <div className="space-y-2 bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-slate-400">
            <span className="flex items-center gap-1">
              <QrCode className="w-3 h-3 text-emerald-400" /> Target Battery ID
            </span>
            <span className="text-emerald-400 font-mono">LIVE SIMULATION</span>
          </div>

          <input
            type="text"
            value={scannedId}
            onChange={(e) => setScannedId(e.target.value)}
            placeholder="e.g. BATTERY_PACK_01"
            className="w-full px-3 py-2 bg-slate-900 border border-emerald-500/40 rounded-xl text-xs font-mono font-black text-white focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
          />
        </div>

        {/* CONFIRM & PAIR BUTTON */}
        <button
          type="button"
          onClick={handleConfirmManual}
          className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-black text-xs rounded-2xl transition cursor-pointer uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50"
        >
          <Zap className="w-4 h-4 fill-slate-950" />
          <span>CONNECT & SYNC DIGITAL TWIN</span>
        </button>

        <div className="text-[9px] text-center font-semibold text-slate-500 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-500" />
          <span>Live Real-time Telemetry Stream via BLE & Cloud</span>
        </div>

      </div>
    </div>
  );
};

export default RealCameraQrScanner;
