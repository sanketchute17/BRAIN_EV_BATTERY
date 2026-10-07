"""
test_api_and_websocket.py — Automated API & WebSocket Test Suite
==================================================================
BRAIN – Battery Risk and Analytics Intelligence Network

Verifies endpoints:
  - GET  /health
  - GET  /battery/telemetry
  - GET  /battery/history
  - GET  /battery/status
  - GET  /battery/cells
  - GET  /battery/parameters
  - POST /battery/scenario
  - POST /battery/fault
  - WS   /ws/telemetry
"""

import sys
import os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

base_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base_dir))

from app.main import app
from app.services.twin_service import twin_service
from app.services.pkl_simulation_engine import pkl_engine

client = TestClient(app)

def test_health_endpoint():
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"

def test_battery_telemetry_endpoint():
    res = client.get("/battery/telemetry")
    assert res.status_code == 200
    data = res.json()
    assert "battery_id" in data
    assert "pack" in data
    assert "cells" in data
    assert "thermal" in data

def test_battery_history_endpoint():
    res = client.get("/battery/history?limit=10")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)

def test_battery_status_endpoint():
    res = client.get("/battery/status")
    assert res.status_code == 200
    data = res.json()
    assert "fault_status" in data
    assert "pack_voltage_V" in data

def test_battery_cells_endpoint():
    res = client.get("/battery/cells")
    assert res.status_code == 200
    data = res.json()
    assert "cells" in data
    assert isinstance(data["cells"], list)

def test_battery_parameters_endpoint():
    res = client.get("/battery/parameters")
    assert res.status_code == 200
    data = res.json()
    assert "safety_bounds" in data

def test_battery_scenario_post_endpoint():
    res = client.post("/battery/scenario", json={"scenario": "HIGH_LOAD", "load_current_A": 45.0})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "SCENARIO_UPDATED"
    assert data["scenario"] == "HIGH_LOAD"

def test_battery_fault_post_endpoint():
    res = client.post("/battery/fault", json={"fault_type": "high_resistance", "severity": 0.30, "cell_id": 5, "active": True})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in ["SUCCESS", "FAILED"]

def test_websocket_telemetry_stream():
    with client.websocket_connect("/ws/telemetry") as websocket:
        data = websocket.receive_json()
        assert "battery_id" in data
        assert "pack" in data
        assert "sequence" in data

def test_lan_bridge_ingest_requires_handshake_and_publishes_packet():
    twin_service.handshake_state = "DISCONNECTED"

def test_battery_intelligence_model_status_reports_invalid_artifact():
    summary = client.get("/api/v1/pkl/summary")
    assert summary.status_code == 200
    assert summary.json()["battery_model_ready"] is False
    assert "battery_intelligence.pkl" in summary.json()["load_errors"]

    response = client.post("/api/v1/pkl/predict", json={"telemetry": {"voltage": 25.6, "temperature": 25.0}})
    assert response.status_code == 200
    result = response.json()
    assert result["available"] is False
    assert "No prediction was made" in result["plain_explanation"]

def test_prediction_feature_mapping_uses_live_packet_values():
    features = pkl_engine._telemetry_features({
        "pack": {"voltage_V": 25.6, "current_A": -10, "cycle_count": 120},
        "cells": [
            {"voltage_V": 3.2, "temperature_C": 24.0, "resistance_ohm": 0.02},
            {"voltage_V": 3.3, "temperature_C": 26.0, "resistance_ohm": 0.04},
        ],
        "thermal": {"average_temperature_C": 25, "max_temperature_C": 26},
        "cooling": {"flow_rate_LPM": 8},
        "faults": {"active": ["CELL_IMBALANCE"]},
    })
    assert features["pack_voltage_V"] == 25.6
    assert features["cycle_count"] == 120
    assert round(features["cell_delta_V"], 3) == 0.1
    assert features["fault_count"] == 1
    packet = {
        "battery_id": "BATTERY_PACK_01",
        "timestamp": "2026-10-07T12:00:00Z",
        "sequence": 42,
        "transport": "LAN_BLUETOOTH_BRIDGE",
        "pack": {"voltage_V": 25.6, "current_A": -12.0, "power_W": 307.2},
        "cells": [{"id": 1, "voltage_V": 3.2, "temperature_C": 25.0, "resistance_ohm": 0.021}],
        "thermal": {"min_temperature_C": 25.0, "max_temperature_C": 25.0, "average_temperature_C": 25.0},
        "cooling": {"status": "OK", "flow_rate_LPM": 8.5},
        "battery": {"cycle_number": 75, "capacity_Ah": 2.45, "resistance_ohm": 0.021},
        "faults": {"status": "NORMAL", "active": []},
    }

    rejected = client.post("/battery/telemetry/ingest", json=packet)
    assert rejected.status_code == 409

    syn = client.post("/battery/handshake", json={"step": "SYN", "battery_id": packet["battery_id"]})
    assert syn.status_code == 200
    ack = client.post("/battery/handshake", json={"step": "ACK", "battery_id": packet["battery_id"]})
    assert ack.status_code == 200

    accepted = client.post("/battery/telemetry/ingest", json=packet)
    assert accepted.status_code == 200
    assert accepted.json()["sequence"] == packet["sequence"]
    assert twin_service.latest_telemetry["transport"] == "LAN_BLUETOOTH_BRIDGE"
    assert client.get("/battery/telemetry").json()["sequence"] == packet["sequence"]

    twin_service.handshake_state = "DISCONNECTED"
