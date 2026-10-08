"""
test_production_config.py — Tests for production hardening, database normalization, health endpoint, and CORS
===================================================================================================================
BRAIN EV Battery — Cloud Production Hardening Verification Suite
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app, get_database_type, get_sanitized_db_url
from app.core.config import Settings
from app.core.database import get_normalized_database_url, check_database_connection

client = TestClient(app)


def test_health_endpoint():
    """Verify GET /health returns expected status, service, environment, and database connectivity."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "brain-api"
    assert "environment" in data
    assert data["database"] == "connected"


def test_api_v1_health_endpoint():
    """Verify GET /api/v1/health returns matching health payload without route conflict."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "brain-api"
    assert data["database"] == "connected"


def test_postgresql_url_normalization():
    """Verify postgres:// is normalized to postgresql:// for SQLAlchemy driver compatibility."""
    heroku_url = "postgres://user:secret123@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
    normalized = get_normalized_database_url(heroku_url)
    assert normalized == "postgresql://user:secret123@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

    standard_url = "postgresql://user:secret123@db.supabase.com:5432/postgres"
    assert get_normalized_database_url(standard_url) == standard_url

    sqlite_url = "sqlite:///./brain_ev.db"
    assert get_normalized_database_url(sqlite_url) == sqlite_url


def test_missing_database_url_handling():
    """Verify empty/missing DATABASE_URL safely falls back to local SQLite default."""
    assert get_normalized_database_url("") == "sqlite:///./brain_ev.db"
    assert get_normalized_database_url(None) == "sqlite:///./brain_ev.db"


def test_cors_configuration_parsing():
    """Verify CORS origins string is cleanly split into a list of allowed origins."""
    s1 = Settings(CORS_ORIGINS="http://localhost:5173, https://dashboard.brain-ev.org")
    origins = s1.get_cors_origins()
    assert origins == ["http://localhost:5173", "https://dashboard.brain-ev.org"]

    s2 = Settings(CORS_ORIGINS="*")
    assert s2.get_cors_origins() == ["*"]

    s3 = Settings(CORS_ORIGINS=["http://custom-domain.com"])
    assert s3.get_cors_origins() == ["http://custom-domain.com"]


def test_production_startup_config_and_jwt_secret():
    """Verify JWT secret override and environment settings."""
    prod_settings = Settings(
        ENVIRONMENT="production",
        JWT_SECRET="prod_super_secret_key_999"
    )
    assert prod_settings.ENVIRONMENT == "production"
    assert prod_settings.get_jwt_secret() == "prod_super_secret_key_999"
    assert prod_settings.SECRET_KEY == "prod_super_secret_key_999"


def test_sensitive_db_url_sanitization():
    """Verify passwords in DATABASE_URL are masked for startup logging."""
    raw_url = "postgresql://postgres_user:super_secret_password_123@db.supabase.com:6543/postgres"
    sanitized = get_sanitized_db_url(raw_url)
    assert "super_secret_password_123" not in sanitized
    assert "postgres_user" not in sanitized
    assert "postgresql://***:***@db.supabase.com:6543/postgres" in sanitized


def test_database_type_identifier():
    """Verify database type helper identifies PostgreSQL vs SQLite correctly."""
    assert get_database_type("postgresql://...") == "PostgreSQL (Cloud/Supabase)"
    assert get_database_type("postgres://...") == "PostgreSQL (Cloud/Supabase)"
    assert get_database_type("sqlite:///./brain_ev.db") == "SQLite (Local File)"


def test_database_connection_check():
    """Verify check_database_connection executes lightweight query successfully."""
    assert check_database_connection() is True
