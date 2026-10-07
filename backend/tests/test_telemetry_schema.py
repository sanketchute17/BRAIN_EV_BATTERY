"""
test_telemetry_schema.py — Automated Schema Validation Tests
=============================================================
BRAIN – Battery Risk and Analytics Intelligence Network

Verifies canonical telemetry JSON schema structure:
  - battery_id
  - timestamp (ISO 8601 string)
  - sequence (integer)
  - pack (voltage_V, current_A, power_W)
  - cells (id, voltage_V, temperature_C, resistance_ohm)
  - thermal (min_temperature_C, max_temperature_C, average_temperature_C)
  - cooling (status, flow_rate_LPM)
  - battery (cycle_number, capacity_Ah, resistance_ohm)
  - faults (status, active)
"""

import sys
import os
from pathlib import Path
import pytest

base_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(base_dir / "app"))
sys.path.insert(0, str(base_dir / "app" / "battery_model"))
sys.path.insert(0, str(base_dir / "app" / "battery_model" / "bms"))

from telemetry import generate_bms_telemetry

def test_canonical_telemetry_schema_validation():
    """Validate canonical JSON telemetry contract schema structure."""
    sample_bms_state = {
        'battery_id': 'BRAIN001',
        'pack_voltage': 48.2,
        'pack_current': 20.5,
        'max_temperature': 33.1,
        'min_temperature': 31.8,
        'avg_temperature': 32.4,
        'cycle_number': 75,
        'cooling_flow_LPM': 8.5,
        'capacity_Ah': 1.85,
        'internal_resistance_ohm': 0.035,
        'fault_status': 'NORMAL',
        'active_faults': [],
        'sensed_cells': [
            {'id': 1, 'sensed_voltage_V': 3.85, 'sensed_temp_C': 32.4, 'internal_resistance': 0.021},
            {'id': 2, 'sensed_voltage_V': 3.84, 'sensed_temp_C': 32.6, 'internal_resistance': 0.021}
        ]
    }

    packet = generate_bms_telemetry(sample_bms_state, sequence_counter=1250)

    # Required top-level keys
    required_root_keys = ["battery_id", "timestamp", "sequence", "pack", "cells", "thermal", "cooling", "battery", "faults"]
    for key in required_root_keys:
        assert key in packet, f"Missing required top-level key: {key}"

    # Verify types and structure
    assert isinstance(packet["battery_id"], str)
    assert isinstance(packet["timestamp"], str)
    assert isinstance(packet["sequence"], int)
    assert packet["sequence"] == 1250

    # Pack section
    assert "voltage_V" in packet["pack"]
    assert "current_A" in packet["pack"]
    assert "power_W" in packet["pack"]

    # Cells section
    assert isinstance(packet["cells"], list)
    assert len(packet["cells"]) == 2
    cell1 = packet["cells"][0]
    assert cell1["id"] == 1
    assert "voltage_V" in cell1
    assert "temperature_C" in cell1
    assert "resistance_ohm" in cell1

    # Thermal section
    assert "min_temperature_C" in packet["thermal"]
    assert "max_temperature_C" in packet["thermal"]
    assert "average_temperature_C" in packet["thermal"]

    # Cooling section
    assert packet["cooling"]["status"] in ["OK", "FAULT"]
    assert "flow_rate_LPM" in packet["cooling"]

    # Battery health section
    assert "cycle_number" in packet["battery"]
    assert "capacity_Ah" in packet["battery"]
    assert "resistance_ohm" in packet["battery"]

    # Faults section
    assert "status" in packet["faults"]
    assert isinstance(packet["faults"]["active"], list)
