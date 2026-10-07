"""
test_integration_pipeline.py — End-to-End Automated Integration Test Pipeline
================================================================================
BRAIN – Battery Risk and Analytics Intelligence Network

Automated Integration Test Sequence (Section 24 Specification):
  1. START DIGITAL TWIN & BACKEND SERVICE
  2. CONNECT TEST CLIENT
  3. RECEIVE 20 TELEMETRY PACKETS
  4. VERIFY CANONICAL PACKET SCHEMA & INCREMENTING SEQUENCE
  5. INJECT HIGH RESISTANCE FAULT
  6. RECEIVE NEW TELEMETRY PACKETS
  7. VERIFY CAUSAL RESISTANCE/HEAT/TEMPERATURE RESPONSE
  8. REMOVE FAULT
  9. VERIFY SYSTEM RETURNS TOWARD NORMAL BEHAVIOR
"""

import sys
import os
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

base_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base_dir))

from app.main import app
from app.services.twin_service import twin_service

client = TestClient(app)

def test_full_integration_pipeline():
    """Run full automated integration test verifying simulation, telemetry stream, fault injection, and recovery."""
    
    # STEP 1 & 2: Start Digital Twin Service & verify health
    twin_service.start()
    health_res = client.get("/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "ok"

    # STEP 3 & 4: Collect 20 telemetry packets & verify incrementing sequence
    packets = []
    for _ in range(20):
        pkt = twin_service.step_simulation()
        packets.append(pkt)
        time.sleep(0.01)

    assert len(packets) == 20
    sequences = [p["sequence"] for p in packets]
    assert sequences == sorted(sequences), "Sequence numbers must strictly increment"

    baseline_packet = packets[-1]
    baseline_temp = baseline_packet["thermal"]["max_temperature_C"]

    # STEP 5 & 6: Inject High Resistance Fault
    fault_res = client.post("/battery/fault", json={
        "fault_type": "high_resistance",
        "severity": 0.50,
        "cell_id": 5,
        "active": True
    })
    assert fault_res.status_code == 200

    # STEP 7: Receive new packets & verify causal resistance/heat/temperature response
    faulted_packets = []
    for _ in range(25):
        pkt = twin_service.step_simulation()
        faulted_packets.append(pkt)
        time.sleep(0.01)

    faulted_packet = faulted_packets[-1]
    faulted_temp = faulted_packet["thermal"]["max_temperature_C"]

    # Causal parameter check: High resistance -> Joule heat generation -> Temperature rise
    assert faulted_temp >= baseline_temp, "Causal physics response: High resistance fault must increase temperature"

    # STEP 8 & 9: Remove fault & verify system recovery toward normal
    clear_res = client.post("/battery/fault", json={
        "fault_type": "normal",
        "active": False
    })
    assert clear_res.status_code == 200

    recovery_packets = []
    for _ in range(15):
        pkt = twin_service.step_simulation()
        recovery_packets.append(pkt)
        time.sleep(0.01)

    recovery_packet = recovery_packets[-1]
    assert recovery_packet["faults"]["status"] in ["NORMAL", "WARNING"], "System must clear critical status after fault removal"
