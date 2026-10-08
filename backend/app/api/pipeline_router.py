"""
pipeline_router.py — Cloud Data Pipeline REST + WebSocket API
=============================================================
BRAIN – Battery Risk & Analytics Intelligence Network

API Version: /api/v1  (all routes below are prefixed in main.py)

Battery Registry:
  GET  /batteries                                   → list all batteries
  POST /batteries                                   → register a battery
  GET  /batteries/{battery_id}                      → battery overview
  PUT  /batteries/{battery_id}                      → update battery metadata

Ingestion:
  POST /ingest/telemetry                            → single packet
  POST /ingest/telemetry/batch                      → batch upload
  POST /ingest/analytics                            → store analytics record

Query:
  GET  /batteries/{battery_id}/telemetry            → paginated raw telemetry
  GET  /batteries/{battery_id}/analytics            → paginated analytics
  GET  /batteries/{battery_id}/history              → last N raw packets (quick)
  GET  /batteries/{battery_id}/cells                → cell telemetry
  GET  /batteries/{battery_id}/faults               → fault events
  GET  /batteries/{battery_id}/events               → domain events
  GET  /batteries/{battery_id}/predictions          → alias for /analytics
  GET  /batteries/{battery_id}/sessions             → session summaries

Trends:
  GET  /batteries/{battery_id}/trends               → aggregated time-series

Streaming (WebSocket):
  WS   /batteries/{battery_id}/stream               → live 5 Hz telemetry per battery
  WS   /stream/telemetry                            → (existing) single-twin global stream

Authentication:
  All mutation endpoints + all query endpoints are protected by
  the existing JWT bearer token mechanism (get_current_user).
  The /ingest/ endpoints use the same token so that the Digital Twin
  or BMS bridge must authenticate before writing telemetry.
"""

import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Set, Any

from fastapi import (
    APIRouter, Depends, HTTPException, Query, Request,
    WebSocket, WebSocketDisconnect, status
)
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.all_models import User
from app.models.pipeline_models import BatteryRegistry
from app.schemas.pipeline_schemas import (
    BatteryMetadataCreate,
    BatteryMetadataResponse,
    CanonicalTelemetryPacket,
    BatchIngestRequest,
    BatchIngestResponse,
    IngestResponse,
    AnalyticsRecordCreate,
    FaultEventCreate,
    BatteryEventCreate,
    BatterySessionCreate,
)
from app.services import ingestion_service, query_service
from app.services.twin_service import twin_service

logger = logging.getLogger("pipeline_router")

router = APIRouter(tags=["Cloud Data Pipeline v1"])

# ─────────────────────────────────────────────────────────────────────────────
# Per-battery WebSocket connection manager
# ─────────────────────────────────────────────────────────────────────────────

class BatteryStreamManager:
    """Manages per-battery WebSocket subscriber sets."""

    def __init__(self):
        # battery_id → set of active WebSocket connections
        self._subs: dict[str, Set[WebSocket]] = {}

    def subscribe(self, battery_id: str, ws: WebSocket):
        self._subs.setdefault(battery_id, set()).add(ws)

    def unsubscribe(self, battery_id: str, ws: WebSocket):
        if battery_id in self._subs:
            self._subs[battery_id].discard(ws)

    async def broadcast(self, battery_id: str, payload: dict):
        dead: Set[WebSocket] = set()
        for ws in list(self._subs.get(battery_id, set())):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.unsubscribe(battery_id, ws)

    def subscriber_count(self, battery_id: str) -> int:
        return len(self._subs.get(battery_id, set()))


stream_manager = BatteryStreamManager()


# ─────────────────────────────────────────────────────────────────────────────
# 1. BATTERY REGISTRY
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries", response_model=list[BatteryMetadataResponse])
def list_batteries(
    organization_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all registered batteries. Optionally filter by organization_id."""
    return query_service.get_all_batteries(db, organization_id=organization_id)


@router.post("/batteries", response_model=BatteryMetadataResponse, status_code=201)
def register_battery(
    payload: BatteryMetadataCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Register a new battery with full metadata."""
    existing = db.query(BatteryRegistry).filter(
        BatteryRegistry.battery_id == payload.battery_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Battery '{payload.battery_id}' already registered.")

    reg = BatteryRegistry(
        battery_id        = payload.battery_id,
        vehicle_id        = payload.vehicle_id,
        manufacturer      = payload.manufacturer,
        model             = payload.model,
        chemistry         = payload.chemistry,
        cell_count        = payload.cell_count,
        nominal_voltage_V = payload.nominal_voltage_V,
        capacity_Ah       = payload.capacity_Ah,
        bms_model         = payload.bms_model,
        firmware_version  = payload.firmware_version,
        manufacture_date  = payload.manufacture_date,
        installation_date = payload.installation_date,
        status            = payload.status or "ACTIVE",
        organization_id   = payload.organization_id,
        fleet_id          = payload.fleet_id,
    )
    db.add(reg)
    db.commit()
    db.refresh(reg)
    return BatteryMetadataResponse.model_validate(reg)


@router.get("/batteries/{battery_id}")
def get_battery_overview(
    battery_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full overview: metadata + latest telemetry + latest analytics."""
    overview = query_service.get_battery_overview(battery_id, db)
    if overview["metadata"] is None:
        raise HTTPException(status_code=404, detail=f"Battery '{battery_id}' not found.")
    return overview


@router.put("/batteries/{battery_id}", response_model=BatteryMetadataResponse)
def update_battery(
    battery_id: str,
    payload: BatteryMetadataCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update battery metadata."""
    reg = db.query(BatteryRegistry).filter(BatteryRegistry.battery_id == battery_id).first()
    if not reg:
        raise HTTPException(status_code=404, detail=f"Battery '{battery_id}' not found.")

    for field, value in payload.model_dump(exclude_none=True).items():
        if field != "battery_id" and hasattr(reg, field):
            setattr(reg, field, value)
    reg.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(reg)
    return BatteryMetadataResponse.model_validate(reg)


# ─────────────────────────────────────────────────────────────────────────────
# 2. INGESTION
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/ingest/telemetry", response_model=IngestResponse)
async def ingest_telemetry(
    packet: CanonicalTelemetryPacket,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Primary ingestion endpoint.
    The Digital Twin calls this at 5 Hz. Physical BMS bridge uses the same endpoint.
    Returns acknowledgement with accepted/duplicate flags.
    """
    source_ip = request.client.host if request.client else None
    result = ingestion_service.ingest_single_packet(packet, db, source_ip=source_ip)

    # Broadcast to any per-battery WebSocket subscribers
    if result.accepted:
        await stream_manager.broadcast(
            packet.battery_id,
            {
                "battery_id":   packet.battery_id,
                "event_type":   "TELEMETRY",
                "schema_version": "1.0",
                "payload":      packet.model_dump(),
            }
        )
    return result


@router.post("/ingest/telemetry/batch", response_model=BatchIngestResponse)
async def ingest_telemetry_batch(
    body: BatchIngestRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Batch ingestion for offline-buffered or historical uploads.
    Up to 1000 packets per call. Each packet validated individually.
    Partial acceptance supported.
    """
    source_ip = request.client.host if request.client else None
    if not body.packets:
        raise HTTPException(status_code=400, detail="Empty packet list.")

    result = ingestion_service.ingest_batch(body.packets, db, source_ip=source_ip)
    return result


@router.post("/ingest/analytics")
def ingest_analytics(
    payload: AnalyticsRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Store a derived analytics/PINN result record.
    Only call with actual model outputs — do not fabricate values.
    """
    record_id = ingestion_service.store_analytics_record(payload, db)
    return {"accepted": True, "battery_id": payload.battery_id, "record_id": record_id}


# ─────────────────────────────────────────────────────────────────────────────
# 3. QUERY — RAW TELEMETRY
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries/{battery_id}/telemetry")
def get_battery_telemetry(
    battery_id: str,
    start:      Optional[str] = Query(None, description="ISO-8601 UTC start time"),
    end:        Optional[str] = Query(None, description="ISO-8601 UTC end time"),
    page:       int           = Query(1,   ge=1),
    page_size:  int           = Query(100, ge=1, le=1000),
    db:         Session       = Depends(get_db),
    current_user: User        = Depends(get_current_user),
):
    """
    Paginated raw telemetry for a battery.
    Supports time-range filtering and pagination.
    """
    return query_service.get_telemetry(battery_id, db, start=start, end=end,
                                        page=page, page_size=page_size)


@router.get("/batteries/{battery_id}/history")
def get_battery_history(
    battery_id: str,
    limit:      int     = Query(300, ge=1, le=1000),
    db:         Session = Depends(get_db),
    current_user: User  = Depends(get_current_user),
):
    """
    Quick endpoint: last N raw telemetry packets (no time-range filter).
    Intended for live dashboard chart refresh.
    """
    return query_service.get_telemetry(battery_id, db, page=1, page_size=limit)


# ─────────────────────────────────────────────────────────────────────────────
# 4. QUERY — ANALYTICS / PREDICTIONS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries/{battery_id}/analytics")
def get_battery_analytics(
    battery_id: str,
    start:      Optional[str] = Query(None),
    end:        Optional[str] = Query(None),
    page:       int           = Query(1,   ge=1),
    page_size:  int           = Query(100, ge=1, le=500),
    db:         Session       = Depends(get_db),
    current_user: User        = Depends(get_current_user),
):
    """Paginated analytics (SOC, SOH, RUL, risk, XAI) for a battery."""
    return query_service.get_analytics(battery_id, db, start=start, end=end,
                                        page=page, page_size=page_size)


# alias
@router.get("/batteries/{battery_id}/predictions")
def get_battery_predictions(
    battery_id: str,
    start:      Optional[str] = Query(None),
    end:        Optional[str] = Query(None),
    page:       int           = Query(1,   ge=1),
    page_size:  int           = Query(100, ge=1, le=500),
    db:         Session       = Depends(get_db),
    current_user: User        = Depends(get_current_user),
):
    """Alias for /analytics — returns PINN prediction records."""
    return query_service.get_analytics(battery_id, db, start=start, end=end,
                                        page=page, page_size=page_size)


# ─────────────────────────────────────────────────────────────────────────────
# 5. QUERY — CELL DATA
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries/{battery_id}/cells")
def get_battery_cells(
    battery_id: str,
    cell_id:    Optional[int] = Query(None, description="Filter to specific cell (1-indexed)"),
    start:      Optional[str] = Query(None),
    end:        Optional[str] = Query(None),
    page:       int           = Query(1,   ge=1),
    page_size:  int           = Query(200, ge=1, le=2000),
    db:         Session       = Depends(get_db),
    current_user: User        = Depends(get_current_user),
):
    """
    Per-cell telemetry with optional cell_id filter.
    Allows company analytics to show: 'Cell 3 voltage over 7 days'.
    """
    return query_service.get_cell_telemetry(battery_id, db, cell_id=cell_id,
                                             start=start, end=end,
                                             page=page, page_size=page_size)


# ─────────────────────────────────────────────────────────────────────────────
# 6. QUERY — FAULTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries/{battery_id}/faults")
def get_battery_faults(
    battery_id:  str,
    active_only: bool         = Query(False, description="Return only currently active faults"),
    start:       Optional[str]= Query(None),
    end:         Optional[str]= Query(None),
    page:        int          = Query(1,   ge=1),
    page_size:   int          = Query(100, ge=1, le=500),
    db:          Session      = Depends(get_db),
    current_user: User        = Depends(get_current_user),
):
    """Structured fault event history for a battery."""
    return query_service.get_faults(battery_id, db, active_only=active_only,
                                     start=start, end=end, page=page, page_size=page_size)


# ─────────────────────────────────────────────────────────────────────────────
# 7. QUERY — DOMAIN EVENTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries/{battery_id}/events")
def get_battery_events(
    battery_id: str,
    event_type: Optional[str] = Query(None, description="Filter by event_type"),
    start:      Optional[str] = Query(None),
    end:        Optional[str] = Query(None),
    page:       int           = Query(1,   ge=1),
    page_size:  int           = Query(100, ge=1, le=500),
    db:         Session       = Depends(get_db),
    current_user: User        = Depends(get_current_user),
):
    """Domain event log (CHARGE_STARTED, OVER_TEMPERATURE, etc.) for a battery."""
    return query_service.get_events(battery_id, db, event_type=event_type,
                                     start=start, end=end, page=page, page_size=page_size)


# ─────────────────────────────────────────────────────────────────────────────
# 8. QUERY — SESSIONS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries/{battery_id}/sessions")
def get_battery_sessions(
    battery_id: str,
    page:      int     = Query(1, ge=1),
    page_size: int     = Query(50, ge=1, le=200),
    db:        Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Charge/discharge/test session summaries for a battery."""
    return query_service.get_sessions(battery_id, db, page=page, page_size=page_size)


# ─────────────────────────────────────────────────────────────────────────────
# 9. TRENDS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batteries/{battery_id}/trends")
def get_battery_trends(
    battery_id: str,
    start:    Optional[str] = Query(None, description="ISO-8601 UTC start (default: last 24h)"),
    end:      Optional[str] = Query(None, description="ISO-8601 UTC end (default: now)"),
    interval: str           = Query("1h", description="Bucket interval: 1m 5m 15m 1h 6h 1d"),
    db:       Session       = Depends(get_db),
    current_user: User      = Depends(get_current_user),
):
    """
    Aggregated trend data (avg/min/max per bucket) for company dashboard.
    Pre-aggregated so the analytics platform does NOT need raw packet downloads.
    """
    valid_intervals = {"1m", "5m", "15m", "1h", "6h", "1d"}
    if interval not in valid_intervals:
        raise HTTPException(status_code=400, detail=f"interval must be one of {valid_intervals}")
    return query_service.get_trends(battery_id, db, start=start, end=end, interval=interval)


# ─────────────────────────────────────────────────────────────────────────────
# 10. MANUAL FAULT / EVENT ENDPOINTS (for Digital Twin to push structured data)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/batteries/{battery_id}/faults")
def record_fault(
    battery_id: str,
    payload: FaultEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Record a structured fault start event."""
    payload.battery_id = battery_id
    fault_id = ingestion_service.record_fault_event(payload, db)
    return {"accepted": True, "battery_id": battery_id, "fault_id": fault_id}


@router.delete("/batteries/{battery_id}/faults/active")
def clear_active_faults(
    battery_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear all currently active fault events for a battery."""
    count = ingestion_service.clear_active_faults(battery_id, db)
    return {"battery_id": battery_id, "faults_cleared": count}


@router.post("/batteries/{battery_id}/events")
def record_event(
    battery_id: str,
    payload: BatteryEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Store a domain event for a battery."""
    from app.models.pipeline_models import BatteryEvent
    import json as _json
    payload.battery_id = battery_id
    row = BatteryEvent(
        battery_id    = battery_id,
        event_type    = payload.event_type,
        severity      = payload.severity,
        description   = payload.description,
        source        = payload.source,
        metadata_json = _json.dumps(payload.metadata) if payload.metadata else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"accepted": True, "battery_id": battery_id, "event_id": row.id}


# ─────────────────────────────────────────────────────────────────────────────
# 11. PER-BATTERY WEBSOCKET STREAM
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/batteries/{battery_id}/stream")
async def battery_stream(
    battery_id: str,
    websocket: WebSocket,
    db: Session = Depends(get_db),
):
    """
    Per-battery real-time WebSocket stream.
    Remote company dashboard subscribes here to receive live telemetry for
    a specific battery without accessing the Digital Twin directly.

    Authentication: The client must pass the bearer token as a query parameter:
      ws://host/api/v1/batteries/BRAIN001/stream?token=<jwt>
    This is necessary because browsers cannot set Authorization headers on WS.
    """
    # ── Token auth for WebSocket ──────────────────────────────────────────────
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return

    from jose import jwt, JWTError
    from app.core.config import settings
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Invalid token claims")
    except (JWTError, ValueError):
        await websocket.close(code=4001, reason="Invalid token")
        return

    await websocket.accept()
    stream_manager.subscribe(battery_id, websocket)

    logger.info(f"[WS] Client subscribed to battery stream: {battery_id} "
                f"(total: {stream_manager.subscriber_count(battery_id)})")

    try:
        while True:
            # Keep connection alive; client pings are accepted but not required
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send a keepalive ping
                await websocket.send_json({
                    "battery_id": battery_id,
                    "event_type": "KEEPALIVE",
                    "schema_version": "1.0",
                    "payload": {
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                })
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning(f"[WS] Battery stream error for {battery_id}: {exc}")
    finally:
        stream_manager.unsubscribe(battery_id, websocket)
        logger.info(f"[WS] Client disconnected from battery stream: {battery_id}")
