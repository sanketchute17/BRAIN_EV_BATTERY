"""
ingestion_service.py — Cloud Telemetry Ingestion & Storage Service
===================================================================
BRAIN – Battery Risk & Analytics Intelligence Network

Responsibilities:
  1. Validate a CanonicalTelemetryPacket.
  2. Auto-register unknown battery_ids in battery_registry.
  3. Deduplicate packets by (battery_id, sequence).
  4. Store raw telemetry (immutable append).
  5. Explode cell data into cell_telemetry child rows.
  6. Store analytics records (when provided / computed separately).
  7. Record fault events and domain events.
  8. Write an ingestion audit log entry.

Architecture:
  Digital Twin → ingestion_service → DB
  Physical BMS → ingestion_service → DB
  (same pipeline, source field identifies origin)
"""

import json
import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models.pipeline_models import (
    BatteryRegistry,
    RawTelemetry,
    CellTelemetry,
    AnalyticsRecord,
    FaultEvent,
    BatteryEvent,
    IngestionLog,
)
from app.schemas.pipeline_schemas import (
    CanonicalTelemetryPacket,
    AnalyticsRecordCreate,
    FaultEventCreate,
    BatteryEventCreate,
    BatchIngestResponse,
    IngestResponse,
)

logger = logging.getLogger("ingestion_service")


def _parse_utc_timestamp(ts_str: str) -> datetime:
    """Parse ISO-8601 UTC string, always returns timezone-aware datetime."""
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.now(timezone.utc)


def _ensure_battery_registered(battery_id: str, db: Session) -> BatteryRegistry:
    """
    Return the BatteryRegistry row for battery_id.
    If it does not exist, auto-register it with sensible defaults.
    This allows the Digital Twin to ingest telemetry without manual pre-registration.
    """
    reg = db.query(BatteryRegistry).filter(BatteryRegistry.battery_id == battery_id).first()
    if reg is None:
        reg = BatteryRegistry(battery_id=battery_id)
        db.add(reg)
        db.flush()   # get the row created without a full commit
        logger.info(f"[INGESTION] Auto-registered new battery: {battery_id}")
    return reg


def ingest_single_packet(
    packet: CanonicalTelemetryPacket,
    db: Session,
    source_ip: Optional[str] = None,
) -> IngestResponse:
    """
    Validate, deduplicate, and persist a single canonical telemetry packet.
    Returns IngestResponse with accepted/duplicate flags.
    """
    battery_id = packet.battery_id
    sequence   = packet.sequence

    # ── 1. Auto-register battery ──────────────────────────────────────────────
    _ensure_battery_registered(battery_id, db)

    # ── 2. Duplicate check (battery_id + sequence) ────────────────────────────
    existing = (
        db.query(RawTelemetry)
        .filter(
            RawTelemetry.battery_id == battery_id,
            RawTelemetry.sequence   == sequence,
        )
        .first()
    )
    if existing is not None:
        _write_ingestion_log(battery_id, db, batch_size=1, accepted=0, duplicates=1,
                              rejected=0, last_sequence=sequence, source_ip=source_ip)
        db.commit()
        return IngestResponse(
            accepted=False,
            battery_id=battery_id,
            sequence=sequence,
            last_sequence=sequence,
            duplicate=True,
            message="Duplicate packet; sequence already stored.",
        )

    # ── 3. Parse timestamp ────────────────────────────────────────────────────
    packet_ts = _parse_utc_timestamp(packet.timestamp)

    # ── 4. Build raw telemetry row ────────────────────────────────────────────
    active_faults: List[str] = []
    fault_status = "NORMAL"
    if packet.faults:
        fault_status  = packet.faults.status or "NORMAL"
        active_faults = packet.faults.active or []

    raw_row = RawTelemetry(
        battery_id        = battery_id,
        vehicle_id        = packet.vehicle_id,
        packet_timestamp  = packet_ts,
        sequence          = sequence,
        source            = packet.source,
        schema_version    = packet.schema_version,

        pack_voltage_V    = packet.pack.voltage_V,
        pack_current_A    = packet.pack.current_A,
        pack_power_W      = packet.pack.power_W,

        temp_min_C        = packet.thermal.min_temperature_C if packet.thermal else None,
        temp_max_C        = packet.thermal.max_temperature_C if packet.thermal else None,
        temp_avg_C        = packet.thermal.average_temperature_C if packet.thermal else None,

        cycle_number      = packet.battery.cycle_number if packet.battery else None,
        capacity_Ah       = packet.battery.capacity_Ah  if packet.battery else None,
        resistance_ohm    = packet.battery.resistance_ohm if packet.battery else None,

        cooling_status    = packet.cooling.status        if packet.cooling else None,
        cooling_flow_LPM  = packet.cooling.flow_rate_LPM if packet.cooling else None,

        fault_status      = fault_status,
        active_faults_json= json.dumps(active_faults),

        raw_json          = packet.model_dump_json(),
    )
    db.add(raw_row)
    db.flush()   # need raw_row.id for FK in cell_telemetry

    # ── 5. Explode cell data into CellTelemetry rows ──────────────────────────
    for cell in packet.cells:
        cid = cell.cell_id if cell.cell_id is not None else cell.id
        if cid is None:
            continue
        cell_row = CellTelemetry(
            telemetry_id     = raw_row.id,
            battery_id       = battery_id,
            packet_timestamp = packet_ts,
            cell_id          = cid,
            voltage_V        = cell.voltage_V,
            temperature_C    = cell.temperature_C,
            resistance_ohm   = cell.resistance_ohm,
        )
        db.add(cell_row)

    # ── 6. Emit fault domain events if faults changed to ACTIVE ──────────────
    for fault_code in active_faults:
        _emit_battery_event(
            battery_id  = battery_id,
            event_type  = "FAULT_STARTED",
            severity    = "WARNING",
            description = f"Fault detected: {fault_code}",
            source      = packet.source,
            metadata    = {"fault_code": fault_code, "sequence": sequence},
            db          = db,
        )

    # ── 7. Ingestion audit log ────────────────────────────────────────────────
    _write_ingestion_log(battery_id, db, batch_size=1, accepted=1, duplicates=0,
                          rejected=0, last_sequence=sequence, source_ip=source_ip)

    db.commit()

    return IngestResponse(
        accepted=True,
        battery_id=battery_id,
        sequence=sequence,
        last_sequence=sequence,
        duplicate=False,
        message="Packet accepted and stored.",
    )


def ingest_batch(
    packets: List[CanonicalTelemetryPacket],
    db: Session,
    source_ip: Optional[str] = None,
) -> BatchIngestResponse:
    """
    Ingest a batch of telemetry packets.
    Each packet is validated individually.
    Partial acceptance is supported (some may be duplicates or malformed).
    """
    if not packets:
        return BatchIngestResponse(battery_id="UNKNOWN", submitted=0,
                                    accepted=0, duplicates=0, rejected=0)

    battery_id = packets[0].battery_id
    accepted = duplicates = rejected = 0
    last_seq = None
    errors: List[str] = []

    # Auto-register once for the batch
    _ensure_battery_registered(battery_id, db)

    for pkt in packets:
        try:
            # Per-packet duplicate check
            existing = (
                db.query(RawTelemetry)
                .filter(
                    RawTelemetry.battery_id == pkt.battery_id,
                    RawTelemetry.sequence   == pkt.sequence,
                )
                .first()
            )
            if existing:
                duplicates += 1
                continue

            # Store
            packet_ts = _parse_utc_timestamp(pkt.timestamp)
            active_faults = pkt.faults.active if pkt.faults else []
            fault_status  = pkt.faults.status if pkt.faults else "NORMAL"

            raw_row = RawTelemetry(
                battery_id        = pkt.battery_id,
                vehicle_id        = pkt.vehicle_id,
                packet_timestamp  = packet_ts,
                sequence          = pkt.sequence,
                source            = pkt.source,
                schema_version    = pkt.schema_version,
                pack_voltage_V    = pkt.pack.voltage_V,
                pack_current_A    = pkt.pack.current_A,
                pack_power_W      = pkt.pack.power_W,
                temp_min_C        = pkt.thermal.min_temperature_C if pkt.thermal else None,
                temp_max_C        = pkt.thermal.max_temperature_C if pkt.thermal else None,
                temp_avg_C        = pkt.thermal.average_temperature_C if pkt.thermal else None,
                cycle_number      = pkt.battery.cycle_number  if pkt.battery else None,
                capacity_Ah       = pkt.battery.capacity_Ah   if pkt.battery else None,
                resistance_ohm    = pkt.battery.resistance_ohm if pkt.battery else None,
                cooling_status    = pkt.cooling.status         if pkt.cooling else None,
                cooling_flow_LPM  = pkt.cooling.flow_rate_LPM if pkt.cooling else None,
                fault_status      = fault_status,
                active_faults_json= json.dumps(active_faults or []),
                raw_json          = pkt.model_dump_json(),
            )
            db.add(raw_row)
            db.flush()

            for cell in pkt.cells:
                cid = cell.cell_id if cell.cell_id is not None else cell.id
                if cid is None:
                    continue
                db.add(CellTelemetry(
                    telemetry_id     = raw_row.id,
                    battery_id       = pkt.battery_id,
                    packet_timestamp = packet_ts,
                    cell_id          = cid,
                    voltage_V        = cell.voltage_V,
                    temperature_C    = cell.temperature_C,
                    resistance_ohm   = cell.resistance_ohm,
                ))

            accepted += 1
            last_seq = pkt.sequence

        except Exception as exc:
            rejected += 1
            errors.append(f"seq={pkt.sequence}: {str(exc)[:120]}")
            db.rollback()

    # Audit log
    _write_ingestion_log(battery_id, db, batch_size=len(packets), accepted=accepted,
                          duplicates=duplicates, rejected=rejected,
                          last_sequence=last_seq, source_ip=source_ip,
                          errors=errors)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"[INGESTION] Batch commit failed: {exc}")
        rejected += accepted
        accepted = 0

    return BatchIngestResponse(
        battery_id    = battery_id,
        submitted     = len(packets),
        accepted      = accepted,
        duplicates    = duplicates,
        rejected      = rejected,
        last_sequence = last_seq,
        errors        = errors,
    )


def store_analytics_record(payload: AnalyticsRecordCreate, db: Session) -> str:
    """Persist a derived analytics/prediction record. Returns the new record id."""
    _ensure_battery_registered(payload.battery_id, db)

    xai_json  = None
    recs_json = None
    if payload.xai_features:
        xai_json = json.dumps([f.model_dump() for f in payload.xai_features])
    if payload.recommendations:
        recs_json = json.dumps(payload.recommendations)

    row = AnalyticsRecord(
        battery_id           = payload.battery_id,
        analytics_timestamp  = payload.analytics_timestamp or datetime.now(timezone.utc),
        telemetry_timestamp  = payload.telemetry_timestamp,
        source               = payload.source,
        model_version        = payload.model_version,
        model_type           = payload.model_type,
        soc_percent          = payload.prediction.soc_percent if payload.prediction else None,
        soh_percent          = payload.prediction.soh_percent if payload.prediction else None,
        rul_cycles           = payload.prediction.rul_cycles  if payload.prediction else None,
        rul_days             = payload.prediction.rul_days    if payload.prediction else None,
        anomaly_detected     = payload.anomaly.detected       if payload.anomaly else None,
        anomaly_score        = payload.anomaly.score          if payload.anomaly else None,
        risk_level           = payload.risk.level             if payload.risk else None,
        risk_score           = payload.risk.score             if payload.risk else None,
        predicted_temp_5min  = payload.predicted_temp_5min,
        predicted_temp_15min = payload.predicted_temp_15min,
        heat_gen_W           = payload.heat_gen_W,
        heat_loss_W          = payload.heat_loss_W,
        cell_imbalance_index = payload.cell_imbalance_index,
        physics_residual     = payload.physics_residual,
        model_confidence_pct = payload.model_confidence_pct,
        xai_features_json    = xai_json,
        recommendations_json = recs_json,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def record_fault_event(payload: FaultEventCreate, db: Session) -> str:
    """Store a structured fault event."""
    _ensure_battery_registered(payload.battery_id, db)
    row = FaultEvent(
        battery_id  = payload.battery_id,
        fault_code  = payload.fault_code,
        severity    = payload.severity,
        cell_id     = payload.cell_id,
        source      = payload.source,
        description = payload.description,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def clear_active_faults(battery_id: str, db: Session) -> int:
    """Mark all active fault events for a battery as cleared."""
    now = datetime.now(timezone.utc)
    rows = (
        db.query(FaultEvent)
        .filter(FaultEvent.battery_id == battery_id, FaultEvent.is_active == True)
        .all()
    )
    for r in rows:
        r.cleared_at = now
        r.is_active  = False
    db.commit()
    return len(rows)


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _emit_battery_event(
    battery_id: str,
    event_type: str,
    severity: str,
    description: str,
    source: str,
    metadata: Optional[Dict[str, Any]],
    db: Session,
) -> None:
    row = BatteryEvent(
        battery_id    = battery_id,
        event_type    = event_type,
        severity      = severity,
        description   = description,
        source        = source,
        metadata_json = json.dumps(metadata) if metadata else None,
    )
    db.add(row)


def _write_ingestion_log(
    battery_id: str,
    db: Session,
    batch_size: int,
    accepted: int,
    duplicates: int,
    rejected: int,
    last_sequence: Optional[int],
    source_ip: Optional[str] = None,
    errors: Optional[List[str]] = None,
) -> None:
    from app.models.pipeline_models import IngestionLog
    row = IngestionLog(
        battery_id    = battery_id,
        batch_size    = batch_size,
        accepted      = accepted,
        duplicates    = duplicates,
        rejected      = rejected,
        last_sequence = last_sequence,
        source_ip     = source_ip,
        errors_json   = json.dumps(errors) if errors else None,
    )
    db.add(row)
