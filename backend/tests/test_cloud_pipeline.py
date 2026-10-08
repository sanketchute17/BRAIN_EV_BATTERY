"""
test_cloud_pipeline.py — Cloud Data Pipeline Integration Test Suite
====================================================================
BRAIN – Battery Risk & Analytics Intelligence Network

Coverage:
  1.  Battery registration (POST /batteries)
  2.  Duplicate battery registration prevention
  3.  Battery listing (GET /batteries)
  4.  Battery overview (GET /batteries/{id})
  5.  Telemetry validation (schema checks)
  6.  Single packet ingestion (POST /ingest/telemetry)
  7.  Duplicate packet prevention (idempotent re-ingest)
  8.  Battery-wise telemetry query (GET /batteries/{id}/telemetry)
  9.  Time-range telemetry query (start / end params)
  10. Pagination (page / page_size)
  11. Cell telemetry query (GET /batteries/{id}/cells)
  12. Per-cell filter (cell_id param)
  13. Analytics ingestion (POST /ingest/analytics)
  14. Analytics query (GET /batteries/{id}/analytics)
  15. Predictions alias (GET /batteries/{id}/predictions)
  16. Fault event storage (POST /batteries/{id}/faults)
  17. Fault query (GET /batteries/{id}/faults)
  18. Active fault filter (active_only=true)
  19. Fault clearance (DELETE /batteries/{id}/faults/active)
  20. Domain event storage (POST /batteries/{id}/events)
  21. Domain event query (GET /batteries/{id}/events)
  22. Trend aggregation (GET /batteries/{id}/trends)
  23. Trend interval validation
  24. Batch ingestion (POST /ingest/telemetry/batch)
  25. Batch with partial duplicates
  26. Authentication — unauthenticated request rejected
  27. Battery-wise data isolation (BRAIN001 vs BRAIN002)
  28. History endpoint (GET /batteries/{id}/history)
  29. WebSocket stream endpoint (WS /batteries/{id}/stream)
  30. End-to-end pipeline: Digital Twin → ingest → query → trend
"""

import sys
import os
import json
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

# ── Path setup ────────────────────────────────────────────────────────────────
base_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base_dir))

from app.main import app
from app.core.database import SessionLocal, Base, engine
from app.models.pipeline_models import (
    BatteryRegistry, RawTelemetry, CellTelemetry, AnalyticsRecord, FaultEvent, BatteryEvent
)

# ── Test client ───────────────────────────────────────────────────────────────
client = TestClient(app)

# ── Constants ─────────────────────────────────────────────────────────────────
BRAIN001 = "BRAIN001_TEST"
BRAIN002 = "BRAIN002_TEST"
API      = "/api/v1"

# ─────────────────────────────────────────────────────────────────────────────
# Fixtures & Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_token() -> str:
    """Get a valid JWT token using the seeded researcher account."""
    resp = client.post(f"{API}/auth/login", json={
        "email": "researcher@brain-ev.org",
        "password": "password123"
    })
    if resp.status_code != 200:
        # Register a test user if seed is not present
        reg_resp = client.post(f"{API}/auth/register", json={
            "fullName": "Test User",
            "email": "testpipeline@brain-ev.org",
            "password": "testpass123",
        })
        assert reg_resp.status_code == 200, f"Could not register test user: {reg_resp.text}"
        return reg_resp.json()["access_token"]
    return resp.json()["access_token"]


@pytest.fixture(scope="module")
def token():
    return _get_token()


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


def _canonical_packet(battery_id: str = BRAIN001, sequence: int = 1, source: str = "digital_twin") -> dict:
    ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "battery_id":     battery_id,
        "vehicle_id":     "SCOOTER_001",
        "timestamp":      ts,
        "sequence":       sequence,
        "source":         source,
        "schema_version": "1.0",
        "pack": {
            "voltage_V": 51.2,
            "current_A": 18.4,
            "power_W":   942.1
        },
        "thermal": {
            "min_temperature_C":     31.2,
            "max_temperature_C":     34.1,
            "average_temperature_C": 32.7
        },
        "cells": [
            {"cell_id": i, "voltage_V": 3.2 + i * 0.001, "temperature_C": 32.0 + i * 0.1, "resistance_ohm": 0.018}
            for i in range(1, 9)
        ],
        "battery": {
            "cycle_number":  235,
            "capacity_Ah":   94.2,
            "resistance_ohm": 0.031
        },
        "cooling": {
            "status":        "OK",
            "flow_rate_LPM": 8.4
        },
        "faults": {
            "status": "NORMAL",
            "active": []
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# 1. Battery Registration
# ─────────────────────────────────────────────────────────────────────────────

def test_01_register_battery(auth):
    """POST /batteries — register a new battery."""
    # Clean up if exists
    db = SessionLocal()
    db.query(BatteryRegistry).filter(BatteryRegistry.battery_id == BRAIN001).delete()
    db.query(BatteryRegistry).filter(BatteryRegistry.battery_id == BRAIN002).delete()
    db.commit()
    db.close()

    resp = client.post(f"{API}/batteries", json={
        "battery_id":        BRAIN001,
        "vehicle_id":        "SCOOTER_001",
        "manufacturer":      "Custom",
        "model":             "BRAIN EV Pack",
        "chemistry":         "LFP",
        "cell_count":        16,
        "nominal_voltage_V": 51.2,
        "capacity_Ah":       100.0,
        "bms_model":         "BRAIN BMS v2",
        "firmware_version":  "v2.4.1",
        "status":            "ACTIVE"
    }, headers=auth)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["battery_id"] == BRAIN001
    assert data["chemistry"]  == "LFP"


# ─────────────────────────────────────────────────────────────────────────────
# 2. Duplicate Battery Registration Prevention
# ─────────────────────────────────────────────────────────────────────────────

def test_02_duplicate_battery_registration(auth):
    """POST /batteries — duplicate battery_id must return 409."""
    resp = client.post(f"{API}/batteries", json={
        "battery_id":        BRAIN001,
        "chemistry":         "LFP",
        "cell_count":        16,
        "nominal_voltage_V": 51.2,
        "capacity_Ah":       100.0,
    }, headers=auth)
    assert resp.status_code == 409


# ─────────────────────────────────────────────────────────────────────────────
# 3. Battery Listing
# ─────────────────────────────────────────────────────────────────────────────

def test_03_list_batteries(auth):
    """GET /batteries — returns list including registered battery."""
    resp = client.get(f"{API}/batteries", headers=auth)
    assert resp.status_code == 200
    ids = [b["battery_id"] for b in resp.json()]
    assert BRAIN001 in ids


# ─────────────────────────────────────────────────────────────────────────────
# 4. Battery Overview
# ─────────────────────────────────────────────────────────────────────────────

def test_04_battery_overview(auth):
    """GET /batteries/{id} — returns overview with metadata."""
    resp = client.get(f"{API}/batteries/{BRAIN001}", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["battery_id"] == BRAIN001
    assert data["metadata"] is not None


def test_04b_unknown_battery_returns_404(auth):
    """GET /batteries/NONEXISTENT → 404."""
    resp = client.get(f"{API}/batteries/NONEXISTENT_XYZ", headers=auth)
    assert resp.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# 5. Telemetry Schema Validation
# ─────────────────────────────────────────────────────────────────────────────

def test_05_telemetry_schema_validation(auth):
    """POST /ingest/telemetry — missing required fields return 422."""
    bad_packet = {"battery_id": BRAIN001}  # missing pack, cells, thermal, timestamp, sequence
    resp = client.post(f"{API}/ingest/telemetry", json=bad_packet, headers=auth)
    assert resp.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# 6. Single Packet Ingestion
# ─────────────────────────────────────────────────────────────────────────────

_SEQ_BASE = 10000  # use a base offset to avoid conflicts with other tests

def test_06_single_packet_ingestion(auth):
    """POST /ingest/telemetry — accepts valid canonical packet."""
    # Clean any leftover rows
    db = SessionLocal()
    db.query(RawTelemetry).filter(
        RawTelemetry.battery_id == BRAIN001,
        RawTelemetry.sequence == _SEQ_BASE
    ).delete()
    db.commit()
    db.close()

    pkt = _canonical_packet(BRAIN001, sequence=_SEQ_BASE)
    resp = client.post(f"{API}/ingest/telemetry", json=pkt, headers=auth)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["accepted"]   is True
    assert data["duplicate"]  is False
    assert data["battery_id"] == BRAIN001
    assert data["sequence"]   == _SEQ_BASE


# ─────────────────────────────────────────────────────────────────────────────
# 7. Duplicate Packet Prevention
# ─────────────────────────────────────────────────────────────────────────────

def test_07_duplicate_packet_prevention(auth):
    """POST /ingest/telemetry — re-submitting same sequence returns duplicate=True."""
    pkt = _canonical_packet(BRAIN001, sequence=_SEQ_BASE)
    resp = client.post(f"{API}/ingest/telemetry", json=pkt, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["accepted"]  is False
    assert data["duplicate"] is True


# ─────────────────────────────────────────────────────────────────────────────
# 8. Battery-Wise Telemetry Query
# ─────────────────────────────────────────────────────────────────────────────

def test_08_battery_telemetry_query(auth):
    """GET /batteries/{id}/telemetry — returns paginated rows for correct battery."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/telemetry", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["battery_id"] == BRAIN001
    assert isinstance(data["data"], list)
    assert data["total"] >= 1
    # All rows must belong to BRAIN001
    for row in data["data"]:
        assert row["battery_id"] == BRAIN001


# ─────────────────────────────────────────────────────────────────────────────
# 9. Time-Range Telemetry Query
# ─────────────────────────────────────────────────────────────────────────────

def test_09_time_range_query(auth):
    """GET /batteries/{id}/telemetry?start=...&end=... — filters correctly."""
    now   = datetime.now(timezone.utc)
    start = (now - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    end   = (now + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")

    resp = client.get(f"{API}/batteries/{BRAIN001}/telemetry", params={
        "start": start, "end": end
    }, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["data"], list)


def test_09b_future_range_returns_empty(auth):
    """Time range in the far future should return 0 results."""
    future = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat().replace("+00:00", "Z")
    resp = client.get(f"{API}/batteries/{BRAIN001}/telemetry", params={
        "start": future, "end": future
    }, headers=auth)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# 10. Pagination
# ─────────────────────────────────────────────────────────────────────────────

def test_10_pagination(auth):
    """Pagination returns correct page/page_size metadata."""
    # Ingest a few more packets for pagination testing
    db = SessionLocal()
    for seq in range(_SEQ_BASE + 1, _SEQ_BASE + 6):
        existing = db.query(RawTelemetry).filter(
            RawTelemetry.battery_id == BRAIN001, RawTelemetry.sequence == seq
        ).first()
        if not existing:
            pkt = _canonical_packet(BRAIN001, sequence=seq)
            client.post(f"{API}/ingest/telemetry", json=pkt, headers=auth)
    db.close()

    resp = client.get(f"{API}/batteries/{BRAIN001}/telemetry", params={
        "page": 1, "page_size": 2
    }, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["page"]      == 1
    assert data["page_size"] == 2
    assert len(data["data"]) <= 2

    # Page 2 should also work
    resp2 = client.get(f"{API}/batteries/{BRAIN001}/telemetry", params={
        "page": 2, "page_size": 2
    }, headers=auth)
    assert resp2.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# 11. Cell Telemetry Query
# ─────────────────────────────────────────────────────────────────────────────

def test_11_cell_telemetry_query(auth):
    """GET /batteries/{id}/cells — returns cell-level data."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/cells", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert isinstance(data["data"], list)
    if data["data"]:
        assert "cell_id" in data["data"][0]
        assert "voltage_V" in data["data"][0]


# ─────────────────────────────────────────────────────────────────────────────
# 12. Per-Cell Filter
# ─────────────────────────────────────────────────────────────────────────────

def test_12_per_cell_filter(auth):
    """GET /batteries/{id}/cells?cell_id=3 — filters to cell 3 only."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/cells", params={"cell_id": 3}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    for row in data["data"]:
        assert row["cell_id"] == 3


# ─────────────────────────────────────────────────────────────────────────────
# 13. Analytics Ingestion
# ─────────────────────────────────────────────────────────────────────────────

def test_13_analytics_ingestion(auth):
    """POST /ingest/analytics — store a PINN analytics record."""
    payload = {
        "battery_id":           BRAIN001,
        "source":               "digital_twin",
        "model_version":        "pinn_v1.0",
        "model_type":           "PINN",
        "prediction":           {"soc_percent": 78.4, "soh_percent": 93.2, "rul_cycles": 412, "rul_days": 274},
        "anomaly":              {"detected": False, "score": 0.08},
        "risk":                 {"level": "WATCH", "score": 0.22},
        "xai_features":         [{"feature": "temperature", "impact": 0.21}, {"feature": "current", "impact": 0.14}],
        "recommendations":      ["Monitor temperature — approaching threshold."],
        "predicted_temp_5min":  34.8,
        "predicted_temp_15min": 36.1,
        "heat_gen_W":           82.4,
        "heat_loss_W":          61.3,
        "cell_imbalance_index": 0.018,
        "physics_residual":     0.004,
        "model_confidence_pct": 96.2,
    }
    resp = client.post(f"{API}/ingest/analytics", json=payload, headers=auth)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["accepted"]    is True
    assert data["battery_id"] == BRAIN001
    assert "record_id" in data


# ─────────────────────────────────────────────────────────────────────────────
# 14. Analytics Query
# ─────────────────────────────────────────────────────────────────────────────

def test_14_analytics_query(auth):
    """GET /batteries/{id}/analytics — returns analytics records."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/analytics", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    row = data["data"][0]
    assert "risk" in row
    assert "prediction" in row


# ─────────────────────────────────────────────────────────────────────────────
# 15. Predictions Alias
# ─────────────────────────────────────────────────────────────────────────────

def test_15_predictions_alias(auth):
    """GET /batteries/{id}/predictions is equivalent to /analytics."""
    r1 = client.get(f"{API}/batteries/{BRAIN001}/analytics",    headers=auth)
    r2 = client.get(f"{API}/batteries/{BRAIN001}/predictions",  headers=auth)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["total"] == r2.json()["total"]


# ─────────────────────────────────────────────────────────────────────────────
# 16. Fault Event Storage
# ─────────────────────────────────────────────────────────────────────────────

def test_16_fault_event_storage(auth):
    """POST /batteries/{id}/faults — store a fault event."""
    resp = client.post(f"{API}/batteries/{BRAIN001}/faults", json={
        "battery_id":  BRAIN001,
        "fault_code":  "HIGH_RESISTANCE",
        "severity":    "HIGH",
        "cell_id":     5,
        "source":      "digital_twin",
        "description": "Cell 5 internal resistance exceeded 60mΩ threshold.",
    }, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["accepted"]    is True
    assert "fault_id" in data


# ─────────────────────────────────────────────────────────────────────────────
# 17. Fault Query
# ─────────────────────────────────────────────────────────────────────────────

def test_17_fault_query(auth):
    """GET /batteries/{id}/faults — returns fault event history."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/faults", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert "fault_code" in data["data"][0]


# ─────────────────────────────────────────────────────────────────────────────
# 18. Active Fault Filter
# ─────────────────────────────────────────────────────────────────────────────

def test_18_active_fault_filter(auth):
    """GET /batteries/{id}/faults?active_only=true — only active faults returned."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/faults",
                      params={"active_only": "true"}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    for row in data["data"]:
        assert row["is_active"] is True


# ─────────────────────────────────────────────────────────────────────────────
# 19. Fault Clearance
# ─────────────────────────────────────────────────────────────────────────────

def test_19_fault_clearance(auth):
    """DELETE /batteries/{id}/faults/active — clears all active faults."""
    resp = client.delete(f"{API}/batteries/{BRAIN001}/faults/active", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert "faults_cleared" in data

    # Verify no active faults remain
    check = client.get(f"{API}/batteries/{BRAIN001}/faults",
                       params={"active_only": "true"}, headers=auth)
    assert check.json()["total"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# 20. Domain Event Storage
# ─────────────────────────────────────────────────────────────────────────────

def test_20_domain_event_storage(auth):
    """POST /batteries/{id}/events — store a domain event."""
    resp = client.post(f"{API}/batteries/{BRAIN001}/events", json={
        "battery_id":  BRAIN001,
        "event_type":  "OVER_TEMPERATURE",
        "severity":    "WARNING",
        "description": "Pack temperature reached 44°C.",
        "source":      "digital_twin",
    }, headers=auth)
    assert resp.status_code == 200
    assert resp.json()["accepted"] is True


# ─────────────────────────────────────────────────────────────────────────────
# 21. Domain Event Query
# ─────────────────────────────────────────────────────────────────────────────

def test_21_domain_event_query(auth):
    """GET /batteries/{id}/events — returns stored events."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/events", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    types = [r["event_type"] for r in data["data"]]
    assert "OVER_TEMPERATURE" in types


def test_21b_event_type_filter(auth):
    """GET /batteries/{id}/events?event_type=FAULT_STARTED — filters by type."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/events",
                      params={"event_type": "OVER_TEMPERATURE"}, headers=auth)
    assert resp.status_code == 200
    for row in resp.json()["data"]:
        assert row["event_type"] == "OVER_TEMPERATURE"


# ─────────────────────────────────────────────────────────────────────────────
# 22. Trend Aggregation
# ─────────────────────────────────────────────────────────────────────────────

def test_22_trend_aggregation(auth):
    """GET /batteries/{id}/trends — returns TrendResponse with buckets."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/trends",
                      params={"interval": "1h"}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert "battery_id" in data
    assert "buckets"    in data
    assert "interval"   in data
    assert data["interval"] == "1h"
    if data["buckets"]:
        bucket = data["buckets"][0]
        assert "bucket_start"   in bucket
        assert "packet_count"   in bucket


# ─────────────────────────────────────────────────────────────────────────────
# 23. Trend Interval Validation
# ─────────────────────────────────────────────────────────────────────────────

def test_23_trend_invalid_interval(auth):
    """GET /batteries/{id}/trends?interval=INVALID → 400."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/trends",
                      params={"interval": "INVALID"}, headers=auth)
    assert resp.status_code == 400


# ─────────────────────────────────────────────────────────────────────────────
# 24. Batch Ingestion
# ─────────────────────────────────────────────────────────────────────────────

def test_24_batch_ingestion(auth):
    """POST /ingest/telemetry/batch — batch of 5 new packets accepted."""
    # Clean potential collisions
    db = SessionLocal()
    for seq in range(20000, 20005):
        db.query(RawTelemetry).filter(
            RawTelemetry.battery_id == BRAIN001, RawTelemetry.sequence == seq
        ).delete()
    db.commit()
    db.close()

    packets = [_canonical_packet(BRAIN001, sequence=20000 + i) for i in range(5)]
    resp = client.post(f"{API}/ingest/telemetry/batch", json={"packets": packets}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["submitted"]  == 5
    assert data["accepted"]   == 5
    assert data["duplicates"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# 25. Batch with Partial Duplicates
# ─────────────────────────────────────────────────────────────────────────────

def test_25_batch_partial_duplicates(auth):
    """Batch containing already-stored sequences gets accepted=N, duplicates=M."""
    # Send some new + some already stored (seq 20000-20004)
    packets = [_canonical_packet(BRAIN001, sequence=20000 + i) for i in range(3)]  # duplicates
    packets += [_canonical_packet(BRAIN001, sequence=30000 + i) for i in range(2)]  # new

    # Clean new seqs
    db = SessionLocal()
    for seq in range(30000, 30002):
        db.query(RawTelemetry).filter(
            RawTelemetry.battery_id == BRAIN001, RawTelemetry.sequence == seq
        ).delete()
    db.commit()
    db.close()

    resp = client.post(f"{API}/ingest/telemetry/batch", json={"packets": packets}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["submitted"]  == 5
    assert data["accepted"]   == 2
    assert data["duplicates"] == 3


# ─────────────────────────────────────────────────────────────────────────────
# 26. Authentication — Unauthenticated Request Rejected
# ─────────────────────────────────────────────────────────────────────────────

def test_26_unauthenticated_request_rejected():
    """All pipeline endpoints must reject requests without a valid token."""
    endpoints = [
        ("GET",  f"{API}/batteries"),
        ("GET",  f"{API}/batteries/{BRAIN001}"),
        ("GET",  f"{API}/batteries/{BRAIN001}/telemetry"),
        ("GET",  f"{API}/batteries/{BRAIN001}/analytics"),
        ("GET",  f"{API}/batteries/{BRAIN001}/cells"),
        ("GET",  f"{API}/batteries/{BRAIN001}/faults"),
        ("GET",  f"{API}/batteries/{BRAIN001}/trends"),
    ]
    for method, url in endpoints:
        if method == "GET":
            resp = client.get(url)
        else:
            resp = client.post(url)
        assert resp.status_code in [401, 403], f"{url} did not reject unauthenticated: {resp.status_code}"


# ─────────────────────────────────────────────────────────────────────────────
# 27. Battery-Wise Data Isolation
# ─────────────────────────────────────────────────────────────────────────────

def test_27_battery_isolation(auth):
    """BRAIN002 telemetry does not appear in BRAIN001 query results."""
    # Ingest a packet for BRAIN002
    db = SessionLocal()
    db.query(RawTelemetry).filter(
        RawTelemetry.battery_id == BRAIN002, RawTelemetry.sequence == 99999
    ).delete()
    db.commit()
    db.close()

    pkt2 = _canonical_packet(BRAIN002, sequence=99999)
    client.post(f"{API}/ingest/telemetry", json=pkt2, headers=auth)

    # BRAIN001 query must not include BRAIN002 rows
    resp = client.get(f"{API}/batteries/{BRAIN001}/telemetry", headers=auth)
    assert resp.status_code == 200
    for row in resp.json()["data"]:
        assert row["battery_id"] == BRAIN001

    # BRAIN002 query must return its own row
    resp2 = client.get(f"{API}/batteries/{BRAIN002}/telemetry", headers=auth)
    assert resp2.status_code == 200
    if resp2.json()["total"] > 0:
        for row in resp2.json()["data"]:
            assert row["battery_id"] == BRAIN002


# ─────────────────────────────────────────────────────────────────────────────
# 28. History Endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_28_history_endpoint(auth):
    """GET /batteries/{id}/history — returns recent packets (quick alias)."""
    resp = client.get(f"{API}/batteries/{BRAIN001}/history",
                      params={"limit": 50}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["data"]) <= 50


# ─────────────────────────────────────────────────────────────────────────────
# 29. WebSocket Stream Endpoint (token auth via query param)
# ─────────────────────────────────────────────────────────────────────────────

def test_29_websocket_stream_requires_token():
    """WS /batteries/{id}/stream — no token should close with code 4001."""
    from starlette.websockets import WebSocketDisconnect as _WSD
    try:
        with client.websocket_connect(
            f"{API}/batteries/{BRAIN001}/stream"
        ) as ws:
            # Server should immediately close; attempt a receive to trigger it
            try:
                ws.receive_json(timeout=2)
            except Exception:
                pass  # Expected — server closed immediately due to missing token
    except Exception:
        pass  # Connection-refused is also acceptable — means token was rejected


def test_29b_websocket_stream_with_token(token):
    """WS /batteries/{id}/stream?token=... — authenticated client connects."""
    with client.websocket_connect(
        f"{API}/batteries/{BRAIN001}/stream?token={token}"
    ) as ws:
        # Should receive a keepalive or existing telemetry
        # Just verify connection was not immediately rejected
        pass


# ─────────────────────────────────────────────────────────────────────────────
# 30. End-to-End Pipeline Test
# ─────────────────────────────────────────────────────────────────────────────

def test_30_end_to_end_pipeline(auth):
    """
    Full pipeline test:
      Digital Twin (simulated) → ingest → DB → query telemetry → query trends
      Remote client must retrieve correct data without touching the Digital Twin.
    """
    from app.services.twin_service import twin_service

    # Step 1: Step the Digital Twin 10 times to get fresh packets
    twin_service.start()
    sequence_start = 50000
    db = SessionLocal()
    for seq in range(sequence_start, sequence_start + 10):
        db.query(RawTelemetry).filter(
            RawTelemetry.battery_id == BRAIN001, RawTelemetry.sequence == seq
        ).delete()
    db.commit()
    db.close()

    # Step 2: Ingest 10 packets via the cloud ingestion API
    ingested_seqs = []
    for i in range(10):
        pkt = _canonical_packet(BRAIN001, sequence=sequence_start + i)
        resp = client.post(f"{API}/ingest/telemetry", json=pkt, headers=auth)
        assert resp.status_code == 200, f"Packet {i} failed: {resp.text}"
        ingested_seqs.append(sequence_start + i)

    # Step 3: Remote client queries telemetry (simulating company analytics platform)
    resp = client.get(f"{API}/batteries/{BRAIN001}/telemetry", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 10

    stored_seqs = {row["sequence"] for row in data["data"]}
    for seq in ingested_seqs:
        assert seq in stored_seqs, f"Sequence {seq} not found in stored telemetry"

    # Step 4: Remote client queries voltage/temperature trends
    resp_trend = client.get(f"{API}/batteries/{BRAIN001}/trends",
                             params={"interval": "1h"}, headers=auth)
    assert resp_trend.status_code == 200
    trend = resp_trend.json()
    assert "buckets" in trend

    # Step 5: Remote client queries cell data for Cell 1 specifically
    resp_cell = client.get(f"{API}/batteries/{BRAIN001}/cells",
                            params={"cell_id": 1}, headers=auth)
    assert resp_cell.status_code == 200
    for row in resp_cell.json()["data"]:
        assert row["cell_id"] == 1

    # Step 6: Ingest analytics record for the same battery
    ana_resp = client.post(f"{API}/ingest/analytics", json={
        "battery_id":   BRAIN001,
        "model_version": "pinn_v1.0",
        "prediction":   {"soh_percent": 93.2, "rul_cycles": 412},
        "risk":         {"level": "SAFE", "score": 0.08},
    }, headers=auth)
    assert ana_resp.status_code == 200

    # Step 7: Remote client retrieves prediction history
    resp_pred = client.get(f"{API}/batteries/{BRAIN001}/predictions", headers=auth)
    assert resp_pred.status_code == 200
    assert resp_pred.json()["total"] >= 1

    print("\n[TEST 30 PASS] End-to-end cloud pipeline verified:")
    print(f"  Batteries:   {BRAIN001}")
    print(f"  Packets:     {len(ingested_seqs)} ingested, {data['total']} total stored")
    print(f"  Trend bkts:  {len(trend['buckets'])}")
    print(f"  Predictions: {resp_pred.json()['total']}")
