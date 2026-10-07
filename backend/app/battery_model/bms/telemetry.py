"""
telemetry.py — Canonical BMS Telemetry JSON Packet Generator
================================================================
Battery Digital Twin | BMS Layer

Generates canonical BMS telemetry JSON packet matching Section 4 Contract:
  {
    "battery_id": "BRAIN001",
    "timestamp": "2026-10-07T10:30:00Z",
    "sequence": 1250,

    "pack": {
      "voltage_V": 48.2,
      "current_A": 20.5,
      "power_W": 988.1
    },

    "cells": [
      {
        "id": 1,
        "voltage_V": 3.85,
        "temperature_C": 32.4,
        "resistance_ohm": 0.021
      }
    ],

    "thermal": {
      "min_temperature_C": 31.8,
      "max_temperature_C": 33.1,
      "average_temperature_C": 32.4
    },

    "cooling": {
      "status": "OK",
      "flow_rate_LPM": 8.5
    },

    "battery": {
      "cycle_number": 75,
      "capacity_Ah": 1.85,
      "resistance_ohm": 0.035
    },

    "faults": {
      "status": "NORMAL",
      "active": []
    }
  }
"""

import json
import time
from datetime import datetime, timezone

def generate_bms_telemetry(bms_state: dict, sequence_counter: int = 1) -> dict:
    """Generate canonical telemetry JSON dict matching exact Section 4 contract."""
    iso_timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    current_time_ms = int(time.time() * 1000)

    cells_payload = []
    cell_temps = []
    for c in bms_state.get('sensed_cells', []):
        c_id = c.get('id', 1)
        if isinstance(c_id, str) and '-' in c_id:
            c_id = int(c_id.split('-')[-1])
        else:
            c_id = int(c_id)

        v_val = round(float(c.get('sensed_voltage_V', c.get('voltage', 3.6))), 3)
        t_val = round(float(c.get('sensed_temp_C', c.get('temperature', 28.0))), 2)
        r_val = round(float(c.get('internal_resistance', c.get('effective_resistance_ohm', c.get('resistance', 0.020)))), 4)

        cell_temps.append(t_val)
        cells_payload.append({
            'id': c_id,
            'voltage_V': v_val,
            'temperature_C': t_val,
            'resistance_ohm': r_val,
            # Legacy compatibility fields
            'cell_id': c_id,
            'voltage': v_val,
            'temperature': t_val,
            'resistance': r_val,
            'soc': round(float(c.get('soc', 75.0)), 1)
        })

    pack_v = round(float(bms_state.get('pack_voltage', 48.0)), 2)
    pack_i = round(float(bms_state.get('pack_current', 0.0)), 2)
    power_w = round(abs(pack_v * pack_i), 2)

    min_temp = round(min(cell_temps), 2) if cell_temps else 25.0
    max_temp = round(max(cell_temps), 2) if cell_temps else round(float(bms_state.get('max_temperature', 28.0)), 2)
    avg_temp = round(sum(cell_temps) / len(cell_temps), 2) if cell_temps else round(float(bms_state.get('avg_temperature', max_temp)), 2)

    active_faults = bms_state.get('active_faults', [])
    fault_status_str = bms_state.get('fault_status', 'NORMAL')
    fault_type_str = active_faults[0] if active_faults else "NONE"

    cooling_flow = round(float(bms_state.get('cooling_flow_LPM', 8.5)), 2)
    cooling_status = "OK" if "COOLING_FAILURE" not in active_faults else "FAULT"

    packet = {
        'battery_id': str(bms_state.get('battery_id', 'BRAIN001')),
        'timestamp': iso_timestamp,
        'sequence': int(sequence_counter),

        'pack': {
            'voltage_V': pack_v,
            'current_A': pack_i,
            'power_W': power_w,
            # Legacy aliases
            'voltage': pack_v,
            'current': pack_i,
            'power': power_w,
            'cycle_number': int(bms_state.get('cycle_number', 100))
        },

        'cells': cells_payload,

        'thermal': {
            'min_temperature_C': min_temp,
            'max_temperature_C': max_temp,
            'average_temperature_C': avg_temp,
            # Legacy aliases
            'max_temperature': max_temp,
            'average_temperature': avg_temp,
            'coolant_flow': cooling_flow
        },

        'cooling': {
            'status': cooling_status,
            'flow_rate_LPM': cooling_flow
        },

        'battery': {
            'cycle_number': int(bms_state.get('cycle_number', 100)),
            'capacity_Ah': round(float(bms_state.get('capacity_Ah', 2.45)), 2),
            'resistance_ohm': round(float(bms_state.get('internal_resistance_ohm', 0.021)), 4)
        },

        'faults': {
            'status': fault_status_str,
            'active': list(active_faults)
        },

        # Legacy root aliases
        'sequence_id': f"{sequence_counter:03d}",
        'time': current_time_ms,
        'pack_voltage': pack_v,
        'pack_current': pack_i,
        'max_temperature': max_temp,
        'cycle_number': int(bms_state.get('cycle_number', 100)),
        'fault_status': fault_status_str,
        'aging': {
            'capacity': round(float(bms_state.get('capacity_Ah', 2.45)), 2),
            'soh': round(float(bms_state.get('soh_percent', 98.0)), 1),
            'internal_resistance': round(float(bms_state.get('internal_resistance_ohm', 0.021)), 4)
        },
        'fault': {
            'status': fault_status_str,
            'type': fault_type_str
        }
    }

    return packet

def telemetry_to_json(telemetry_packet: dict, indent: int = None) -> str:
    return json.dumps(telemetry_packet, indent=indent)

