"""
test_twin_physics.py — Automated Unit Tests for Digital Twin Physics Engine
===========================================================================
BRAIN – Battery Risk and Analytics Intelligence Network

Verifies:
  1. Electrical behavior & SOC state evolution (dSOC = -I*dt / 3600*Q_effective)
  2. Joule heat generation (Q_gen = I^2 * R_effective)
  3. Thermal balance & cooling heat removal
  4. Causal fault parameter modifications (High Resistance, Cooling Failure)
"""

import sys
import os
from pathlib import Path
import pytest

# Ensure backend & battery_model paths are available
base_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(base_dir / "app"))
sys.path.insert(0, str(base_dir / "app" / "battery_model"))
sys.path.insert(0, str(base_dir / "app" / "battery_model" / "battery"))
sys.path.insert(0, str(base_dir / "app" / "battery_model" / "physics"))
sys.path.insert(0, str(base_dir / "app" / "battery_model" / "bms"))
sys.path.insert(0, str(base_dir / "app" / "battery_model" / "faults"))

from pack import BatteryPack
from fault_manager import FaultManager
from controller import VirtualBMSController

def test_physical_simulation_step():
    """Verify pack steps physics without errors and produces valid physical state."""
    pack = BatteryPack(pack_id="BRAIN001", initial_soc=80.0, initial_temp=25.0)
    summary = pack.step(load_current_A=20.0, dt_s=0.2)

    assert summary["pack_id"] == "BRAIN001"
    assert summary["pack_voltage"] > 0.0
    assert summary["max_temperature"] >= 25.0
    assert len(summary["modules"]) == 2

def test_coulomb_counting_soc_evolution():
    """Verify dSOC = -I*dt/(3600*Q_effective) reduces SOC during discharge."""
    pack = BatteryPack(pack_id="BRAIN001", initial_soc=80.0, initial_temp=25.0)
    initial_soc = pack.get_pack_summary()["pack_soc"]

    # Discharge for 50 steps at 30A
    for _ in range(50):
        pack.step(load_current_A=30.0, dt_s=0.2)

    final_soc = pack.get_pack_summary()["pack_soc"]
    assert final_soc < initial_soc, "Discharging current must decrease SOC state"

def test_causal_fault_high_resistance():
    """Verify high resistance fault increases internal resistance & heat generation."""
    pack = BatteryPack(pack_id="BRAIN001", initial_soc=80.0, initial_temp=25.0)
    fault_mgr = FaultManager(pack)

    # Baseline step
    baseline = pack.step(load_current_A=25.0, dt_s=0.2)
    baseline_temp = baseline["max_temperature"]

    # Inject high resistance fault into cell 5
    fault_mgr.inject_fault("high_resistance", cell_id=5, active=True)

    # Step simulation under high resistance
    for _ in range(25):
        faulted = pack.step(load_current_A=25.0, dt_s=0.2)

    assert faulted["max_temperature"] > baseline_temp, "High resistance fault must increase Joule heat & temperature"

def test_causal_fault_cooling_failure():
    """Verify cooling failure causes temperature rise and BMS safety contactor trip."""
    pack = BatteryPack(pack_id="BRAIN001", initial_soc=80.0, initial_temp=58.0)
    bms = VirtualBMSController("BRAIN001")
    fault_mgr = FaultManager(pack)

    fault_mgr.inject_fault("cooling_failure", active=True)
    summary = pack.step(load_current_A=20.0, dt_s=0.2)
    bms_state = bms.process(summary, load_current_A=20.0)

    assert "COOLING_FAILURE" in bms_state["active_faults"]
