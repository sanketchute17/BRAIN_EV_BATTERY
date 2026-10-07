"""
twin_service.py — Digital Twin Simulation Controller & Telemetry Service Loop
=============================================================================
BRAIN – Battery Risk and Analytics Intelligence Network

Single instance service managing:
  1. Digital Twin physical simulation loop (5 Hz by default).
  2. Virtual BMS ECU sensor processing.
  3. Canonical telemetry JSON generation.
  4. Rolling history buffer (N=300 packets).
  5. WebSocket real-time client broadcasting.
  6. Controlled scenario & causal fault injection.
"""

import sys
import os
import asyncio
import logging
import time
from typing import List, Dict, Any, Set
from datetime import datetime, timezone
from pathlib import Path

# Setup sys.path for battery_model imports
base_path = Path(__file__).resolve().parent.parent / "battery_model"
for p in [base_path, base_path / "battery", base_path / "bms", base_path / "faults", base_path / "calibration", base_path / "physics"]:
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

try:
    from pack import BatteryPack
    from fault_manager import FaultManager
    from controller import VirtualBMSController
    from telemetry import generate_bms_telemetry
    PHYSICS_AVAILABLE = True
except Exception as e:
    PHYSICS_AVAILABLE = False
    logging.warning(f"Physics Engine load error in twin_service: {e}")

# Environment / Configurable Constants
TELEMETRY_RATE_HZ = int(os.getenv("TELEMETRY_RATE_HZ", "5"))
HISTORY_BUFFER_SIZE = int(os.getenv("HISTORY_BUFFER_SIZE", "300"))

logger = logging.getLogger("twin_service")

class DigitalTwinService:
    """Singleton Digital Twin Service managing continuous physical simulation and telemetry stream."""

    def __init__(self, battery_id: str = "BRAIN001"):
        self.battery_id = battery_id
        self.telemetry_rate_hz = TELEMETRY_RATE_HZ
        self.history_buffer_size = HISTORY_BUFFER_SIZE
        
        self.dt_s = 1.0 / self.telemetry_rate_hz
        self.sequence_counter = 0
        self.is_running = False
        self.handshake_state = "DISCONNECTED"
        self.external_telemetry_received_at = 0.0
        
        # Simulation parameters & state
        self.load_current_A = 15.0
        self.sim_mode = "NORMAL"
        
        # History buffer (Rolling N items)
        self.history_buffer: List[Dict[str, Any]] = []
        
        # WebSocket client connections
        self.connected_websockets: Set[Any] = set()
        
        # Initialize Digital Twin Core
        if PHYSICS_AVAILABLE:
            self.pack = BatteryPack(pack_id=battery_id, initial_soc=80.0, initial_temp=28.0, cycle_count=75)
            self.fault_mgr = FaultManager(self.pack)
            self.bms = VirtualBMSController(battery_id=battery_id)
        else:
            self.pack = None
            self.fault_mgr = None
            self.bms = None

        self.latest_telemetry: Dict[str, Any] = self._generate_fallback_telemetry()
        self._loop_task: asyncio.Task = None

    def _generate_fallback_telemetry(self) -> Dict[str, Any]:
        """Fallback telemetry structure if physics core is initializing."""
        return {
            "battery_id": self.battery_id,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sequence": self.sequence_counter,
            "pack": {"voltage_V": 48.0, "current_A": 15.0, "power_W": 720.0},
            "cells": [{"id": i, "voltage_V": 3.42, "temperature_C": 28.0, "resistance_ohm": 0.021} for i in range(1, 9)],
            "thermal": {"min_temperature_C": 27.5, "max_temperature_C": 28.5, "average_temperature_C": 28.0},
            "cooling": {"status": "OK", "flow_rate_LPM": 8.5},
            "battery": {"cycle_number": 75, "capacity_Ah": 2.45, "resistance_ohm": 0.021},
            "faults": {"status": "NORMAL", "active": []}
        }

    def start(self):
        """Start continuous background simulation loop."""
        if self.is_running:
            return
        self.is_running = True
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                self._loop_task = loop.create_task(self._service_loop())
        except Exception as e:
            logger.warning(f"Could not bind service loop to asyncio event loop: {e}")

    def stop(self):
        """Stop simulation loop cleanly."""
        self.is_running = False
        if self._loop_task:
            self._loop_task.cancel()

    async def _service_loop(self):
        """Continuous service loop stepping simulation and broadcasting at TELEMETRY_RATE_HZ."""
        while self.is_running:
            start_time = asyncio.get_event_loop().time()
            try:
                if not self.has_fresh_external_telemetry():
                    self.step_simulation()
                await self.broadcast_latest_telemetry()
            except Exception as e:
                logger.error(f"Error in Digital Twin service loop: {e}")

            elapsed = asyncio.get_event_loop().time() - start_time
            sleep_time = max(0.001, self.dt_s - elapsed)
            await asyncio.sleep(sleep_time)

    def step_simulation(self) -> Dict[str, Any]:
        """Advance physical simulation step, generate telemetry, and update history buffer."""
        self.sequence_counter += 1

        if PHYSICS_AVAILABLE and self.pack and self.bms:
            # Mode specific load current logic
            curr = self.load_current_A
            if self.sim_mode == "CHARGE":
                curr = -25.0
            elif self.sim_mode == "HIGH_LOAD":
                curr = 45.0
            elif self.sim_mode == "STANDBY":
                curr = 0.0

            summary = self.pack.step(load_current_A=curr, dt_s=self.dt_s)
            bms_state = self.bms.process(summary, load_current_A=curr)
            telemetry = generate_bms_telemetry(bms_state, sequence_counter=self.sequence_counter)
        else:
            telemetry = self._generate_fallback_telemetry()

        self.latest_telemetry = telemetry

        # Maintain rolling history buffer of size N=300
        self.history_buffer.append(telemetry)
        if len(self.history_buffer) > self.history_buffer_size:
            self.history_buffer.pop(0)

        return telemetry

    def has_fresh_external_telemetry(self) -> bool:
        """Return whether a LAN Digital Twin packet was received recently."""
        return time.monotonic() - self.external_telemetry_received_at < 2.0

    def ingest_external_telemetry(self, packet: Dict[str, Any]) -> Dict[str, Any]:
        """Publish a validated packet received from the Digital Twin over the LAN."""
        self.latest_telemetry = packet
        self.external_telemetry_received_at = time.monotonic()
        self.history_buffer.append(packet)
        if len(self.history_buffer) > self.history_buffer_size:
            self.history_buffer.pop(0)
        return packet

    async def register_websocket(self, websocket: Any):
        """Register frontend WebSocket client and send initial telemetry immediately."""
        self.connected_websockets.add(websocket)
        try:
            await websocket.send_json(self.latest_telemetry)
        except Exception as e:
            logger.warning(f"Error sending initial WS telemetry: {e}")

    def unregister_websocket(self, websocket: Any):
        """Remove disconnected WebSocket client cleanly."""
        self.connected_websockets.discard(websocket)

    async def broadcast_latest_telemetry(self):
        """Broadcast latest telemetry packet to all connected WebSocket clients."""
        if not self.connected_websockets:
            return
        
        disconnected = set()
        for ws in list(self.connected_websockets):
            try:
                await ws.send_json(self.latest_telemetry)
            except Exception:
                disconnected.add(ws)

        for ws in disconnected:
            self.unregister_websocket(ws)

    def apply_fault(self, fault_type: str, severity: float = 0.30, cell_id: int = 5, active: bool = True) -> Dict[str, Any]:
        """Inject or clear causal fault in Digital Twin physical engine."""
        if not PHYSICS_AVAILABLE or not self.fault_mgr:
            return {"status": "ERROR", "message": "Physics engine unavailable"}
        
        # Map fault string to causal parameters
        norm_fault = fault_type.lower()
        if "resistance" in norm_fault:
            res = self.fault_mgr.inject_fault("high_resistance", cell_id=cell_id, active=active)
        elif "cooling_failure" in norm_fault or "cooling_loss" in norm_fault:
            res = self.fault_mgr.inject_fault("cooling_failure", active=active)
        elif "cooling_degradation" in norm_fault or "low_cooling" in norm_fault:
            if active and self.pack:
                self.pack.set_cooling_flow(3.0) # Reduce cooling flow from 8.5 to 3.0 LPM
            elif self.pack:
                self.pack.set_cooling_flow(8.5)
            res = {"success": True, "fault": "cooling_degradation", "active": active}
        elif "degradation" in norm_fault:
            res = self.fault_mgr.inject_fault("cell_degradation", cell_id=cell_id, active=active)
        elif "imbalance" in norm_fault:
            res = self.fault_mgr.inject_fault("cell_imbalance", cell_id=cell_id, active=active)
        elif "sensor" in norm_fault:
            res = self.fault_mgr.inject_fault("sensor_failure", cell_id=cell_id, active=active)
        elif norm_fault in ["normal", "clear"]:
            if self.pack:
                self.pack.set_cooling_efficiency(1.0)
                self.pack.set_cooling_flow(8.5)
            res = self.fault_mgr.clear_all_faults()
        else:
            res = self.fault_mgr.inject_fault(fault_type, cell_id=cell_id, active=active)

        return {"status": "SUCCESS" if res.get("success", True) else "FAILED", "result": res}

    def set_scenario(self, scenario: str, load_current_A: float = None) -> Dict[str, Any]:
        """Apply controlled simulation scenario modifying inputs rather than overriding outputs."""
        scenario_upper = scenario.upper()
        self.sim_mode = scenario_upper

        if scenario_upper == "NORMAL":
            self.load_current_A = 15.0
            if self.pack:
                self.pack.set_cooling_efficiency(1.0)
                self.pack.set_cooling_flow(8.5)
                if self.fault_mgr:
                    self.fault_mgr.clear_all_faults()
        elif scenario_upper == "CHARGE":
            self.load_current_A = -25.0
        elif scenario_upper == "DISCHARGE":
            self.load_current_A = 15.0
        elif scenario_upper == "HIGH_LOAD":
            self.load_current_A = 45.0
        elif scenario_upper == "LOW_COOLING":
            if self.pack:
                self.pack.set_cooling_flow(2.5)
        elif scenario_upper == "AGING":
            if self.pack:
                self.pack.set_cycle_count(1200)
        elif scenario_upper == "FAULT_TEST":
            self.apply_fault("high_resistance", cell_id=5, active=True)

        if load_current_A is not None:
            self.load_current_A = load_current_A

        return {
            "status": "SCENARIO_UPDATED",
            "scenario": self.sim_mode,
            "load_current_A": self.load_current_A
        }

# Global singleton instance
twin_service = DigitalTwinService(battery_id="BRAIN001")
