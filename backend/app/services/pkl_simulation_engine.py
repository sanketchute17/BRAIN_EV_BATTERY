import os
import pickle
import numpy as np
import pandas as pd
import logging
import pickletools
from typing import Dict, Any, Optional

logger = logging.getLogger("BRAIN.PKLSampler")

class PKLSimulationEngine:
    """
    Robust Loader & Inference Engine for user-provided .pkl files.
    Supports:
    - Serialized Pandas DataFrames (Telemetry time-series)
    - Pre-trained ML Models (Scikit-Learn, XGBoost, PyTorch, Custom objects)
    - Dictionary-based simulation parameters and cycle logs
    """
    def __init__(self, pkl_dir: str):
        self.pkl_dir = pkl_dir
        self.loaded_models: Dict[str, Any] = {}
        self.loaded_datasets: Dict[str, Any] = {}
        self.load_errors: Dict[str, str] = {}
        self.scan_and_load_pkl_files()

    def scan_and_load_pkl_files(self):
        """Scans the directory for all .pkl files and loads them into memory."""
        self.loaded_models.clear()
        self.loaded_datasets.clear()
        self.load_errors.clear()
        if not os.path.exists(self.pkl_dir):
            os.makedirs(self.pkl_dir, exist_ok=True)
            logger.info(f"Created PKL storage directory at: {self.pkl_dir}")
            return

        pkl_files = [f for f in os.listdir(self.pkl_dir) if f.endswith('.pkl')]
        logger.info(f"Found {len(pkl_files)} .pkl files in {self.pkl_dir}")

        for filename in pkl_files:
            filepath = os.path.join(self.pkl_dir, filename)
            try:
                # Validate the pickle structure before unpickling. Pickle loading can execute
                # code, so only trusted artifacts should be placed in this directory.
                with open(filepath, 'rb') as f:
                    pickle_ops = pickletools.genops(f.read())
                    last_op = None
                    for last_op, _, _ in pickle_ops:
                        pass
                if last_op is None or last_op.name != 'STOP':
                    raise ValueError("Incomplete pickle stream (missing STOP marker)")

                with open(filepath, 'rb') as f:
                    content = pickle.load(f)
                
                if isinstance(content, (pd.DataFrame, pd.Series)):
                    self.loaded_datasets[filename] = {
                        "type": "DATAFRAME",
                        "shape": content.shape,
                        "data": content
                    }
                    logger.info(f"Loaded DataFrame PKL '{filename}': shape {content.shape}")
                elif hasattr(content, "predict"):
                    self.loaded_models[filename] = {
                        "type": "ML_MODEL",
                        "model": content
                    }
                    logger.info(f"Loaded ML Model PKL '{filename}' with predict() method.")
                elif isinstance(content, dict):
                    self.loaded_datasets[filename] = {
                        "type": "DICTIONARY",
                        "keys": list(content.keys()),
                        "data": content
                    }
                    logger.info(f"Loaded Dictionary PKL '{filename}' with keys: {list(content.keys())[:5]}")
                else:
                    self.loaded_datasets[filename] = {
                        "type": "GENERIC_OBJECT",
                        "data": content
                    }
                    logger.info(f"Loaded Generic Object PKL '{filename}'")
            except Exception as e:
                self.load_errors[filename] = str(e)
                logger.error(f"Failed to load PKL file '{filename}': {str(e)}")

    def get_summary(self) -> Dict[str, Any]:
        return {
            "loaded_models_count": len(self.loaded_models),
            "loaded_datasets_count": len(self.loaded_datasets),
            "models": list(self.loaded_models.keys()),
            "datasets": list(self.loaded_datasets.keys()),
            "load_errors": self.load_errors.copy(),
            "battery_model_ready": 'battery_intelligence.pkl' in self.loaded_models
        }

    @staticmethod
    def _telemetry_features(telemetry: Dict[str, Any]) -> Dict[str, float]:
        """Flatten common normalized BRAIN telemetry names into model feature names."""
        pack = telemetry.get('pack') or telemetry
        cells = telemetry.get('cells') or []
        thermal = telemetry.get('thermal') or telemetry.get('thermal_system') or {}
        cooling = telemetry.get('cooling') or telemetry.get('cooling_status') or {}
        battery = telemetry.get('battery') or {}
        predictions = telemetry.get('predictions') or {}
        faults = telemetry.get('faults') or {}
        voltages = [float(c.get('voltage_V', c.get('voltage', 0))) for c in cells]
        temperatures = [float(c.get('temperature_C', c.get('temperature', 0))) for c in cells]
        resistances = [float(c.get('resistance_ohm', c.get('effective_resistance_ohm', 0))) for c in cells]
        mean = lambda values: sum(values) / len(values) if values else 0.0
        voltage_min = min(voltages) if voltages else 0.0
        voltage_max = max(voltages) if voltages else 0.0
        active_faults = faults.get('active') or []
        return {
            'pack_voltage_V': float(pack.get('voltage_V', telemetry.get('voltage', 0)) or 0),
            'pack_current_A': float(pack.get('current_A', telemetry.get('current', 0)) or 0),
            'pack_temp_avg_C': float(thermal.get('average_temperature_C', thermal.get('avg_temperature_C', telemetry.get('temperature', mean(temperatures)))) or 0),
            'pack_temp_max_C': float(thermal.get('max_temperature_C', telemetry.get('maxTemperature', max(temperatures) if temperatures else 0)) or 0),
            'cell_voltage_mean': mean(voltages),
            'cell_voltage_min': voltage_min,
            'cell_voltage_max': voltage_max,
            'cell_delta_V': float(telemetry.get('cell_delta_V', voltage_max - voltage_min) or 0),
            'cell_voltage_std': float((sum((v - mean(voltages)) ** 2 for v in voltages) / len(voltages)) ** 0.5) if voltages else 0.0,
            'cycle_count': float(pack.get('cycle_count', pack.get('cycle_number', battery.get('cycle_number', telemetry.get('cycleCount', 0)))) or 0),
            'pack_soc_percent': float(pack.get('soc_percent', predictions.get('soc_percent', telemetry.get('soc', 0))) or 0),
            'soh_percent': float(predictions.get('soh_percent', telemetry.get('soh', 0)) or 0),
            'cell_temp_mean': mean(temperatures),
            'cell_temp_max': max(temperatures) if temperatures else float(thermal.get('max_temperature_C', 0) or 0),
            'effective_resistance_mean': mean(resistances),
            'cooling_flow': float(cooling.get('flow_rate_LPM', cooling.get('flow_lpm', 0)) or 0),
            'fault_count': float(len(active_faults) if isinstance(active_faults, list) else telemetry.get('fault_count', 0)),
            'contactor_closed': float(1 if (telemetry.get('bms_status', {}).get('contactor_state', 'CLOSED') == 'CLOSED') else 0),
        }

    def predict_battery_telemetry(self, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        """Run the trusted battery model only when it is loadable and its inputs are known."""
        filename = 'battery_intelligence.pkl'
        entry = self.loaded_models.get(filename)
        if not entry:
            reason = self.load_errors.get(filename, 'The battery model file is not registered as a prediction model.')
            return {
                'available': False,
                'model': filename,
                'plain_explanation': f"No prediction was made because the battery model could not be loaded: {reason}",
                'technical_reason': reason,
            }

        model = entry['model']
        feature_names = getattr(model, 'feature_names_in_', None)
        if feature_names is None:
            return {
                'available': False,
                'model': filename,
                'plain_explanation': 'The model loaded, but it does not identify the input names it was trained with. I will not guess the inputs and show a misleading result.',
                'technical_reason': 'Model is missing feature_names_in_.',
            }

        features = self._telemetry_features(telemetry)
        names = [str(name) for name in feature_names]
        missing = [name for name in names if name not in features]
        if missing:
            reason = f"Live battery data is missing model inputs: {', '.join(missing)}"
            return {'available': False, 'model': filename, 'plain_explanation': reason, 'technical_reason': reason}

        try:
            values = [features[name] for name in names]
            result = model.predict(pd.DataFrame([values], columns=names))
            raw = result[0].item() if hasattr(result[0], 'item') else result[0]
            if isinstance(raw, (int, float)):
                simple_result = f"The model's estimate is {raw:g}. The exact meaning and units depend on the model's training target."
            else:
                simple_result = f"The model classified the battery as: {str(raw)}."
            return {
                'available': True,
                'model': filename,
                'prediction': raw,
                'inputs_used': {name: features[name] for name in names},
                'plain_explanation': simple_result,
            }
        except Exception as e:
            reason = f"Model prediction failed: {e}"
            return {'available': False, 'model': filename, 'plain_explanation': reason, 'technical_reason': reason}


    def run_inference_or_sample(self, filename: Optional[str] = None, step_idx: int = 0) -> Dict[str, Any]:
        """
        Samples a telemetry frame or runs model prediction using the loaded .pkl file.
        Falls back to realistic synthetic battery dynamics if no .pkl is provided.
        """
        if filename and filename in self.loaded_models:
            model_obj = self.loaded_models[filename]["model"]
            try:
                # Sample input feature vector [Voltage, Current, Temp, SoC]
                dummy_features = np.array([[365.2, -18.5, 34.2, 0.82]])
                prediction = model_obj.predict(dummy_features)
                return {
                    "source": f"PKL_MODEL:{filename}",
                    "prediction": prediction.tolist() if hasattr(prediction, "tolist") else str(prediction),
                    "data_state": "PREDICTED"
                }
            except Exception as e:
                logger.warning(f"Inference failed on {filename}: {e}")

        if filename and filename in self.loaded_datasets:
            ds_info = self.loaded_datasets[filename]
            if ds_info["type"] == "DATAFRAME":
                df: pd.DataFrame = ds_info["data"]
                idx = step_idx % len(df)
                row = df.iloc[idx].to_dict()
                return {
                    "source": f"PKL_DATAFRAME:{filename}",
                    "step_idx": idx,
                    "telemetry": row,
                    "data_state": "REAL"
                }
            elif ds_info["type"] == "DICTIONARY":
                return {
                    "source": f"PKL_DICT:{filename}",
                    "keys": list(ds_info["data"].keys()),
                    "sample": {k: str(v)[:50] for k, v in list(ds_info["data"].items())[:5]},
                    "data_state": "SIMULATED"
                }

        # Baseline fallback telemetry frame generator
        return {
            "source": "SIMULATION_FALLBACK",
            "pack_voltage": 352.4,
            "pack_current": -14.2,
            "pack_temperature": 32.8,
            "soc": 84.5,
            "soh": 96.2,
            "data_state": "SIMULATED"
        }

# Global Instance
pkl_engine = PKLSimulationEngine(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data")))
