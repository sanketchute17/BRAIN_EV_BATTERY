from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime

# Auth Schemas
class UserRegister(BaseModel):
    fullName: str
    email: str
    mobile: Optional[str] = None
    password: str
    role: Optional[str] = "EV Rider / Owner"
    evModel: Optional[str] = "Ather 450X"
    batteryChemistry: Optional[str] = "NMC"

class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    full_name: str
    role: Optional[str] = "EV Rider / Owner"
    ev_model: Optional[str] = "Ather 450X"
    battery_chemistry: Optional[str] = "NMC"

# Vehicle & Battery Schemas
class VehicleCreate(BaseModel):
    make: str
    model: str
    variant: Optional[str] = None
    modelYear: Optional[int] = 2024
    vin: Optional[str] = None
    odometer: Optional[float] = 0.0

class BatteryCreate(BaseModel):
    chemistry: str = "NMC"
    capacityKwh: float = 75.0
    serialNumber: str
    bmsModel: str = "BRAIN Smart BMS v2"
    bmsFirmware: str = "v2.4.1"
    cellCount: int = 96

class TelemetryFrame(BaseModel):
    battery_id: str
    pack_voltage: float
    pack_current: float
    pack_temperature: float
    soc: float
    soh: float
    power_kw: float
    data_state: str = "REAL"
    pkl_file_source: Optional[str] = None

class PKLUploadResponse(BaseModel):
    filename: str
    status: str
    file_type: str
    summary: dict

# Bluetooth BLE Schemas
class BLEDeviceConnectPayload(BaseModel):
    device_id: str
    name: str
    mac_address: Optional[str] = "00:11:22:33:FF:EE"
    rssi: Optional[int] = -65
    firmware: Optional[str] = "v2.4.1"

class BLETelemetryPayload(BaseModel):
    battery_id: Optional[str] = "DEFAULT_PACK_96S"
    pack_voltage: float
    pack_current: float
    pack_temperature: float
    soc: float
    soh: Optional[float] = 92.8
    power_kw: Optional[float] = 42.2
    cell_voltages: Optional[List[float]] = []
    bms_status: Optional[str] = "HEALTHY"

class BLEDeviceResponse(BaseModel):
    status: str
    device_id: str
    connected_at: str
    message: str
