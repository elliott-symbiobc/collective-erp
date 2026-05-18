"""
settings.py — Platform settings (logo upload, etc.)

GET  /settings/logo   — serve the current logo (public)
POST /settings/logo   — upload a new logo (auth required)
DELETE /settings/logo — reset to default (auth required)
"""

import os
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])

LOGO_PATH = Path("/app/uploads/logo.png")
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5 MB


def _require_user(request: Request) -> str:
    uid = request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return uid


@router.get("/logo")
def get_logo():
    if not LOGO_PATH.exists():
        raise HTTPException(status_code=404, detail="No custom logo uploaded")
    return FileResponse(
        str(LOGO_PATH),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.post("/logo")
async def upload_logo(request: Request, file: UploadFile = File(...)):
    _require_user(request)

    content_type = file.content_type or ""
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {content_type}. Use PNG, JPEG, SVG, or WebP.")

    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")

    LOGO_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOGO_PATH.write_bytes(data)
    logger.info("Logo uploaded (%d bytes)", len(data))

    return {"ok": True, "size": len(data)}


@router.delete("/logo")
def delete_logo(request: Request):
    _require_user(request)
    if LOGO_PATH.exists():
        LOGO_PATH.unlink()
    return {"ok": True}


# ── Platform settings (onboarding, colors, integrations) ─────────────────────

import json
import psycopg2

SETTINGS_KEYS = {
    "onboarding_complete", "primary_color", "dark_color",
    "anthropic_api_key", "google_client_id", "google_client_secret",
    "plaid_client_id", "plaid_secret", "plaid_env",
    "qbo_client_id", "qbo_client_secret",
    "deepgram_api_key", "openai_api_key",
    "granola_api_key",
    "org_name",
}


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _ensure_settings_table():
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS platform_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        conn.commit()
        cur.close()
    finally:
        conn.close()


def _get_all_settings() -> dict:
    try:
        conn = _get_conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM platform_settings")
            rows = cur.fetchall()
            cur.close()
        finally:
            conn.close()
        return {r[0]: r[1] for r in rows}
    except Exception:
        return {}


def _set_settings(updates: dict):
    conn = _get_conn()
    try:
        cur = conn.cursor()
        for k, v in updates.items():
            cur.execute("""
                INSERT INTO platform_settings (key, value, updated_at)
                VALUES (%s, %s, now())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
            """, (k, str(v) if v is not None else None))
        conn.commit()
        cur.close()
    finally:
        conn.close()


@router.get("/platform")
def get_platform_settings():
    _ensure_settings_table()
    settings = _get_all_settings()
    # Mask secret values
    masked = {}
    secret_keys = {"anthropic_api_key", "google_client_secret", "plaid_secret", "qbo_client_secret", "deepgram_api_key", "openai_api_key", "granola_api_key"}
    for k, v in settings.items():
        if k in secret_keys and v:
            masked[k] = "••••••••"
        else:
            masked[k] = v
    return masked


@router.patch("/platform")
async def update_platform_settings(request: Request):
    user = request.headers.get("X-User-Role")
    if user != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    allowed = {k: v for k, v in body.items() if k in SETTINGS_KEYS}
    if not allowed:
        raise HTTPException(status_code=400, detail="No valid keys provided")
    _ensure_settings_table()
    _set_settings(allowed)
    return {"ok": True, "updated": list(allowed.keys())}
