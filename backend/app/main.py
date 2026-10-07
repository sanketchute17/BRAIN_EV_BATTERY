import sys
import os

# Ensure backend root directory is in sys.path so 'app' imports resolve cleanly anywhere
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base, SessionLocal
from app.models.all_models import User
from app.api import auth, pkl_router, bms_bluetooth

# Create database tables and seed default authorized user
def seed_database():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing_user = db.query(User).filter(User.email == "researcher@brain-ev.org").first()
        if not existing_user:
            default_user = User(
                email="researcher@brain-ev.org",
                password_hash=auth.hash_password("password123"),
                full_name="Dr. Alex Mercer (Lead Researcher)",
                mobile="+1 (555) 019-2834",
                role="RESEARCHER"
            )
            db.add(default_user)
            db.commit()
            print("[DB SEED] Successfully created default authorized user: researcher@brain-ev.org")
    except Exception as e:
        print(f"[DB SEED WARNING] Could not seed database: {e}")
        db.rollback()
    finally:
        db.close()

seed_database()


from app.api import auth, pkl_router, bms_bluetooth, battery_router
from app.services.twin_service import twin_service

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_lan_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

@app.on_event("startup")
async def on_startup():
    twin_service.start()
    lan_ip = get_lan_ip()
    port = int(os.environ.get("PORT", 8000))
    print("\n" + "=" * 68)
    print("[SERVER] BRAIN EV Digital Twin Telemetry & Virtual BMS Active!")
    print(f"[SERVER] Local PC Access:  http://localhost:{port}")
    print(f"[SERVER] Mobile Wi-Fi IP:  http://{lan_ip}:{port}")
    print(f"[SERVER] WebSocket Stream: ws://{lan_ip}:{port}/ws/telemetry")
    print("=" * 68 + "\n")

@app.on_event("shutdown")
async def on_shutdown():
    twin_service.stop()
    print("[TWIN SERVICE] Stopped Digital Twin simulation loop")

# Include API Routers
app.include_router(battery_router.router)
app.include_router(battery_router.router, prefix=settings.API_V1_STR)
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(pkl_router.router, prefix=settings.API_V1_STR)
app.include_router(bms_bluetooth.router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    return {
        "status": "ok",
        "system": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": f"{settings.API_V1_STR}/docs"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
