"""
query_service.py — Battery-Wise Data Query & Trend Aggregation Service
=======================================================================
BRAIN – Battery Risk & Analytics Intelligence Network

Provides:
  - Paginated raw telemetry queries (per-battery, time-range)
  - Cell telemetry queries (per-battery, per-cell, time-range)
  - Analytics / prediction record queries
  - Fault event queries
  - Domain event queries
  - Session queries
  - Aggregated trend calculation (bucket-based time-series)

All queries are battery_id-scoped to enforce data isolation.
"""

import math
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.models.pipeline_models import (
    BatteryRegistry,
    RawTelemetry,
    CellTelemetry,
    AnalyticsRecord,
    FaultEvent,
    BatteryEvent,
    BatterySession,
)
from app.schemas.pipeline_schemas import (
    BatteryMetadataResponse,
    RawTelemetryRow,
    PaginatedTelemetryResponse,
    TrendBucket,
    TrendResponse,
    AnalyticsRecordResponse,
    FaultEventResponse,
    BatteryEventResponse,
    BatterySessionResponse,
)

logger = logging.getLogger("query_service")

# ─────────────────────────────────────────────────────────────────────────────
# Time-range helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_ts(ts_str: Optional[str]) -> Optional[datetime]:
    if not ts_str:
        return None
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None

def _interval_seconds(interval: str) -> int:
    """Convert interval shorthand to seconds."""
    mapping = {
        "1m": 60, "5m": 300, "15m": 900,
        "1h": 3600, "6h": 21600, "1d": 86400,
    }
    return mapping.get(interval, 3600)


# ─────────────────────────────────────────────────────────────────────────────
# Battery Registry
# ─────────────────────────────────────────────────────────────────────────────

def get_all_batteries(db: Session, organization_id: Optional[str] = None) -> List[BatteryMetadataResponse]:
    q = db.query(BatteryRegistry)
    if organization_id:
        q = q.filter(BatteryRegistry.organization_id == organization_id)
    rows = q.order_by(BatteryRegistry.battery_id).all()
    return [BatteryMetadataResponse.model_validate(r) for r in rows]


def get_battery(battery_id: str, db: Session) -> Optional[BatteryMetadataResponse]:
    row = db.query(BatteryRegistry).filter(BatteryRegistry.battery_id == battery_id).first()
    if row is None:
        return None
    return BatteryMetadataResponse.model_validate(row)


# ─────────────────────────────────────────────────────────────────────────────
# Raw Telemetry
# ─────────────────────────────────────────────────────────────────────────────

def get_telemetry(
    battery_id: str,
    db: Session,
    start: Optional[str] = None,
    end:   Optional[str] = None,
    page:  int = 1,
    page_size: int = 100,
) -> PaginatedTelemetryResponse:
    """Paginated raw telemetry for a battery with optional time-range filter."""
    page      = max(1, page)
    page_size = max(1, min(page_size, 1000))
    offset    = (page - 1) * page_size

    q = db.query(RawTelemetry).filter(RawTelemetry.battery_id == battery_id)

    start_dt = _parse_ts(start)
    end_dt   = _parse_ts(end)
    if start_dt:
        q = q.filter(RawTelemetry.packet_timestamp >= start_dt)
    if end_dt:
        q = q.filter(RawTelemetry.packet_timestamp <= end_dt)

    total = q.count()
    rows  = q.order_by(RawTelemetry.packet_timestamp.desc()).offset(offset).limit(page_size).all()
    pages = math.ceil(total / page_size) if total else 1

    return PaginatedTelemetryResponse(
        battery_id = battery_id,
        total      = total,
        page       = page,
        page_size  = page_size,
        pages      = pages,
        data       = [RawTelemetryRow.model_validate(r) for r in rows],
    )


def get_latest_telemetry_row(battery_id: str, db: Session) -> Optional[RawTelemetryRow]:
    row = (
        db.query(RawTelemetry)
        .filter(RawTelemetry.battery_id == battery_id)
        .order_by(RawTelemetry.packet_timestamp.desc())
        .first()
    )
    if row is None:
        return None
    return RawTelemetryRow.model_validate(row)


# ─────────────────────────────────────────────────────────────────────────────
# Cell Telemetry
# ─────────────────────────────────────────────────────────────────────────────

def get_cell_telemetry(
    battery_id: str,
    db: Session,
    cell_id: Optional[int] = None,
    start:   Optional[str] = None,
    end:     Optional[str] = None,
    page:    int = 1,
    page_size: int = 200,
) -> Dict[str, Any]:
    """
    Return cell-level telemetry rows.
    If cell_id is supplied → single cell.
    Otherwise → all cells (grouped in response).
    """
    page      = max(1, page)
    page_size = max(1, min(page_size, 2000))
    offset    = (page - 1) * page_size

    q = db.query(CellTelemetry).filter(CellTelemetry.battery_id == battery_id)

    if cell_id is not None:
        q = q.filter(CellTelemetry.cell_id == cell_id)

    start_dt = _parse_ts(start)
    end_dt   = _parse_ts(end)
    if start_dt:
        q = q.filter(CellTelemetry.packet_timestamp >= start_dt)
    if end_dt:
        q = q.filter(CellTelemetry.packet_timestamp <= end_dt)

    total = q.count()
    rows  = q.order_by(CellTelemetry.packet_timestamp.desc()).offset(offset).limit(page_size).all()
    pages = math.ceil(total / page_size) if total else 1

    data = [
        {
            "battery_id":       r.battery_id,
            "cell_id":          r.cell_id,
            "packet_timestamp": r.packet_timestamp.isoformat() if r.packet_timestamp else None,
            "voltage_V":        r.voltage_V,
            "temperature_C":    r.temperature_C,
            "resistance_ohm":   r.resistance_ohm,
        }
        for r in rows
    ]

    return {
        "battery_id": battery_id,
        "cell_id":    cell_id,
        "total":      total,
        "page":       page,
        "page_size":  page_size,
        "pages":      pages,
        "data":       data,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Analytics Records
# ─────────────────────────────────────────────────────────────────────────────

def get_analytics(
    battery_id: str,
    db: Session,
    start:     Optional[str] = None,
    end:       Optional[str] = None,
    page:      int = 1,
    page_size: int = 100,
) -> Dict[str, Any]:
    page      = max(1, page)
    page_size = max(1, min(page_size, 500))
    offset    = (page - 1) * page_size

    q = db.query(AnalyticsRecord).filter(AnalyticsRecord.battery_id == battery_id)

    start_dt = _parse_ts(start)
    end_dt   = _parse_ts(end)
    if start_dt:
        q = q.filter(AnalyticsRecord.analytics_timestamp >= start_dt)
    if end_dt:
        q = q.filter(AnalyticsRecord.analytics_timestamp <= end_dt)

    total = q.count()
    rows  = q.order_by(AnalyticsRecord.analytics_timestamp.desc()).offset(offset).limit(page_size).all()
    pages = math.ceil(total / page_size) if total else 1

    def _serialise(r: AnalyticsRecord) -> Dict[str, Any]:
        xai = None
        recs = None
        try:
            if r.xai_features_json:
                xai = json.loads(r.xai_features_json)
            if r.recommendations_json:
                recs = json.loads(r.recommendations_json)
        except Exception:
            pass
        return {
            "id": r.id,
            "battery_id": r.battery_id,
            "analytics_timestamp": r.analytics_timestamp.isoformat() if r.analytics_timestamp else None,
            "telemetry_timestamp": r.telemetry_timestamp.isoformat() if r.telemetry_timestamp else None,
            "source": r.source,
            "model_version": r.model_version,
            "model_type": r.model_type,
            "prediction": {
                "soc_percent": r.soc_percent,
                "soh_percent": r.soh_percent,
                "rul_cycles":  r.rul_cycles,
                "rul_days":    r.rul_days,
            },
            "anomaly": {
                "detected": r.anomaly_detected,
                "score":    r.anomaly_score,
            },
            "risk": {
                "level": r.risk_level,
                "score": r.risk_score,
            },
            "thermal": {
                "predicted_temp_5min":  r.predicted_temp_5min,
                "predicted_temp_15min": r.predicted_temp_15min,
                "heat_gen_W":           r.heat_gen_W,
                "heat_loss_W":          r.heat_loss_W,
            },
            "cell_imbalance_index": r.cell_imbalance_index,
            "physics_residual":     r.physics_residual,
            "model_confidence_pct": r.model_confidence_pct,
            "xai_features":         xai,
            "recommendations":      recs,
        }

    return {
        "battery_id": battery_id,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
        "data": [_serialise(r) for r in rows],
    }


def get_latest_analytics(battery_id: str, db: Session) -> Optional[Dict[str, Any]]:
    row = (
        db.query(AnalyticsRecord)
        .filter(AnalyticsRecord.battery_id == battery_id)
        .order_by(AnalyticsRecord.analytics_timestamp.desc())
        .first()
    )
    if row is None:
        return None
    xai = None
    recs = None
    try:
        if row.xai_features_json:
            xai = json.loads(row.xai_features_json)
        if row.recommendations_json:
            recs = json.loads(row.recommendations_json)
    except Exception:
        pass
    return {
        "id": row.id,
        "battery_id": row.battery_id,
        "analytics_timestamp": row.analytics_timestamp.isoformat() if row.analytics_timestamp else None,
        "soh_percent": row.soh_percent,
        "soc_percent": row.soc_percent,
        "rul_cycles":  row.rul_cycles,
        "rul_days":    row.rul_days,
        "risk_level":  row.risk_level,
        "risk_score":  row.risk_score,
        "anomaly_detected": row.anomaly_detected,
        "xai_features": xai,
        "recommendations": recs,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Fault Events
# ─────────────────────────────────────────────────────────────────────────────

def get_faults(
    battery_id: str,
    db: Session,
    active_only: bool = False,
    start: Optional[str] = None,
    end:   Optional[str] = None,
    page:  int = 1,
    page_size: int = 100,
) -> Dict[str, Any]:
    page      = max(1, page)
    page_size = max(1, min(page_size, 500))
    offset    = (page - 1) * page_size

    q = db.query(FaultEvent).filter(FaultEvent.battery_id == battery_id)
    if active_only:
        q = q.filter(FaultEvent.is_active == True)
    start_dt = _parse_ts(start)
    end_dt   = _parse_ts(end)
    if start_dt:
        q = q.filter(FaultEvent.started_at >= start_dt)
    if end_dt:
        q = q.filter(FaultEvent.started_at <= end_dt)

    total = q.count()
    rows  = q.order_by(FaultEvent.started_at.desc()).offset(offset).limit(page_size).all()
    pages = math.ceil(total / page_size) if total else 1

    return {
        "battery_id": battery_id,
        "total": total,
        "page": page, "page_size": page_size, "pages": pages,
        "data": [
            {
                "id":          r.id,
                "battery_id":  r.battery_id,
                "fault_code":  r.fault_code,
                "severity":    r.severity,
                "cell_id":     r.cell_id,
                "source":      r.source,
                "description": r.description,
                "started_at":  r.started_at.isoformat() if r.started_at else None,
                "cleared_at":  r.cleared_at.isoformat() if r.cleared_at else None,
                "is_active":   r.is_active,
            }
            for r in rows
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Battery Events
# ─────────────────────────────────────────────────────────────────────────────

def get_events(
    battery_id: str,
    db: Session,
    event_type: Optional[str] = None,
    start: Optional[str] = None,
    end:   Optional[str] = None,
    page:  int = 1,
    page_size: int = 100,
) -> Dict[str, Any]:
    page      = max(1, page)
    page_size = max(1, min(page_size, 500))
    offset    = (page - 1) * page_size

    q = db.query(BatteryEvent).filter(BatteryEvent.battery_id == battery_id)
    if event_type:
        q = q.filter(BatteryEvent.event_type == event_type)
    start_dt = _parse_ts(start)
    end_dt   = _parse_ts(end)
    if start_dt:
        q = q.filter(BatteryEvent.event_timestamp >= start_dt)
    if end_dt:
        q = q.filter(BatteryEvent.event_timestamp <= end_dt)

    total = q.count()
    rows  = q.order_by(BatteryEvent.event_timestamp.desc()).offset(offset).limit(page_size).all()
    pages = math.ceil(total / page_size) if total else 1

    return {
        "battery_id": battery_id,
        "total": total, "page": page, "page_size": page_size, "pages": pages,
        "data": [
            {
                "id":               r.id,
                "battery_id":       r.battery_id,
                "event_type":       r.event_type,
                "event_timestamp":  r.event_timestamp.isoformat() if r.event_timestamp else None,
                "severity":         r.severity,
                "description":      r.description,
                "source":           r.source,
            }
            for r in rows
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Sessions
# ─────────────────────────────────────────────────────────────────────────────

def get_sessions(
    battery_id: str,
    db: Session,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    page      = max(1, page)
    page_size = max(1, min(page_size, 200))
    offset    = (page - 1) * page_size

    q     = db.query(BatterySession).filter(BatterySession.battery_id == battery_id)
    total = q.count()
    rows  = q.order_by(BatterySession.start_time.desc()).offset(offset).limit(page_size).all()
    pages = math.ceil(total / page_size) if total else 1

    return {
        "battery_id": battery_id,
        "total": total, "page": page, "page_size": page_size, "pages": pages,
        "data": [BatterySessionResponse.model_validate(r).model_dump() for r in rows],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Aggregated Trend Query
# ─────────────────────────────────────────────────────────────────────────────

def get_trends(
    battery_id: str,
    db: Session,
    start:    Optional[str] = None,
    end:      Optional[str] = None,
    interval: str = "1h",
) -> TrendResponse:
    """
    Compute time-bucket aggregations for the company analytics dashboard.

    Uses Python-level grouping (compatible with SQLite which lacks native
    date_trunc). For PostgreSQL, this can be replaced with date_trunc().

    Returns average/min/max voltage, current, temperature, power per bucket,
    plus latest SOH, RUL, and risk score from the analytics table.
    """
    interval_sec = _interval_seconds(interval)

    # Default time range: last 24 hours
    end_dt   = _parse_ts(end)   or datetime.now(timezone.utc)
    start_dt = _parse_ts(start) or (end_dt - timedelta(hours=24))

    # ── Load raw telemetry in range ───────────────────────────────────────────
    tele_rows = (
        db.query(RawTelemetry)
        .filter(
            RawTelemetry.battery_id == battery_id,
            RawTelemetry.packet_timestamp >= start_dt,
            RawTelemetry.packet_timestamp <= end_dt,
        )
        .order_by(RawTelemetry.packet_timestamp)
        .all()
    )

    # ── Load analytics rows in range ──────────────────────────────────────────
    ana_rows = (
        db.query(AnalyticsRecord)
        .filter(
            AnalyticsRecord.battery_id == battery_id,
            AnalyticsRecord.analytics_timestamp >= start_dt,
            AnalyticsRecord.analytics_timestamp <= end_dt,
        )
        .order_by(AnalyticsRecord.analytics_timestamp)
        .all()
    )

    # ── Build analytics index (timestamp -> row) ──────────────────────────────
    # We find the closest analytics row for each telemetry bucket.
    ana_index: List[tuple] = [
        (r.analytics_timestamp.replace(tzinfo=timezone.utc)
         if r.analytics_timestamp and r.analytics_timestamp.tzinfo is None
         else r.analytics_timestamp,
         r)
        for r in ana_rows
        if r.analytics_timestamp is not None
    ]

    def _closest_analytics(bucket_start: datetime) -> Optional[AnalyticsRecord]:
        bucket_end = bucket_start + timedelta(seconds=interval_sec)
        candidates = [
            r for ts, r in ana_index
            if ts is not None and bucket_start <= ts < bucket_end
        ]
        return candidates[-1] if candidates else None

    # ── Build time buckets ────────────────────────────────────────────────────
    # Align bucket start to epoch multiples
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    start_aligned_ts = start_dt.timestamp()
    # round down to nearest bucket
    bucket_start_ts = (start_aligned_ts // interval_sec) * interval_sec

    buckets: List[TrendBucket] = []
    current_ts = bucket_start_ts

    end_ts = end_dt.timestamp()

    while current_ts < end_ts:
        bucket_start_dt = datetime.fromtimestamp(current_ts, tz=timezone.utc)
        bucket_end_dt   = datetime.fromtimestamp(current_ts + interval_sec, tz=timezone.utc)

        # Filter telemetry rows into this bucket
        pts = [
            r for r in tele_rows
            if r.packet_timestamp is not None
            and bucket_start_dt <= (
                r.packet_timestamp.replace(tzinfo=timezone.utc)
                if r.packet_timestamp.tzinfo is None
                else r.packet_timestamp
            ) < bucket_end_dt
        ]

        if pts:
            volts   = [r.pack_voltage_V  for r in pts if r.pack_voltage_V  is not None]
            amps    = [r.pack_current_A  for r in pts if r.pack_current_A  is not None]
            temps   = [r.temp_avg_C      for r in pts if r.temp_avg_C      is not None]
            temps_m = [r.temp_max_C      for r in pts if r.temp_max_C      is not None]
            pows    = [r.pack_power_W    for r in pts if r.pack_power_W    is not None]

            ana = _closest_analytics(bucket_start_dt)

            bucket = TrendBucket(
                bucket_start    = bucket_start_dt.isoformat(),
                avg_voltage_V   = round(sum(volts) / len(volts),   3) if volts else None,
                min_voltage_V   = round(min(volts),                 3) if volts else None,
                max_voltage_V   = round(max(volts),                 3) if volts else None,
                avg_current_A   = round(sum(amps)  / len(amps),    3) if amps  else None,
                max_current_A   = round(max(amps),                  3) if amps  else None,
                avg_temp_C      = round(sum(temps) / len(temps),    3) if temps else None,
                max_temp_C      = round(max(temps_m),               3) if temps_m else None,
                avg_power_W     = round(sum(pows)  / len(pows),    3) if pows  else None,
                max_power_W     = round(max(pows),                  3) if pows  else None,
                avg_soh         = ana.soh_percent      if ana else None,
                avg_rul_cycles  = ana.rul_cycles        if ana else None,
                avg_risk_score  = ana.risk_score        if ana else None,
                packet_count    = len(pts),
            )
            buckets.append(bucket)

        current_ts += interval_sec

    return TrendResponse(
        battery_id = battery_id,
        start      = start_dt.isoformat(),
        end        = end_dt.isoformat(),
        interval   = interval,
        buckets    = buckets,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Battery overview summary
# ─────────────────────────────────────────────────────────────────────────────

def get_battery_overview(battery_id: str, db: Session) -> Dict[str, Any]:
    """
    Lightweight overview returned by GET /api/v1/batteries/{battery_id}.
    Combines metadata + latest telemetry + latest analytics.
    """
    reg  = db.query(BatteryRegistry).filter(BatteryRegistry.battery_id == battery_id).first()
    latest_tele = (
        db.query(RawTelemetry)
        .filter(RawTelemetry.battery_id == battery_id)
        .order_by(RawTelemetry.packet_timestamp.desc())
        .first()
    )
    latest_ana = (
        db.query(AnalyticsRecord)
        .filter(AnalyticsRecord.battery_id == battery_id)
        .order_by(AnalyticsRecord.analytics_timestamp.desc())
        .first()
    )
    total_packets = (
        db.query(func.count(RawTelemetry.id))
        .filter(RawTelemetry.battery_id == battery_id)
        .scalar()
    ) or 0
    active_faults = (
        db.query(FaultEvent)
        .filter(FaultEvent.battery_id == battery_id, FaultEvent.is_active == True)
        .count()
    )

    return {
        "battery_id":    battery_id,
        "metadata":      BatteryMetadataResponse.model_validate(reg).model_dump() if reg else None,
        "total_packets": total_packets,
        "active_faults": active_faults,
        "latest_telemetry": {
            "timestamp":    latest_tele.packet_timestamp.isoformat() if latest_tele and latest_tele.packet_timestamp else None,
            "sequence":     latest_tele.sequence     if latest_tele else None,
            "pack_voltage": latest_tele.pack_voltage_V if latest_tele else None,
            "pack_current": latest_tele.pack_current_A if latest_tele else None,
            "temp_max":     latest_tele.temp_max_C   if latest_tele else None,
            "fault_status": latest_tele.fault_status if latest_tele else None,
        } if latest_tele else None,
        "latest_analytics": {
            "timestamp":    latest_ana.analytics_timestamp.isoformat() if latest_ana and latest_ana.analytics_timestamp else None,
            "soh_percent":  latest_ana.soh_percent  if latest_ana else None,
            "soc_percent":  latest_ana.soc_percent  if latest_ana else None,
            "rul_cycles":   latest_ana.rul_cycles   if latest_ana else None,
            "risk_level":   latest_ana.risk_level   if latest_ana else None,
            "risk_score":   latest_ana.risk_score   if latest_ana else None,
        } if latest_ana else None,
    }
