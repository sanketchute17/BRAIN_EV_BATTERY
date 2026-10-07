from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
import os
import shutil
from app.services.pkl_simulation_engine import pkl_engine
from app.core.config import settings

router = APIRouter(prefix="/pkl", tags=["PKL Simulation & Models"])

class BatteryPredictionRequest(BaseModel):
    telemetry: dict

@router.get("/summary")
def get_pkl_summary():
    """Returns summary of all loaded .pkl simulation datasets and ML models."""
    return pkl_engine.get_summary()

@router.post("/predict")
def predict_battery(request: BatteryPredictionRequest):
    """Predict from current battery telemetry with the registered battery intelligence model."""
    return pkl_engine.predict_battery_telemetry(request.telemetry)

@router.post("/upload")
async def upload_pkl_file(file: UploadFile = File(...)):
    """
    Upload a user .pkl simulation file or trained ML model.
    Saves file to backend/data/ and automatically registers it in the simulation engine.
    """
    if not file.filename.endswith('.pkl'):
        raise HTTPException(status_code=400, detail="Only .pkl files are accepted")

    target_path = os.path.join(settings.PKL_DATA_DIR, file.filename)
    try:
        with open(target_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Rescan PKL directory to pick up the new file immediately
        pkl_engine.scan_and_load_pkl_files()

        return {
            "message": f"Successfully uploaded and initialized '{file.filename}'",
            "filename": file.filename,
            "pkl_summary": pkl_engine.get_summary()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process PKL upload: {str(e)}")

@router.get("/simulate")
def sample_pkl_telemetry(filename: str = None, step_idx: int = 0):
    """
    Runs inference or samples step_idx telemetry frame from a specific loaded .pkl file.
    """
    return pkl_engine.run_inference_or_sample(filename=filename, step_idx=step_idx)
