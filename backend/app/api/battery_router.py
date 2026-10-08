"""
battery_router.py — Complete REST & WebSocket API Router for Digital Twin Integration
======================================================================================
BRAIN – Battery Risk and Analytics Intelligence Network

Endpoints:
  GET  /health              — Service health check
  GET  /battery/telemetry   — Current telemetry packet (Canonical JSON)
  GET  /battery/history     — Rolling N=300 telemetry history buffer
  GET  /battery/status      — Overall battery health, temperature, fault state
  GET  /battery/cells       — Individual cell measurement details
  GET  /battery/parameters  — Physical battery parameters & thermal bounds
  POST /battery/scenario   — Controlled simulation scenario selection
  POST /battery/fault      — Causal parameter fault injection
  WS   /ws/telemetry       — Continuous 5 Hz WebSocket telemetry stream
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query, status
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from app.services.twin_service import twin_service

router = APIRouter(tags=["Digital Twin & Telemetry API"])

# ── Pydantic Request Schemas ──────────────────────────────────────────────────

class FaultInjectionRequest(BaseModel):
    fault_type: str = Field(..., example="high_resistance", description="Fault type: high_resistance, cooling_degradation, cooling_failure, cell_degradation, cell_imbalance, sensor_fault, normal")
    severity: Optional[float] = Field(0.30, ge=0.0, le=1.0, description="Fault severity factor")
    cell_id: Optional[int] = Field(5, ge=1, le=8, description="Target cell ID for localized fault")
    active: Optional[bool] = Field(True, description="True to activate fault, False to clear")

    class Config:
        json_schema_extra = {
            "example": {
                "fault_type": "high_resistance",
                "severity": 0.30,
                "cell_id": 5,
                "active": True
            }
        }

class ScenarioControlRequest(BaseModel):
    scenario: str = Field(..., example="NORMAL", description="Scenario: NORMAL, CHARGE, DISCHARGE, HIGH_LOAD, LOW_COOLING, AGING, FAULT_TEST")
    load_current_A: Optional[float] = Field(None, description="Optional custom load current in Amperes")

    class Config:
        json_schema_extra = {
            "example": {
                "scenario": "HIGH_LOAD",
                "load_current_A": 45.0
            }
        }

class TelemetryCell(BaseModel):
    id: int
    voltage_V: float
    temperature_C: float
    resistance_ohm: float = 0.021
    soc: Optional[float] = None

class ExternalTelemetryRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    battery_id: str
    timestamp: str
    sequence: int
    pack: Dict[str, Any]
    cells: List[TelemetryCell]
    thermal: Dict[str, Any]
    cooling: Dict[str, Any]
    battery: Dict[str, Any]
    faults: Dict[str, Any]
    predictions: Optional[Dict[str, Any]] = None
    transport: str = Field(..., description="Expected LAN Bluetooth bridge transport marker")

# ── REST API Endpoints ────────────────────────────────────────────────────────

@router.get("/health")
def get_health():
    """Service health check endpoint with database connectivity check."""
    from app.core.database import check_database_connection
    from app.core.config import settings
    
    is_db_connected = check_database_connection()
    return {
        "status": "ok" if is_db_connected else "degraded",
        "service": "brain-api",
        "environment": settings.ENVIRONMENT,
        "database": "connected" if is_db_connected else "disconnected",
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "telemetry_rate_hz": twin_service.telemetry_rate_hz,
        "history_buffer_size": twin_service.history_buffer_size
    }

@router.get("/battery/telemetry")
def get_latest_telemetry():
    """
    Get latest single canonical telemetry packet.
    Advances simulation step and returns current Virtual BMS sensor readings.
    """
    packet = twin_service.latest_telemetry if twin_service.has_fresh_external_telemetry() else twin_service.step_simulation()
    return packet

@router.post("/battery/telemetry/ingest")
def ingest_external_telemetry(req: ExternalTelemetryRequest):
    """Receive canonical 5 Hz Digital Twin packets over the shared Wi-Fi/LAN."""
    if req.transport != "LAN_BLUETOOTH_BRIDGE":
        raise HTTPException(status_code=400, detail="Unsupported telemetry transport")
    if twin_service.handshake_state != "CONNECTED":
        raise HTTPException(status_code=409, detail="No active Digital Twin handshake")
    packet = req.model_dump(exclude_none=True)
    twin_service.ingest_external_telemetry(packet)
    return {"status": "RECEIVED", "battery_id": req.battery_id, "sequence": req.sequence}

@router.get("/battery/history")
def get_telemetry_history(
    limit: Optional[int] = Query(300, ge=1, le=1000, description="Number of recent telemetry packets to return")
):
    """
    Get rolling history buffer of recent telemetry packets (N=300 by default).
    Used by dashboard live charts, feature engineering, and trend analysis.
    """
    history = twin_service.history_buffer
    if limit and limit < len(history):
        return history[-limit:]
    return history

@router.get("/battery/status")
def get_battery_status():
    """Get overall battery operational status, contactor state, active faults, and network connection metrics."""
    latest = twin_service.latest_telemetry
    pack = latest.get("pack", {})
    thermal = latest.get("thermal", {})
    cooling = latest.get("cooling", {})
    battery = latest.get("battery", {})
    faults = latest.get("faults", {})

    active_ws_count = len(twin_service.connected_websockets)
    is_connected = active_ws_count > 0 or twin_service.handshake_state == "CONNECTED"

    return {
        "battery_id": latest.get("battery_id", "BRAIN001"),
        "timestamp": latest.get("timestamp"),
        "fault_status": faults.get("status", "NORMAL"),
        "active_faults": faults.get("active", []),
        "pack_voltage_V": pack.get("voltage_V", 48.0),
        "pack_current_A": pack.get("current_A", 15.0),
        "max_temperature_C": thermal.get("max_temperature_C", 28.0),
        "avg_temperature_C": thermal.get("average_temperature_C", 28.0),
        "cooling_status": cooling.get("status", "OK"),
        "cooling_flow_LPM": cooling.get("flow_rate_LPM", 8.5),
        "cycle_number": battery.get("cycle_number", 75),
        "resistance_ohm": battery.get("resistance_ohm", 0.021),
        "active_connections": active_ws_count,
        "connection_status": "CONNECTED" if is_connected else "DISCONNECTED",
        "handshake_state": twin_service.handshake_state if is_connected else "DISCONNECTED (AWAITING MOBILE PAIRING)"
    }

class HandshakeRequest(BaseModel):
    step: str = Field("SYN", example="SYN", description="Handshake step: SYN, ACK, DISCONNECT")
    battery_id: Optional[str] = Field("BATTERY_PACK_01", example="BATTERY_PACK_01")
    client_id: Optional[str] = Field("MOBILE_APP", example="MOBILE_APP")

@router.post("/battery/handshake")
def perform_network_handshake(req: HandshakeRequest):
    """
    Perform 3-Way Handshake over network HTTP REST interface (SYN -> SYN-ACK -> ACK).
    Syncs pairing state across PC Digital Twin and Mobile Phone Web App over LAN / WAN.
    """
    step_upper = req.step.upper()
    if step_upper == "SYN":
        twin_service.handshake_state = "HANDSHAKING (SYN RECEIVED)"
        return {
            "status": "SYN-ACK",
            "step": "SYN-ACK",
            "battery_id": req.battery_id,
            "message": "SYN received. Digital Twin ready for ACK.",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        }
    elif step_upper in ["ACK", "ESTABLISHED"]:
        twin_service.handshake_state = "CONNECTED"
        return {
            "status": "ESTABLISHED",
            "step": "CONNECTED",
            "battery_id": req.battery_id,
            "message": "3-Way Handshake complete. Telemetry streaming active.",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        }
    else:
        twin_service.handshake_state = "DISCONNECTED"
        return {
            "status": "DISCONNECTED",
            "step": "DISCONNECTED",
            "battery_id": req.battery_id,
            "message": "Handshake session reset.",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        }

@router.get("/battery/cells")
def get_cell_telemetry():
    """Get detailed individual cell measurements (voltage, temperature, resistance)."""
    latest = twin_service.latest_telemetry
    cells = latest.get("cells", [])
    return {
        "battery_id": latest.get("battery_id", "BRAIN001"),
        "cell_count": len(cells),
        "cells": cells,
        "timestamp": latest.get("timestamp")
    }

@router.get("/battery/parameters")
def get_battery_parameters():
    """Get physical battery specifications, thermal constants, and safety bounds."""
    pack = twin_service.pack
    return {
        "battery_id": twin_service.battery_id,
        "chemistry": "LFP / NMC 8S Architecture",
        "nominal_voltage_V": 48.0,
        "nominal_capacity_Ah": 2.45,
        "cell_count": 8,
        "modules": 2,
        "cells_per_module": 4,
        "safety_bounds": {
            "overvoltage_limit_V": 4.25,
            "undervoltage_limit_V": 2.45,
            "overtemperature_limit_C": 60.0,
            "overcurrent_limit_A": 52.0,
            "max_imbalance_delta_V": 0.030
        },
        "cooling_spec": {
            "nominal_flow_LPM": 8.5,
            "coolant_type": "50/50 Water-Glycol"
        },
        "simulation_rate_hz": twin_service.telemetry_rate_hz
    }

@router.post("/battery/fault")
def inject_physical_fault(req: FaultInjectionRequest):
    """
    Inject or clear a causal parameter physical fault into the Digital Twin.
    Modifies physical parameters (resistance, heat generation, cooling efficiency)
    to cause realistic physical responses detected by Virtual BMS.
    """
    res = twin_service.apply_fault(
        fault_type=req.fault_type,
        severity=req.severity or 0.30,
        cell_id=req.cell_id or 5,
        active=req.active if req.active is not None else True
    )
    return res

@router.post("/battery/scenario")
def set_simulation_scenario(req: ScenarioControlRequest):
    """
    Apply controlled simulation scenario (NORMAL, CHARGE, DISCHARGE, HIGH_LOAD, LOW_COOLING, AGING, FAULT_TEST).
    Influences physical inputs rather than overriding outputs directly.
    """
    res = twin_service.set_scenario(scenario=req.scenario, load_current_A=req.load_current_A)
    return res

# ── Cloud Analytics & Historical Sync Endpoints ───────────────────────────────

cloud_sync_storage: Dict[str, Any] = {}

class CloudSyncPayload(BaseModel):
    batteryId: Optional[str] = "BATTERY_PACK_01"
    lastUpdated: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None
    recentHistory: Optional[List[Dict[str, Any]]] = None
    stressEvents: Optional[List[Dict[str, Any]]] = None

@router.post("/battery/cloud_sync")
def receive_cloud_sync(payload: CloudSyncPayload):
    """
    Receive & store detailed battery trends, stress event analytics, and historical snapshots in cloud repository.
    """
    battery_id = payload.batteryId or "BATTERY_PACK_01"
    cloud_sync_storage[battery_id] = {
        "batteryId": battery_id,
        "lastUpdated": payload.lastUpdated or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary": payload.summary,
        "recentHistory": payload.recentHistory or [],
        "stressEvents": payload.stressEvents or [],
        "status": "CLOUD_SYNCED"
    }
    return {
        "status": "SUCCESS",
        "message": f"Cloud analytics synced for battery {battery_id}",
        "timestamp": cloud_sync_storage[battery_id]["lastUpdated"]
    }

@router.get("/battery/cloud_sync")
def get_cloud_sync_data(battery_id: Optional[str] = "BATTERY_PACK_01"):
    """
    Retrieve stored cloud battery analytics and trends snapshot.
    """
    bid = battery_id or "BATTERY_PACK_01"
    if bid in cloud_sync_storage:
        return cloud_sync_storage[bid]
    return {
        "batteryId": bid,
        "status": "NO_CLOUD_DATA_BUFFERED",
        "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary": None,
        "recentHistory": [],
        "stressEvents": []
    }

# ── WebSocket Telemetry Stream ────────────────────────────────────────────────

@router.websocket("/ws/telemetry")
async def websocket_telemetry_stream(websocket: WebSocket):
    """
    WebSocket endpoint broadcasting continuous canonical telemetry packets at 5 Hz.
    Multiple frontend clients subscribe to the single running Digital Twin simulation loop.
    """
    await websocket.accept()
    await twin_service.register_websocket(websocket)
    try:
        while True:
            # Keep WebSocket connection alive and listen for client ping/messages
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        twin_service.unregister_websocket(websocket)
    except Exception:
        twin_service.unregister_websocket(websocket)
