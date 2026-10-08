# BRAIN EV Battery — Cloud Production Deployment Guide

This guide details the complete deployment process for hardening, hosting, and connecting the **BRAIN EV Battery Analytics & Digital Twin Cloud API** on production infrastructure.

---

## Architecture Overview

```
 ┌──────────────────────┐        HTTP REST (JSON) / WS        ┌───────────────────────────┐
 │                      │ ──────────────────────────────────> │                           │
 │  Digital Twin / BMS  │                                     │  BRAIN FastAPI Cloud API  │
 │  (Physical or Virtual│ <────────────────────────────────── │  (Render / AWS / Docker)  │
 └──────────────────────┘        Real-time Telemetry Stream   └─────────────┬─────────────┘
                                                                            │
                                                                 SQLAlchemy │ ORM
                                                                            ▼
                                                              ┌───────────────────────────┐
                                                              │  Supabase PostgreSQL DB   │
                                                              │  (Battery Isolation Storage)│
                                                              └───────────────────────────┘
```

---

## 1. Local Development Setup

1. **Navigate to the backend directory:**
   ```bash
   cd BRAIN_EV_BATTERY/backend
   ```

2. **Create a virtual environment and install dependencies:**
   ```bash
   python -m venv .venv
   # Windows
   .venv\Scripts\activate
   # Linux/macOS
   source .venv/bin/activate

   pip install -r requirements.txt
   ```

3. **Configure Local Environment Variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   By default, local development uses SQLite (`sqlite:///./brain_ev.db`).

4. **Run Local Server:**
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

5. **Run Test Suite:**
   ```bash
   python -m pytest tests/ -v
   ```

---

## 2. Supabase DATABASE_URL Setup

1. Create a project at [Supabase.com](https://supabase.com).
2. Navigate to **Project Settings -> Database -> Connection String -> URI**.
3. Select **Session Pooler** (recommended for serverless/containerized app connections) or **Direct Connection**.
4. Copy the connection string. It will look like:
   ```
   postgres://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
   ```
5. **PostgreSQL URL Normalization:** The BRAIN backend automatically normalizes `postgres://` connections to `postgresql://` required by SQLAlchemy drivers (`psycopg2-binary`).

---

## 3. Production Environment Variables

Configure the following environment variables in your cloud hosting provider dashboard:

| Variable Name | Required | Example / Value | Description |
| :--- | :---: | :--- | :--- |
| `ENVIRONMENT` | Yes | `production` | Set to `production` for security policies & logging |
| `DATABASE_URL` | Yes | `postgresql://postgres.xxx:pass@host:6543/postgres` | Supabase PostgreSQL Connection URI |
| `JWT_SECRET` | Yes | `e8f9a2b4c6d8...` (64 random hex chars) | Secure key for signing JWT auth tokens |
| `CORS_ORIGINS` | Yes | `https://brain-dashboard.vercel.app` | Comma-separated allowed web dashboard domains |
| `PORT` | Optional | `8000` (Assigned dynamically by Render) | Web server port |

> ⚠️ **CRITICAL SECURITY NOTE:** Never commit real database passwords or `JWT_SECRET` into version control.

---

## 4. Render Deployment Step-by-Step

1. **Connect Repository to Render:**
   - Log into [Render.com](https://render.com).
   - Create a new **Web Service** and link your Git repository.

2. **Configure Service Settings:**
   - **Root Directory:** `BRAIN_EV_BATTERY/backend`
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT`

3. **Add Environment Variables:**
   - In Render Dashboard -> **Environment**, add `ENVIRONMENT`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`.

4. **Deploy Service:**
   - Trigger manual deploy or push to main branch. Once complete, your cloud URL will be:
     `https://brain-ev-api.onrender.com`

---

## 5. Digital Twin Cloud Endpoint Configuration

To stream telemetry from a local Digital Twin or physical BMS bridge to the cloud instance:

1. **Target Ingestion API URL:**
   - Single Telemetry Ingestion: `POST https://brain-ev-api.onrender.com/api/v1/ingest/telemetry`
   - Batch Ingestion: `POST https://brain-ev-api.onrender.com/api/v1/ingest/telemetry/batch`
   - Analytics Snapshot: `POST https://brain-ev-api.onrender.com/api/v1/ingest/analytics`

2. **Authentication Header:**
   Include the JWT Bearer token obtained from `/api/v1/auth/login`:
   ```http
   Authorization: Bearer <YOUR_JWT_TOKEN>
   Content-Type: application/json
   ```

---

## 6. Remote API Access & Documentation

- **Swagger UI Interactive API Docs:**
  `GET https://brain-ev-api.onrender.com/api/v1/docs`
- **OpenAPI Schema Specification:**
  `GET https://brain-ev-api.onrender.com/api/v1/openapi.json`
- **System Health Check:**
  `GET https://brain-ev-api.onrender.com/health` or `GET https://brain-ev-api.onrender.com/api/v1/health`
  Response:
  ```json
  {
    "status": "ok",
    "service": "brain-api",
    "environment": "production",
    "database": "connected"
  }
  ```

---

## 7. WebSocket Streaming Access

Subscribing to real-time live telemetry over WebSocket:

- **Endpoint:** `wss://brain-ev-api.onrender.com/api/v1/ws/battery/{battery_id}/stream?token=<YOUR_JWT_TOKEN>`
- **Ping Interval:** Client sends periodic ping frame to keep proxy connections alive.
- **Data Format:** Canonical JSON Telemetry Packet (5 Hz).

---

## 8. Cloud Security & Compliance Requirements

1. **No Wildcard CORS in Production:**
   Wildcard `CORS_ORIGINS=*` is strictly disallowed when `ENVIRONMENT=production`. Specify explicit domains.
2. **Database Credential Isolation:**
   All DB connections require TLS/SSL encryption enabled automatically by Supabase.
3. **Data Isolation:**
   Each battery's telemetry, analytics, and fault logs are strictly isolated by `battery_id` foreign keys and indexed by `timestamp`.
4. **Log Sanitization:**
   Database connection strings logged at startup sanitize passwords (e.g. `postgresql://***:***@aws-0-us-east-1.pooler.supabase.com:6543/postgres`).
