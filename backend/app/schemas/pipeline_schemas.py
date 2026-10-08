"""
pipeline_schemas.py — Pydantic v2 Request/Response Schemas for Cloud Pipeline
==============================================================================
BRAIN – Battery Risk & Analytics Intelligence Network

Categories:
  A. Battery Registry (metadata)
  B. Raw Telemetry (ingestion & query)
  C. Cell Telemetry (child of raw)
  D. Analytics / Predictions (derived)
  E. Fault Events
  F. Battery Events
  G. Battery Sessions
  H. Ingestion API (single + batch)
  I. Query & Aggregation API responses
  J. WebSocket stream envelope
"""

from pydantic import BaseModel, Field, model_validator, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime


# ─────────────────────────────────────────────────────────────────────────────
# A. BATTERY REGISTRY
# ─────────────────────────────────────────────────────────────────────────────

class BatteryMetadataCreate(BaseModel):
    battery_id:        str   = Field(..., examples=["BRAIN001"])
    vehicle_id:        Optional[str]   = None
    manufacturer:      Optional[str]   = "Custom"
    model:             Optional[str]   = "BRAIN EV Pack"
    chemistry:         str             = Field("LFP", examples=["LFP", "NMC", "NCA"])
    cell_count:        int             = 16
    nominal_voltage_V: float           = 51.2
    capacity_Ah:       float           = 100.0
    bms_model:         Optional[str]   = "BRAIN BMS v2"
    firmware_version:  Optional[str]   = "v2.4.1"
    manufacture_date:  Optional[datetime] = None
    installation_date: Optional[datetime] = None
    status:            Optional[str]   = "ACTIVE"
    organization_id:   Optional[str]   = None
    fleet_id:          Optional[str]   = None

class BatteryMetadataResponse(BatteryMetadataCreate):
    model_config = ConfigDict(from_attributes=True)
    id:         str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ─────────────────────────────────────────────────────────────────────────────
# B. CANONICAL RAW TELEMETRY PACKET (what the Digital Twin sends)
# ─────────────────────────────────────────────────────────────────────────────

class PackData(BaseModel):
    voltage_V: float
    current_A: float
    power_W:   Optional[float] = None

class ThermalData(BaseModel):
    min_temperature_C:     Optional[float] = None
    max_temperature_C:     Optional[float] = None
    average_temperature_C: Optional[float] = None

class CellData(BaseModel):
    cell_id:       Optional[int]   = None   # preferred field name
    id:            Optional[int]   = None   # legacy field name from twin_service
    voltage_V:     Optional[float] = None
    temperature_C: Optional[float] = None
    resistance_ohm:Optional[float] = None
    soc:           Optional[float] = None

    @model_validator(mode="after")
    def normalise_cell_id(self) -> "CellData":
        # Accept either 'cell_id' (new) or 'id' (legacy twin output)
        if self.cell_id is None and self.id is not None:
            self.cell_id = self.id
        return self

class BatteryStateData(BaseModel):
    cycle_number:  Optional[int]   = None
    capacity_Ah:   Optional[float] = None
    resistance_ohm:Optional[float] = None

class CoolingData(BaseModel):
    status:         Optional[str]   = "OK"
    flow_rate_LPM:  Optional[float] = None

class FaultsData(BaseModel):
    status: Optional[str]       = "NORMAL"
    active: Optional[List[str]] = []

class CanonicalTelemetryPacket(BaseModel):
    """
    The single authoritative telemetry structure.
    Both the Digital Twin and physical BMS bridge must conform to this schema.
    schema_version defaults to '1.0'.
    """
    model_config = ConfigDict(extra="allow")

    battery_id:     str   = Field(..., examples=["BRAIN001"])
    vehicle_id:     Optional[str]  = None
    timestamp:      str   = Field(..., description="ISO-8601 UTC timestamp")
    sequence:       int   = Field(..., description="Monotone incrementing counter for gap detection")
    source:         str   = Field("digital_twin",
                                  description="digital_twin | physical_bms | dataset | manual_test")
    schema_version: str   = Field("1.0")

    pack:           PackData
    thermal:        ThermalData
    cells:          List[CellData]
    battery:        Optional[BatteryStateData] = None   # named 'battery' in twin output
    cooling:        Optional[CoolingData]      = None
    faults:         Optional[FaultsData]       = None


# ─────────────────────────────────────────────────────────────────────────────
# C. INGESTION API
# ─────────────────────────────────────────────────────────────────────────────

class IngestResponse(BaseModel):
    """Acknowledgement returned after successful single-packet ingestion."""
    accepted:      bool
    battery_id:    str
    sequence:      int
    last_sequence: Optional[int] = None
    duplicate:     bool = False
    message:       Optional[str] = None

class BatchIngestRequest(BaseModel):
    """Batch upload: up to 1000 packets per call."""
    packets: List[CanonicalTelemetryPacket] = Field(..., max_length=1000)

class BatchIngestResponse(BaseModel):
    battery_id: str
    submitted:  int
    accepted:   int
    duplicates: int
    rejected:   int
    last_sequence: Optional[int] = None
    errors:     Optional[List[str]] = []


# ─────────────────────────────────────────────────────────────────────────────
# D. ANALYTICS / PREDICTION RECORD
# ─────────────────────────────────────────────────────────────────────────────

class XAIFeature(BaseModel):
    feature: str
    impact:  float

class PredictionData(BaseModel):
    soc_percent:  Optional[float] = None
    soh_percent:  Optional[float] = None
    rul_cycles:   Optional[int]   = None
    rul_days:     Optional[int]   = None

class AnomalyData(BaseModel):
    detected: bool  = False
    score:    Optional[float] = None

class RiskData(BaseModel):
    level: Optional[str]  = None   # SAFE | WATCH | ELEVATED | CRITICAL
    score: Optional[float] = None

class AnalyticsRecordCreate(BaseModel):
    battery_id:           str
    analytics_timestamp:  Optional[datetime]    = None
    telemetry_timestamp:  Optional[datetime]    = None
    source:               Optional[str]         = "digital_twin"
    model_version:        Optional[str]         = "pinn_v1.0"
    model_type:           Optional[str]         = "PINN"

    prediction:           Optional[PredictionData] = None
    anomaly:              Optional[AnomalyData]    = None
    risk:                 Optional[RiskData]        = None
    xai_features:         Optional[List[XAIFeature]] = None
    recommendations:      Optional[List[str]]       = None

    # PINN thermal fields
    predicted_temp_5min:  Optional[float] = None
    predicted_temp_15min: Optional[float] = None
    heat_gen_W:           Optional[float] = None
    heat_loss_W:          Optional[float] = None
    cell_imbalance_index: Optional[float] = None
    physics_residual:     Optional[float] = None
    model_confidence_pct: Optional[float] = None

class AnalyticsRecordResponse(AnalyticsRecordCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str


# ─────────────────────────────────────────────────────────────────────────────
# E. FAULT EVENT
# ─────────────────────────────────────────────────────────────────────────────

class FaultEventCreate(BaseModel):
    battery_id:  str
    fault_code:  str
    severity:    Optional[str]  = "MEDIUM"
    cell_id:     Optional[int]  = None
    source:      Optional[str]  = "digital_twin"
    description: Optional[str]  = None

class FaultEventResponse(FaultEventCreate):
    model_config = ConfigDict(from_attributes=True)
    id:          str
    started_at:  Optional[datetime] = None
    cleared_at:  Optional[datetime] = None
    is_active:   bool = True


# ─────────────────────────────────────────────────────────────────────────────
# F. BATTERY EVENT
# ─────────────────────────────────────────────────────────────────────────────

class BatteryEventCreate(BaseModel):
    battery_id:      str
    event_type:      str
    severity:        Optional[str]  = "INFO"
    description:     Optional[str]  = None
    source:          Optional[str]  = "digital_twin"
    metadata:        Optional[Dict[str, Any]] = None

class BatteryEventResponse(BatteryEventCreate):
    model_config = ConfigDict(from_attributes=True)
    id:              str
    event_timestamp: Optional[datetime] = None


# ─────────────────────────────────────────────────────────────────────────────
# G. BATTERY SESSION
# ─────────────────────────────────────────────────────────────────────────────

class BatterySessionCreate(BaseModel):
    battery_id:   str
    session_type: str = "DISCHARGE"
    source:       Optional[str] = "digital_twin"

class BatterySessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:             str
    battery_id:     str
    session_type:   str
    start_time:     Optional[datetime] = None
    end_time:       Optional[datetime] = None
    is_complete:    bool = False
    initial_soc:    Optional[float] = None
    final_soc:      Optional[float] = None
    energy_Wh:      Optional[float] = None
    distance_km:    Optional[float] = None
    max_temperature:Optional[float] = None
    max_current_A:  Optional[float] = None
    fault_count:    Optional[int]   = 0
    packet_count:   Optional[int]   = 0
    source:         Optional[str]   = None


# ─────────────────────────────────────────────────────────────────────────────
# H. QUERY RESPONSE — RAW TELEMETRY LIST
# ─────────────────────────────────────────────────────────────────────────────

class RawTelemetryRow(BaseModel):
    """Flat row returned from the /telemetry query endpoint."""
    model_config = ConfigDict(from_attributes=True)
    id:               str
    battery_id:       str
    vehicle_id:       Optional[str]   = None
    packet_timestamp: Optional[datetime] = None
    ingested_at:      Optional[datetime] = None
    sequence:         int
    source:           str
    schema_version:   str

    pack_voltage_V:   Optional[float] = None
    pack_current_A:   Optional[float] = None
    pack_power_W:     Optional[float] = None

    temp_min_C:       Optional[float] = None
    temp_max_C:       Optional[float] = None
    temp_avg_C:       Optional[float] = None

    cycle_number:     Optional[int]   = None
    capacity_Ah:      Optional[float] = None
    resistance_ohm:   Optional[float] = None

    cooling_status:   Optional[str]   = None
    cooling_flow_LPM: Optional[float] = None

    fault_status:     Optional[str]   = None
    active_faults_json: Optional[str] = None


class PaginatedTelemetryResponse(BaseModel):
    battery_id:   str
    total:        int
    page:         int
    page_size:    int
    pages:        int
    data:         List[RawTelemetryRow]


# ─────────────────────────────────────────────────────────────────────────────
# I. AGGREGATED TREND API
# ─────────────────────────────────────────────────────────────────────────────

class TrendBucket(BaseModel):
    """One aggregated time-bucket returned by the /trends endpoint."""
    bucket_start: str
    avg_voltage_V:   Optional[float] = None
    min_voltage_V:   Optional[float] = None
    max_voltage_V:   Optional[float] = None
    avg_current_A:   Optional[float] = None
    max_current_A:   Optional[float] = None
    avg_temp_C:      Optional[float] = None
    max_temp_C:      Optional[float] = None
    avg_power_W:     Optional[float] = None
    max_power_W:     Optional[float] = None
    avg_soh:         Optional[float] = None
    avg_rul_cycles:  Optional[float] = None
    avg_risk_score:  Optional[float] = None
    packet_count:    int = 0

class TrendResponse(BaseModel):
    battery_id: str
    start:      str
    end:        str
    interval:   str
    buckets:    List[TrendBucket]


# ─────────────────────────────────────────────────────────────────────────────
# J. WEBSOCKET STREAM ENVELOPE
# ─────────────────────────────────────────────────────────────────────────────

class WSStreamEnvelope(BaseModel):
    """Envelope wrapping a single packet on the per-battery WebSocket stream."""
    battery_id:  str
    event_type:  str = "TELEMETRY"   # TELEMETRY | ANALYTICS | FAULT | EVENT
    schema_version: str = "1.0"
    payload:     Dict[str, Any]
