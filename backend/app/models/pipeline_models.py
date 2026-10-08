"""
pipeline_models.py — Cloud Data Pipeline ORM Models
=====================================================
BRAIN – Battery Risk & Analytics Intelligence Network

Tables created here form the canonical cloud data pipeline schema.
They are SEPARATE from the legacy all_models.py tables (User, Vehicle,
BatteryPack, TelemetryLog) which remain untouched for backward compat.

New entities:
  1. BatteryRegistry     — canonical battery + metadata master record
  2. RawTelemetry        — immutable raw sensor packets (one row per 5 Hz frame)
  3. CellTelemetry       — per-cell data extracted from raw packets (queryable)
  4. AnalyticsRecord     — derived PINN/ML predictions (separate from raw)
  5. FaultEvent          — structured fault start/clear events
  6. BatteryEvent        — generic domain events (CHARGE_STARTED, etc.)
  7. BatterySession      — charge / discharge / test session summaries
  8. IngestionLog         — audit trail for ingestion endpoint calls

Design notes:
  - battery_id is the canonical cross-table primary logical key (string).
  - Raw telemetry is append-only; never updated after insert.
  - Predictions reference (battery_id, telemetry_timestamp, model_version).
  - Cell data is stored in a child table to allow per-cell queries.
  - Schema version "1.0" is embedded in every raw/analytics row.
"""

from sqlalchemy import (
    Column, String, Float, Integer, Boolean,
    DateTime, Text, UniqueConstraint, Index, ForeignKey, JSON
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# 1. BATTERY REGISTRY
# ─────────────────────────────────────────────────────────────────────────────

class BatteryRegistry(Base):
    """
    Master record for each physical or simulated battery pack.
    battery_id is the human-readable canonical identifier (e.g. 'BRAIN001').
    This table intentionally avoids referencing the legacy BatteryPack table.
    """
    __tablename__ = "battery_registry"

    id = Column(String(36), primary_key=True, default=_uuid)

    # ── Canonical identifiers ─────────────────────────────────────────────────
    battery_id       = Column(String(64),  unique=True, nullable=False, index=True)
    vehicle_id       = Column(String(64),  nullable=True,  index=True)

    # ── Hardware metadata ─────────────────────────────────────────────────────
    manufacturer     = Column(String(128), nullable=True, default="Custom")
    model            = Column(String(128), nullable=True, default="BRAIN EV Pack")
    chemistry        = Column(String(32),  nullable=False, default="LFP")   # LFP | NMC | NCA
    cell_count       = Column(Integer,     nullable=False, default=16)
    nominal_voltage_V= Column(Float,       nullable=False, default=51.2)
    capacity_Ah      = Column(Float,       nullable=False, default=100.0)

    # ── BMS / firmware ────────────────────────────────────────────────────────
    bms_model        = Column(String(128), nullable=True, default="BRAIN BMS v2")
    firmware_version = Column(String(64),  nullable=True, default="v2.4.1")

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    manufacture_date  = Column(DateTime, nullable=True)
    installation_date = Column(DateTime, nullable=True)
    status            = Column(String(32), nullable=False, default="ACTIVE")  # ACTIVE | RETIRED | TESTING

    # ── Org / fleet ──────────────────────────────────────────────────────────
    organization_id   = Column(String(64), nullable=True, index=True)  # future multi-tenant
    fleet_id          = Column(String(64), nullable=True)

    created_at  = Column(DateTime, default=_utcnow)
    updated_at  = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    # ── Relationships ─────────────────────────────────────────────────────────
    telemetry_records = relationship("RawTelemetry",    back_populates="battery",  lazy="dynamic")
    analytics_records = relationship("AnalyticsRecord", back_populates="battery",  lazy="dynamic")
    fault_events      = relationship("FaultEvent",      back_populates="battery",  lazy="dynamic")
    battery_events    = relationship("BatteryEvent",    back_populates="battery",  lazy="dynamic")
    sessions          = relationship("BatterySession",  back_populates="battery",  lazy="dynamic")


# ─────────────────────────────────────────────────────────────────────────────
# 2. RAW TELEMETRY (immutable — append-only)
# ─────────────────────────────────────────────────────────────────────────────

class RawTelemetry(Base):
    """
    One row per telemetry frame ingested from the Digital Twin or physical BMS.
    Raw records are NEVER modified after insertion (immutable historical record).
    Predictions are stored in AnalyticsRecord and reference (battery_id, timestamp).

    At 5 Hz: ~300 rows/min, ~18 000/hr, ~432 000/day per battery.
    Structured columns are used for frequently queried fields to avoid
    full JSON blob scans.
    """
    __tablename__ = "raw_telemetry"
    __table_args__ = (
        # Duplicate-packet guard: same battery cannot have two rows with
        # the same sequence number.
        UniqueConstraint("battery_id", "sequence", name="uq_raw_telemetry_batt_seq"),
        # Composite index for efficient time-range queries per battery.
        Index("ix_raw_telemetry_batt_ts", "battery_id", "packet_timestamp"),
    )

    id = Column(String(36), primary_key=True, default=_uuid)

    # ── Foreign key to registry ───────────────────────────────────────────────
    battery_id        = Column(String(64), ForeignKey("battery_registry.battery_id"),
                               nullable=False, index=True)
    vehicle_id        = Column(String(64), nullable=True)

    # ── Packet identity ───────────────────────────────────────────────────────
    packet_timestamp  = Column(DateTime, nullable=False, index=True)   # UTC from payload
    ingested_at       = Column(DateTime, nullable=False, default=_utcnow)
    sequence          = Column(Integer,  nullable=False)                # monotone counter
    source            = Column(String(32), nullable=False, default="digital_twin")
    # digital_twin | physical_bms | dataset | manual_test
    schema_version    = Column(String(8),  nullable=False, default="1.0")

    # ── Pack-level scalars (structured for fast aggregation queries) ──────────
    pack_voltage_V    = Column(Float, nullable=True)
    pack_current_A    = Column(Float, nullable=True)
    pack_power_W      = Column(Float, nullable=True)

    # ── Thermal scalars ───────────────────────────────────────────────────────
    temp_min_C        = Column(Float, nullable=True)
    temp_max_C        = Column(Float, nullable=True)
    temp_avg_C        = Column(Float, nullable=True)

    # ── Battery state scalars ─────────────────────────────────────────────────
    cycle_number      = Column(Integer, nullable=True)
    capacity_Ah       = Column(Float,   nullable=True)
    resistance_ohm    = Column(Float,   nullable=True)

    # ── Cooling ───────────────────────────────────────────────────────────────
    cooling_status    = Column(String(32), nullable=True)
    cooling_flow_LPM  = Column(Float,      nullable=True)

    # ── Fault flags ───────────────────────────────────────────────────────────
    fault_status      = Column(String(32), nullable=True, default="NORMAL")
    active_faults_json= Column(Text,       nullable=True)   # JSON list of fault strings

    # ── Full canonical packet (stored for completeness / audit) ──────────────
    raw_json          = Column(Text, nullable=True)   # full packet JSON blob

    # ── Relationships ─────────────────────────────────────────────────────────
    battery      = relationship("BatteryRegistry", back_populates="telemetry_records")
    cell_records = relationship("CellTelemetry",   back_populates="telemetry",
                                cascade="all, delete-orphan")


# ─────────────────────────────────────────────────────────────────────────────
# 3. CELL TELEMETRY (child of RawTelemetry)
# ─────────────────────────────────────────────────────────────────────────────

class CellTelemetry(Base):
    """
    Per-cell data extracted from each raw telemetry frame.
    Stored separately so company analytics can query:
      'Cell 3 voltage trend over the last 7 days'
    without deserialising full JSON blobs.
    """
    __tablename__ = "cell_telemetry"
    __table_args__ = (
        Index("ix_cell_telemetry_batt_cell_ts", "battery_id", "cell_id", "packet_timestamp"),
    )

    id               = Column(String(36), primary_key=True, default=_uuid)
    telemetry_id     = Column(String(36), ForeignKey("raw_telemetry.id"), nullable=False)
    battery_id       = Column(String(64), nullable=False, index=True)
    packet_timestamp = Column(DateTime,   nullable=False, index=True)

    cell_id          = Column(Integer, nullable=False)
    voltage_V        = Column(Float,   nullable=True)
    temperature_C    = Column(Float,   nullable=True)
    resistance_ohm   = Column(Float,   nullable=True)

    telemetry = relationship("RawTelemetry", back_populates="cell_records")


# ─────────────────────────────────────────────────────────────────────────────
# 4. ANALYTICS RECORD (derived — prediction results)
# ─────────────────────────────────────────────────────────────────────────────

class AnalyticsRecord(Base):
    """
    Stores PINN/ML derived predictions and risk scores.
    NEVER overwrites RawTelemetry rows.
    References the raw row by (battery_id, telemetry_timestamp, model_version).

    Fields are nullable by design — only store what the model actually produced.
    """
    __tablename__ = "analytics_records"
    __table_args__ = (
        Index("ix_analytics_batt_ts", "battery_id", "analytics_timestamp"),
    )

    id                   = Column(String(36), primary_key=True, default=_uuid)
    battery_id           = Column(String(64), ForeignKey("battery_registry.battery_id"),
                                  nullable=False, index=True)

    # ── Traceability ──────────────────────────────────────────────────────────
    analytics_timestamp  = Column(DateTime, nullable=False, default=_utcnow)
    telemetry_timestamp  = Column(DateTime, nullable=True)   # which raw packet this is derived from
    source               = Column(String(32), nullable=True, default="digital_twin")
    schema_version       = Column(String(8),  nullable=False, default="1.0")
    model_version        = Column(String(64), nullable=True, default="pinn_v1.0")
    model_type           = Column(String(64), nullable=True, default="PINN")

    # ── SOC / SOH / RUL predictions ──────────────────────────────────────────
    soc_percent          = Column(Float, nullable=True)
    soh_percent          = Column(Float, nullable=True)
    rul_cycles           = Column(Integer, nullable=True)
    rul_days             = Column(Integer, nullable=True)

    # ── Thermal predictions ───────────────────────────────────────────────────
    predicted_temp_5min  = Column(Float, nullable=True)
    predicted_temp_15min = Column(Float, nullable=True)
    heat_gen_W           = Column(Float, nullable=True)
    heat_loss_W          = Column(Float, nullable=True)

    # ── Anomaly ───────────────────────────────────────────────────────────────
    anomaly_detected     = Column(Boolean, nullable=True, default=False)
    anomaly_score        = Column(Float,   nullable=True)

    # ── Risk ─────────────────────────────────────────────────────────────────
    risk_level           = Column(String(16), nullable=True)   # SAFE|WATCH|ELEVATED|CRITICAL
    risk_score           = Column(Float,      nullable=True)
    cell_imbalance_index = Column(Float,      nullable=True)
    physics_residual     = Column(Float,      nullable=True)
    model_confidence_pct = Column(Float,      nullable=True)

    # ── XAI / feature importance (JSON) ──────────────────────────────────────
    xai_features_json    = Column(Text, nullable=True)
    recommendations_json = Column(Text, nullable=True)

    battery = relationship("BatteryRegistry", back_populates="analytics_records")


# ─────────────────────────────────────────────────────────────────────────────
# 5. FAULT EVENT
# ─────────────────────────────────────────────────────────────────────────────

class FaultEvent(Base):
    """Structured fault lifecycle record (start → clear)."""
    __tablename__ = "fault_events"
    __table_args__ = (
        Index("ix_fault_events_batt_ts", "battery_id", "started_at"),
    )

    id            = Column(String(36), primary_key=True, default=_uuid)
    battery_id    = Column(String(64), ForeignKey("battery_registry.battery_id"),
                           nullable=False, index=True)

    fault_code    = Column(String(64),  nullable=False)   # e.g. HIGH_RESISTANCE
    severity      = Column(String(16),  nullable=True)    # LOW | MEDIUM | HIGH | CRITICAL
    cell_id       = Column(Integer,     nullable=True)    # if localized to a cell
    source        = Column(String(32),  nullable=True, default="digital_twin")
    description   = Column(Text,        nullable=True)

    started_at    = Column(DateTime, nullable=False, default=_utcnow)
    cleared_at    = Column(DateTime, nullable=True)      # None = still active
    is_active     = Column(Boolean,  nullable=False, default=True)

    battery = relationship("BatteryRegistry", back_populates="fault_events")


# ─────────────────────────────────────────────────────────────────────────────
# 6. BATTERY EVENT (domain events)
# ─────────────────────────────────────────────────────────────────────────────

class BatteryEvent(Base):
    """
    Structured domain event log.
    event_type examples:
      FAULT_STARTED | FAULT_CLEARED | ANOMALY_DETECTED | RISK_CHANGED |
      CHARGE_STARTED | CHARGE_COMPLETED | DISCHARGE_STARTED |
      OVER_TEMPERATURE | CELL_IMBALANCE | HIGH_RESISTANCE | COOLING_FAILURE
    """
    __tablename__ = "battery_events"
    __table_args__ = (
        Index("ix_battery_events_batt_ts", "battery_id", "event_timestamp"),
    )

    id              = Column(String(36), primary_key=True, default=_uuid)
    battery_id      = Column(String(64), ForeignKey("battery_registry.battery_id"),
                             nullable=False, index=True)
    event_timestamp = Column(DateTime,   nullable=False, default=_utcnow)
    event_type      = Column(String(64), nullable=False)
    severity        = Column(String(16), nullable=True)    # INFO | WARNING | CRITICAL
    description     = Column(Text,       nullable=True)
    source          = Column(String(32), nullable=True, default="digital_twin")
    metadata_json   = Column(Text,       nullable=True)    # extra key-value data

    battery = relationship("BatteryRegistry", back_populates="battery_events")


# ─────────────────────────────────────────────────────────────────────────────
# 7. BATTERY SESSION
# ─────────────────────────────────────────────────────────────────────────────

class BatterySession(Base):
    """
    Summarises a discrete operational session (charge, discharge, test).
    Fields are populated from actual telemetry; nullable if data unavailable.
    """
    __tablename__ = "battery_sessions"
    __table_args__ = (
        Index("ix_battery_sessions_batt_ts", "battery_id", "start_time"),
    )

    id              = Column(String(36), primary_key=True, default=_uuid)
    battery_id      = Column(String(64), ForeignKey("battery_registry.battery_id"),
                             nullable=False, index=True)

    session_type    = Column(String(32), nullable=False, default="DISCHARGE")
    # CHARGE | DISCHARGE | TEST | IDLE

    start_time      = Column(DateTime, nullable=False, default=_utcnow)
    end_time        = Column(DateTime, nullable=True)     # None = session ongoing
    is_complete     = Column(Boolean,  nullable=False, default=False)

    initial_soc     = Column(Float, nullable=True)
    final_soc       = Column(Float, nullable=True)
    energy_Wh       = Column(Float, nullable=True)
    distance_km     = Column(Float, nullable=True)    # if available

    max_temperature = Column(Float, nullable=True)
    max_current_A   = Column(Float, nullable=True)
    fault_count     = Column(Integer, nullable=True, default=0)
    packet_count    = Column(Integer, nullable=True, default=0)

    source          = Column(String(32), nullable=True, default="digital_twin")
    notes           = Column(Text,       nullable=True)

    battery = relationship("BatteryRegistry", back_populates="sessions")


# ─────────────────────────────────────────────────────────────────────────────
# 8. INGESTION LOG (audit trail)
# ─────────────────────────────────────────────────────────────────────────────

class IngestionLog(Base):
    """
    Audit log entry written for each ingest call.
    Allows diagnosis of:
      - missing packets (sequence gap detection)
      - duplicate resubmissions
      - batch upload status
    """
    __tablename__ = "ingestion_log"
    __table_args__ = (
        Index("ix_ingestion_log_batt_ts", "battery_id", "ingested_at"),
    )

    id           = Column(String(36), primary_key=True, default=_uuid)
    battery_id   = Column(String(64), nullable=False, index=True)
    ingested_at  = Column(DateTime,   nullable=False, default=_utcnow)

    batch_size   = Column(Integer, nullable=False, default=1)
    accepted     = Column(Integer, nullable=False, default=0)
    duplicates   = Column(Integer, nullable=False, default=0)
    rejected     = Column(Integer, nullable=False, default=0)
    last_sequence= Column(Integer, nullable=True)
    errors_json  = Column(Text,    nullable=True)
    source_ip    = Column(String(64), nullable=True)
