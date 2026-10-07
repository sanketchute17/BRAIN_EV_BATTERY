import React, { useState, useEffect } from 'react';
import { Bluetooth, Radio, Wifi, CheckCircle2, AlertCircle, X, Cpu, Loader2, Signal, Clock, RefreshCw, QrCode, Link, Smartphone, Camera, ChevronDown, ChevronUp } from 'lucide-react';
import { bluetoothService } from '../services/bluetoothService';
import { batteryStateService } from '../services/batteryStateService';
import RealCameraQrScanner from './RealCameraQrScanner';

interface BluetoothPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BluetoothPairingModal: React.FC<BluetoothPairingModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [recentDevices, setRecentDevices] = useState<Array<{ id: string; name: string; type: string; lastConnected: string; rssi: number }>>([]);
  const [scannedDiscoveredDevices, setScannedDiscoveredDevices] = useState<Array<{ id: string; name: string; type: string; rssi: number }>>([]);
  const [qrBatteryId, setQrBatteryId] = useState('BATTERY_PACK_01');
  const [isQrConnecting, setIsQrConnecting] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);

  const handleCameraScanSuccess = (scannedBatteryId: string) => {
    setShowCameraScanner(false);
    const id = scannedBatteryId.trim() || 'BATTERY_PACK_01';
    setQrBatteryId(id);
    bluetoothService.connectToCloudLaptopBatteryStream(id);
    bluetoothService.saveRecentDevice({
      id,
      name: `Laptop Digital Twin (${id})`,
      type: '3-Way Handshake (QR Camera)',
    });
    setStatusMsg(`Battery ID selected. Waiting for ${id} to start its LAN Bluetooth-style broadcast.`);
    refreshState();
  };

  const refreshState = () => {
    setBluetoothEnabled(bluetoothService.isBluetoothEnabled());
    setRecentDevices(bluetoothService.getRecentDevices());
    const broadcasts = bluetoothService.getActiveBleBroadcasts();
    if (broadcasts.length > 0) {
      setScannedDiscoveredDevices(broadcasts);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const state = bluetoothService.getState();
      setBluetoothEnabled(state.connected || bluetoothService.isBluetoothEnabled());
      refreshState();

      try {
        const urlParams = new URLSearchParams(window.location.search);
        const pairId = urlParams.get('pair');
        if (pairId) {
          setQrBatteryId(decodeURIComponent(pairId));
        }
      } catch (e) {}

      window.addEventListener('ble_broadcast_changed', refreshState);
      window.addEventListener('storage', refreshState);
      const unsubscribeBluetooth = bluetoothService.subscribe(refreshState);
      const unsubscribeBattery = batteryStateService.subscribe(refreshState);
      return () => {
        window.removeEventListener('ble_broadcast_changed', refreshState);
        window.removeEventListener('storage', refreshState);
        unsubscribeBluetooth();
        unsubscribeBattery();
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnectCloudLaptop = async () => {
    setIsScanning(true);
    setErrorMsg('');
    setStatusMsg('Listening for the Digital Twin on the Brain backend LAN WebSocket...');

    await bluetoothService.connectToCloudLaptopBatteryStream(qrBatteryId || 'BATTERY_PACK_01');
    setStatusMsg('Receiver armed. Turn Bluetooth ON in the Digital Twin to start the Wi-Fi packet bridge.');
    refreshState();
    setIsScanning(false);
  };

  const handleScanWebBluetooth = async () => {
    setIsScanning(true);
    setErrorMsg('');
    setStatusMsg('Scanning for physical BLE hardware...');

    try {
      await bluetoothService.requestAndConnectDevice();
      setStatusMsg('Bluetooth BMS Successfully Paired!');
      refreshState();
      setTimeout(() => onClose(), 700);
    } catch (err: any) {
      bluetoothService.startSimulatedBleConnectionWithName('BRAIN Virtual Battery Simulation (8S LFP)', 'BRAIN-SIM-8S');
      bluetoothService.saveRecentDevice({ id: 'BRAIN-SIM-8S', name: 'BRAIN Virtual Battery Simulation (8S LFP)', type: 'Virtual BLE' });
      setStatusMsg('Connected to BRAIN Virtual Battery Simulation (8S LFP)!');
      refreshState();
      setTimeout(() => onClose(), 700);
    } finally {
      setIsScanning(false);
    }
  };

  const handleDisconnect = () => {
    bluetoothService.setBluetoothEnabled(false);
    setBluetoothEnabled(false);
    setStatusMsg('Bluetooth BMS Disconnected.');
    refreshState();
  };

  const handleBluetoothToggle = async () => {
    if (bluetoothEnabled) {
      handleDisconnect();
      return;
    }

    setBluetoothEnabled(true);
    setStatusMsg('Receiver enabled. Start the Digital Twin Bluetooth/LAN broadcast to connect and stream live data.');
    setErrorMsg('');

    try {
      await bluetoothService.connectToCloudLaptopBatteryStream(qrBatteryId || 'BATTERY_PACK_01');
      setStatusMsg('Bluetooth enabled and connected to Digital Twin!');
      refreshState();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Bluetooth connection failed.');
      setBluetoothEnabled(false);
      bluetoothService.setBluetoothEnabled(false);
    }
  };

  const bleState = bluetoothService.getState();

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-2xl space-y-3.5 text-slate-900 overflow-hidden relative max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 shadow-2xs">
              <Bluetooth className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">
                BLUETOOTH-STYLE BMS LINK
              </h3>
              <p className="text-[10px] font-bold text-slate-400">
                Digital Twin packets over shared Wi-Fi / LAN
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Connection Status Banner */}
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-bold shrink-0 ${
            bleState.connected
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-slate-100 border-slate-200 text-slate-600'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                bleState.connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
            <div className="min-w-0">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">STATUS</div>
              <div className="text-xs font-black break-words leading-tight">
                {bleState.connected ? bleState.deviceName || 'CONNECTED (3-WAY HANDSHAKE)' : 'DISCONNECTED'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleBluetoothToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${bluetoothEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
              aria-label={bluetoothEnabled ? 'Disable Bluetooth' : 'Enable Bluetooth'}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${bluetoothEnabled ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </button>
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-600">
              {bluetoothEnabled ? 'LINK ON' : 'LINK OFF'}
            </span>
            {bleState.connected && (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 font-black text-[10px] rounded-xl transition uppercase cursor-pointer shrink-0 ml-2"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        {statusMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black flex items-center gap-2 animate-fadeIn shrink-0">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{statusMsg}</span>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] font-bold text-slate-600 shrink-0">
          <div className="flex items-center justify-between">
            <span>Digital Twin broadcast</span>
            <span className={`px-2 py-1 rounded-full text-[10px] ${bluetoothEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
              {bleState.connected ? 'Connected' : bluetoothEnabled ? 'Waiting for Twin' : 'Not sending'}
            </span>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            {bluetoothEnabled
              ? 'The Brain receiver is listening. Enable the Digital Twin bridge to complete the network handshake and deliver live telemetry.'
              : 'Enable the receiver here, then switch the Digital Twin bridge ON. Packets travel over Wi-Fi and are displayed as Bluetooth-style connectivity.'}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto space-y-3.5 pr-1 flex-1">

          {/* METHOD 1: SCAN QR CODE WITH CAMERA */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-950 via-slate-900 to-violet-900 border border-violet-500/40 text-white space-y-2.5 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-violet-400" />
                <span className="text-xs font-black uppercase tracking-wider text-violet-200">
                  METHOD 1: SCAN QR CODE
                </span>
              </div>
              <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                RECOMMENDED
              </span>
            </div>

            <p className="text-[11px] font-semibold text-violet-200/80 leading-snug">
              Point your phone camera at the QR code shown on the laptop Digital Twin.
            </p>

            <button
              type="button"
              onClick={() => setShowCameraScanner(true)}
              className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wider shadow-lg active:scale-98"
            >
              <Camera className="w-4 h-4 fill-slate-950" />
              <span>OPEN CAMERA QR SCANNER</span>
            </button>
          </div>

          {/* METHOD 2: 1-CLICK CONNECT TO LAPTOP */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-900 border border-emerald-500/40 text-white space-y-2.5 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-black uppercase tracking-wider text-emerald-200">
                  METHOD 2: 1-CLICK LAPTOP CONNECT
                </span>
              </div>
              <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                FAST
              </span>
            </div>

            <p className="text-[11px] font-semibold text-emerald-200/80 leading-snug">
              Wait for the Digital Twin to initiate the <span className="text-emerald-300 font-bold">SYN → SYN-ACK → ACK</span> handshake and stream packets over your shared network.
            </p>

            <button
              onClick={handleConnectCloudLaptop}
              disabled={isScanning}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wider shadow-lg active:scale-98 disabled:opacity-50"
            >
              {isScanning ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <Wifi className="w-4 h-4 text-slate-950" />
              )}
              <span>START BRAIN RECEIVER</span>
            </button>
          </div>

          {/* ADVANCED / MANUAL PAIRING TOGGLE */}
          <div className="pt-1">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition flex items-center justify-between cursor-pointer"
            >
              <span>ADVANCED PAIRING & BLE HARDWARE</span>
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 animate-fadeIn">
                {/* Manual Battery ID Input */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase text-slate-500">
                    Manual Battery ID Pairing
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={qrBatteryId}
                      onChange={(e) => setQrBatteryId(e.target.value)}
                      placeholder="e.g. BATTERY_PACK_01"
                      className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={handleConnectCloudLaptop}
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-xl transition"
                    >
                      PAIR
                    </button>
                  </div>
                </div>

                {/* Scan Web Bluetooth Hardware */}
                <div className="pt-2 border-t border-slate-200">
                  <button
                    onClick={handleScanWebBluetooth}
                    disabled={isScanning}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 font-black text-xs rounded-xl transition flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>SCAN PHYSICAL BLE HARDWARE</span>
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 text-center shrink-0">
          <p className="text-[9px] font-bold text-slate-400">
            Wi-Fi / LAN packet bridge styled as Bluetooth • Live 5 Hz telemetry
          </p>
        </div>

        {/* REAL CAMERA QR SCANNER */}
        <RealCameraQrScanner
          isOpen={showCameraScanner}
          onClose={() => setShowCameraScanner(false)}
          onScanSuccess={handleCameraScanSuccess}
          defaultBatteryId={qrBatteryId || 'BATTERY_PACK_01'}
        />
      </div>
    </div>
  );
};

export default BluetoothPairingModal;
