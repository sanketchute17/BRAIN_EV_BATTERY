import sys
import os

# Ensure backend root directory is in sys.path so 'app' imports resolve cleanly anywhere
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base, SessionLocal
from app.models.all_models import User
from app.models import pipeline_models  # noqa: F401 — imported to register ORM classes with Base
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


from app.api import auth, pkl_router, bms_bluetooth, battery_router, pipeline_router
from app.services.twin_service import twin_service

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
)

# Environment-driven CORS configuration
cors_origins = settings.get_cors_origins()
if settings.ENVIRONMENT.lower() == "production" and "*" in cors_origins:
    cors_origins = [origin for origin in cors_origins if origin != "*"]
    if not cors_origins:
        cors_origins = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if cors_origins else ["*"],
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

def get_database_type(url: str) -> str:
    if "postgresql" in url or "postgres" in url:
        return "PostgreSQL (Cloud/Supabase)"
    elif "sqlite" in url:
        return "SQLite (Local File)"
    return url.split(":")[0] if ":" in url else "Unknown"

def get_sanitized_db_url(url: str) -> str:
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.password or parsed.username:
            sanitized_netloc = parsed.hostname or ""
            if parsed.port:
                sanitized_netloc += f":{parsed.port}"
            return f"{parsed.scheme}://***:***@{sanitized_netloc}{parsed.path}"
        return url
    except Exception:
        return "configured_db"

@app.on_event("startup")
async def on_startup():
    twin_service.start()
    
    # Startup Database Connectivity Check & Hardened Logging
    from app.core.database import check_database_connection, get_normalized_database_url
    db_connected = check_database_connection()
    normalized_db_url = get_normalized_database_url(settings.DATABASE_URL)
    db_type = get_database_type(normalized_db_url)
    sanitized_db = get_sanitized_db_url(normalized_db_url)
    
    lan_ip = get_lan_ip()
    port = int(os.environ.get("PORT", 8000))
    print("\n" + "=" * 68)
    print(f"[STARTUP] Environment:   {settings.ENVIRONMENT}")
    print(f"[STARTUP] API Version:   {settings.VERSION}")
    print(f"[STARTUP] Database Type: {db_type}")
    print(f"[STARTUP] DB Connection: {'CONNECTED' if db_connected else 'FAILED'}")
    print(f"[STARTUP] Sanitized DB:  {sanitized_db}")
    print(f"[SERVER] BRAIN EV Digital Twin Telemetry & Virtual BMS Active!")
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
# Cloud Data Pipeline v1 — battery-wise storage, ingestion, analytics, trends
app.include_router(pipeline_router.router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    return {
        "status": "ok",
        "system": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "docs": f"{settings.API_V1_STR}/docs"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)

