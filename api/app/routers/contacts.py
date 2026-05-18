"""
contacts.py — Contact relationship management endpoints.

GET    /contacts                        — list with search/filter/sort
POST   /contacts                        — create contact
GET    /contacts/graph                  — all nodes + edges for graph viz
GET    /contacts/reminders/active       — unresolved reminders (dashboard)
GET    /contacts/activities             — all interactions across all contacts (any user)
GET    /contacts/{id}                   — full contact detail
PATCH  /contacts/{id}                   — update fields
DELETE /contacts/{id}                   — archive
POST   /contacts/{id}/restore           — unarchive
POST   /contacts/{id}/interactions      — add manual interaction (note/call)
PATCH  /contacts/{id}/interactions/{iid} — edit an interaction (subject/content/type)
POST   /contacts/{id}/reminders         — create reminder
PATCH  /contacts/reminders/{rid}/resolve — resolve a reminder
DELETE /contacts/reminders/{rid}        — delete reminder
POST   /contacts/relationships          — link two contacts
DELETE /contacts/relationships/{rid}    — remove relationship
POST   /contacts/{id}/substrate-links   — link to substrate/TEA partner
DELETE /contacts/substrate-links/{lid}  — unlink substrate
POST   /contacts/{id}/enrich            — trigger AI web enrichment (async)
POST   /contacts/{id}/summarize         — trigger AI summary refresh (async)
GET    /contacts/google/auth            — generate Google OAuth URL
GET    /contacts/google/callback        — handle Google OAuth callback
GET    /contacts/google/status          — check Google connection for current user
DELETE /contacts/google/disconnect      — remove Google token
POST   /contacts/google/sync           — trigger immediate Gmail/Calendar sync
GET    /contacts/pending               — list pending contacts awaiting approval
POST   /contacts/pending/{id}/approve  — approve pending contact (creates full contact record)
DELETE /contacts/pending/{id}/dismiss  — dismiss pending contact
"""

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import urlencode, quote

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contacts", tags=["contacts"])

TAG_COLOR_PALETTE = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
    "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
    "#f59e0b", "#10b981", "#6366f1", "#a855f7", "#d946ef",
]

def _auto_tag_color(name: str) -> str:
    idx = int(hashlib.md5(name.lower().encode()).hexdigest(), 16) % len(TAG_COLOR_PALETTE)
    return TAG_COLOR_PALETTE[idx]

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive",
]


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _google_redirect_uri() -> str:
    base = os.environ.get("NEXTAUTH_URL", "https://platform.collectiveerp.io")
    return f"{base}/api/contacts/google/callback"


def _make_state(user_id: str) -> str:
    """Generate HMAC-signed state token encoding user_id."""
    secret = os.environ.get("SECRET_KEY", "changeme")
    ts = str(int(time.time()))
    payload = f"{user_id}:{ts}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_state(state: str) -> Optional[str]:
    """Verify state token and return user_id, or None if invalid."""
    try:
        secret = os.environ.get("SECRET_KEY", "changeme")
        parts = state.rsplit(":", 1)
        if len(parts) != 2:
            return None
        payload, sig = parts
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        uid_ts = payload.split(":", 1)
        if len(uid_ts) != 2:
            return None
        user_id, ts = uid_ts
        # State valid for 10 minutes
        if int(time.time()) - int(ts) > 600:
            return None
        return user_id
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ContactCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    organization: Optional[str] = None
    title: Optional[str] = None
    subject_areas: Optional[list[str]] = []
    tags: Optional[list[str]] = []
    notes: Optional[str] = None
    linkedin_url: Optional[str] = None
    website_url: Optional[str] = None
    avatar_url: Optional[str] = None


class ContactPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    organization: Optional[str] = None
    title: Optional[str] = None
    tagline: Optional[str] = None
    subject_areas: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None
    linkedin_url: Optional[str] = None
    website_url: Optional[str] = None
    avatar_url: Optional[str] = None
    company_id: Optional[str] = None
    is_client: Optional[bool] = None


class CompanyCreate(BaseModel):
    name: str
    website_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    company_type: Optional[str] = None
    company_location: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = []


class CompanyPatch(BaseModel):
    name: Optional[str] = None
    website_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    logo_url: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    company_type: Optional[str] = None
    company_location: Optional[str] = None
    description: Optional[str] = None
    esg_url: Optional[str] = None
    partnership_potential: Optional[str] = None
    regulatory_pressures: Optional[list[str]] = None
    government_incentives: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    notes: Optional[str] = None
    archived: Optional[bool] = None


class InteractionCreate(BaseModel):
    interaction_type: str  # note | call | email_sent | email_received | meeting
    subject: Optional[str] = None
    content_preview: Optional[str] = None
    full_content: Optional[str] = None
    occurred_at: Optional[str] = None  # ISO datetime, defaults to now
    direction: Optional[str] = None


class ReminderCreate(BaseModel):
    reminder_type: str = "follow_up"
    title: str
    description: Optional[str] = None
    due_date: Optional[str] = None  # ISO date


class RelationshipCreate(BaseModel):
    contact_a_id: str
    contact_b_id: str
    relationship_type: str = "colleague"
    description: Optional[str] = None
    strength: int = 3


class SubstrateLinkCreate(BaseModel):
    substrate_id: str
    role: str = "partner"
    notes: Optional[str] = None


class SendEmailRequest(BaseModel):
    subject: str
    body: str                          # plain text body
    cc: Optional[list[str]] = []       # additional CC addresses


class CalendarEventRequest(BaseModel):
    title: str
    description: Optional[str] = None
    start_datetime: str                # ISO 8601, e.g. "2026-04-15T14:00:00"
    end_datetime: str                  # ISO 8601
    timezone: str = "UTC"
    attendee_emails: Optional[list[str]] = []   # extra attendees beyond contact


# ---------------------------------------------------------------------------
# Google token helper (shared by send-email / calendar-event endpoints)
# ---------------------------------------------------------------------------

def _get_user_google_token(user_id: str) -> str:
    """Return a valid access token for user_id, refreshing if needed."""
    import httpx as _httpx
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM google_oauth_tokens WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="Google account not connected. Connect Gmail first.")

        # Refresh if expiring within 2 minutes
        expiry = row["token_expiry"]
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= expiry - timedelta(minutes=2):
            r = _httpx.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
                    "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
                    "refresh_token": row["refresh_token"],
                    "grant_type": "refresh_token",
                },
                timeout=15,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to refresh Google token")
            data = r.json()
            new_token = data["access_token"]
            new_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
            cur2 = conn.cursor()
            cur2.execute(
                "UPDATE google_oauth_tokens SET access_token=%s, token_expiry=%s, updated_at=NOW() WHERE user_id=%s",
                (new_token, new_expiry, user_id),
            )
            conn.commit()
            return new_token

        return row["access_token"]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# List + search
# ---------------------------------------------------------------------------

@router.get("")
def list_contacts(
    search: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),           # comma-separated
    subject_areas: Optional[str] = Query(None),   # comma-separated
    organization: Optional[str] = Query(None),
    sort: str = Query("last_interaction"),         # last_interaction | name | organization | created_at
    include_archived: bool = False,
    clients_only: bool = False,
):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        filters = []
        params: list = []

        if not include_archived:
            filters.append("c.archived = false")

        if search:
            filters.append(
                "(c.name ILIKE %s OR c.email ILIKE %s OR c.organization ILIKE %s OR c.title ILIKE %s)"
            )
            s = f"%{search}%"
            params.extend([s, s, s, s])

        if tags:
            tag_list = [t.strip() for t in tags.split(",") if t.strip()]
            if tag_list:
                filters.append("(c.tags && %s OR co.tags && %s)")
                params.append(tag_list)
                params.append(tag_list)

        if subject_areas:
            sa_list = [s.strip() for s in subject_areas.split(",") if s.strip()]
            if sa_list:
                filters.append("c.subject_areas && %s")
                params.append(sa_list)

        if organization:
            filters.append("c.organization ILIKE %s")
            params.append(f"%{organization}%")

        if clients_only:
            filters.append("c.is_client = true")

        where = ("WHERE " + " AND ".join(filters)) if filters else ""

        sort_col = {
            "last_interaction": "c.last_interaction_at DESC NULLS LAST",
            "name": "c.name ASC",
            "organization": "c.organization ASC NULLS LAST, c.name ASC",
            "created_at": "c.created_at DESC",
            "tag": "array_to_string(c.tags, ',') ASC NULLS LAST, c.name ASC",
        }.get(sort, "c.last_interaction_at DESC NULLS LAST")

        cur.execute(
            f"""
            SELECT
                c.contact_id, c.name, c.email, c.organization, c.title,
                c.tags, c.subject_areas, c.avatar_url,
                c.last_interaction_at, c.archived, c.created_at,
                c.ai_summary, c.tagline, c.is_client,
                c.company_id, co.name AS company_name,
                EXISTS (
                    SELECT 1 FROM project_contacts pc
                    WHERE pc.contact_id = c.contact_id AND pc.is_primary = true
                ) AS is_project_primary,
                COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'reminder_id', r2.reminder_id,
                            'title',        r2.title,
                            'reminder_type', r2.reminder_type,
                            'due_date',     r2.due_date
                        ) ORDER BY r2.due_date ASC NULLS LAST, r2.created_at ASC
                    )
                    FROM contact_reminders r2
                    WHERE r2.contact_id = c.contact_id AND r2.resolved = false
                ), '[]'::json) AS open_reminders,
                COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'task_id',  t2.task_id,
                            'title',    t2.title,
                            'source',   t2.source,
                            'due_date', t2.due_date
                        ) ORDER BY t2.due_date ASC NULLS LAST, t2.created_at ASC
                    )
                    FROM tasks t2
                    WHERE t2.contact_id = c.contact_id AND t2.status = 'open'
                ), '[]'::json) AS open_tasks
            FROM contacts c
            LEFT JOIN companies co ON co.company_id = c.company_id
            {where}
            ORDER BY {sort_col}
            """,
            params,
        )
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            row["pending_reminder_count"] = (
                len(row.get("open_reminders") or []) + len(row.get("open_tasks") or [])
            )
            rows.append(row)
        return {"contacts": rows, "total": len(rows)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Graph data
# ---------------------------------------------------------------------------

@router.get("/graph")
def get_graph():
    """Return all contacts as nodes and relationships as edges for visualization."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT contact_id AS id, name, organization, title, tags, subject_areas,
                   last_interaction_at, avatar_url
            FROM contacts
            WHERE archived = false
            ORDER BY name
            """
        )
        nodes = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT rel_id AS id, contact_a_id AS source, contact_b_id AS target,
                   relationship_type AS type, strength, description,
                   (relationship_type = 'inferred_email') AS inferred
            FROM contact_relationships cr
            WHERE EXISTS (SELECT 1 FROM contacts a WHERE a.contact_id = cr.contact_a_id AND NOT a.archived)
              AND EXISTS (SELECT 1 FROM contacts b WHERE b.contact_id = cr.contact_b_id AND NOT b.archived)
            """
        )
        links = [dict(r) for r in cur.fetchall()]
        return {"nodes": nodes, "links": links}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Dashboard reminders
# ---------------------------------------------------------------------------

@router.get("/reminders/active")
def get_active_reminders(limit: int = 10):
    """Active unresolved reminders for the dashboard widget."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT r.reminder_id, r.contact_id, c.name AS contact_name,
                   r.reminder_type, r.title, r.description, r.due_date,
                   r.auto_generated, r.created_at,
                   CASE WHEN r.due_date IS NOT NULL
                        THEN (CURRENT_DATE - r.due_date)::int
                        ELSE NULL END AS days_overdue
            FROM contact_reminders r
            JOIN contacts c ON c.contact_id = r.contact_id
            WHERE r.resolved = false AND c.archived = false
            ORDER BY r.due_date ASC NULLS LAST, r.created_at ASC
            LIMIT %s
            """,
            (limit,),
        )
        return {"reminders": [dict(r) for r in cur.fetchall()]}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# All-activities feed (must come before /{id} to avoid routing conflict)
# ---------------------------------------------------------------------------

@router.get("/activities")
def list_all_activities(
    interaction_type: Optional[str] = Query(None),  # comma-separated filter
    limit: int = Query(50),
    offset: int = Query(0),
):
    """Return recent interactions across all contacts, with contact metadata."""
    conn = _conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            filters = []
            params: list = []
            if interaction_type:
                types = [t.strip() for t in interaction_type.split(",") if t.strip()]
                if types:
                    filters.append("ci.interaction_type = ANY(%s)")
                    params.append(types)
            where = ("WHERE " + " AND ".join(filters)) if filters else ""
            params.extend([limit, offset])
            cur.execute(f"""
                SELECT
                    ci.interaction_id, ci.contact_id, ci.interaction_type,
                    ci.subject, ci.content_preview, ci.occurred_at,
                    ci.direction, ci.updated_at,
                    c.name  AS contact_name,
                    c.organization AS contact_org,
                    c.avatar_url   AS contact_avatar
                FROM contact_interactions ci
                JOIN contacts c ON c.contact_id = ci.contact_id
                {where}
                ORDER BY ci.occurred_at DESC
                LIMIT %s OFFSET %s
            """, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Google OAuth endpoints  (must come before /{id} to avoid routing conflict)
# ---------------------------------------------------------------------------

@router.get("/google/status")
def google_status(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        return {"connected": False}
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT google_email, updated_at FROM google_oauth_tokens WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        if row:
            return {"connected": True, "google_email": row["google_email"], "updated_at": row["updated_at"]}
        return {"connected": False}
    finally:
        conn.close()


@router.get("/google/auth")
def google_auth_start(request: Request):
    """Return Google OAuth URL for the current user to initiate the flow."""
    user_id = request.headers.get("X-User-Id")
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=400, detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID.")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    state = _make_state(user_id)
    params = {
        "client_id": client_id,
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    auth_url = GOOGLE_AUTH_URL + "?" + urlencode(params)
    return {"auth_url": auth_url}


@router.get("/google/callback")
def google_callback(code: str = None, state: str = None, error: str = None):
    """Handle Google OAuth callback. Exchanges code for tokens and stores them."""
    base_url = os.environ.get("NEXTAUTH_URL", "https://platform.collectiveerp.io")

    if error:
        return RedirectResponse(url=f"{base_url}/settings?google_error={error}")

    if not code or not state:
        return RedirectResponse(url=f"{base_url}/settings?google_error=missing_params")

    user_id = _verify_state(state)
    if not user_id:
        return RedirectResponse(url=f"{base_url}/settings?google_error=invalid_state")

    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return RedirectResponse(url=f"{base_url}/settings?google_error=not_configured")

    import httpx
    try:
        r = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": _google_redirect_uri(),
                "grant_type": "authorization_code",
            },
            timeout=30,
        )
        if r.status_code != 200:
            logger.error("Google token exchange failed: %s", r.text)
            return RedirectResponse(url=f"{base_url}/contacts?google_error=token_exchange_failed")

        tokens = r.json()
        access_token = tokens["access_token"]
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in", 3600)
        expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        # Get user's Google email
        userinfo = httpx.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        google_email = userinfo.json().get("email") if userinfo.status_code == 200 else None

        conn = _conn()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO google_oauth_tokens
                    (user_id, access_token, refresh_token, token_expiry, scopes, google_email)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    access_token  = EXCLUDED.access_token,
                    refresh_token = COALESCE(EXCLUDED.refresh_token, google_oauth_tokens.refresh_token),
                    token_expiry  = EXCLUDED.token_expiry,
                    scopes        = EXCLUDED.scopes,
                    google_email  = EXCLUDED.google_email,
                    updated_at    = NOW()
                """,
                (user_id, access_token, refresh_token, expiry, GOOGLE_SCOPES, google_email),
            )
            conn.commit()
        finally:
            conn.close()

        return RedirectResponse(url=f"{base_url}/settings?google_connected=1")

    except Exception as exc:
        logger.exception("google_callback error")
        return RedirectResponse(url=f"{base_url}/settings?google_error=server_error")


@router.delete("/google/disconnect")
def google_disconnect(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM google_oauth_tokens WHERE user_id = %s", (user_id,))
        conn.commit()
        return {"status": "disconnected"}
    finally:
        conn.close()


@router.post("/relationships/infer")
def infer_relationships(request: Request):
    """Trigger email-based relationship inference as a background task."""
    try:
        from app.worker import infer_relationships_task
        task = infer_relationships_task.delay()
        return {"status": "queued", "task_id": task.id}
    except Exception as exc:
        logger.error("Could not queue infer_relationships: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/google/sync")
def google_sync_now(request: Request):
    """Trigger immediate Gmail/Calendar/Contacts sync for current user."""
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        from app.worker import (
            sync_gmail_contacts_task,
            sync_calendar_contacts_task,
            sync_google_contacts_inbound_task,
        )
        sync_gmail_contacts_task.delay(user_id)
        sync_calendar_contacts_task.delay(user_id)
        sync_google_contacts_inbound_task.delay(user_id)
        return {"status": "queued"}
    except Exception as exc:
        logger.error("Could not queue sync: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/google/sync-status")
def google_sync_status(request: Request):
    """Return sync progress stats."""
    user_id = request.headers.get("X-User-Id")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Total contacts and those with email
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE NOT archived) AS total_contacts,
                COUNT(*) FILTER (WHERE NOT archived AND email IS NOT NULL) AS contacts_with_email,
                COUNT(*) FILTER (WHERE NOT archived AND last_interaction_at IS NOT NULL) AS contacts_with_interactions
            FROM contacts
        """)
        counts = dict(cur.fetchone())

        # Total interactions + breakdown
        cur.execute("""
            SELECT
                COUNT(*) AS total_interactions,
                COUNT(*) FILTER (WHERE interaction_type IN ('email_sent','email_received')) AS emails,
                COUNT(*) FILTER (WHERE interaction_type = 'meeting') AS meetings
            FROM contact_interactions
        """)
        interactions = dict(cur.fetchone())

        # Google token updated_at as proxy for last sync time
        last_sync = None
        if user_id:
            cur.execute("SELECT updated_at FROM google_oauth_tokens WHERE user_id = %s", (user_id,))
            row = cur.fetchone()
            if row:
                last_sync = row["updated_at"]

        return {
            **counts,
            **interactions,
            "last_sync": last_sync,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Resolve/delete reminder  (must come before /{id} routes)
# ---------------------------------------------------------------------------

@router.patch("/reminders/{reminder_id}/resolve")
def resolve_reminder(reminder_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            UPDATE contact_reminders
            SET resolved = true, resolved_at = NOW()
            WHERE reminder_id = %s
            RETURNING *
            """,
            (reminder_id,),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Reminder not found")
        # Mark linked task as done
        if row.get("task_id"):
            cur.execute(
                "UPDATE tasks SET status = 'done', updated_at = now() WHERE task_id = %s::uuid",
                (str(row["task_id"]),),
            )
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.delete("/reminders/{reminder_id}")
def delete_reminder(reminder_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "DELETE FROM contact_reminders WHERE reminder_id = %s RETURNING task_id",
            (reminder_id,),
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Reminder not found")
        # Remove linked task
        if row.get("task_id"):
            cur.execute("DELETE FROM tasks WHERE task_id = %s::uuid", (str(row["task_id"]),))
        conn.commit()
        return {"status": "deleted"}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Relationship management  (static routes before /{id})
# ---------------------------------------------------------------------------

@router.post("/relationships", status_code=201)
def create_relationship(body: RelationshipCreate):
    if body.contact_a_id == body.contact_b_id:
        raise HTTPException(status_code=422, detail="Cannot link a contact to itself")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO contact_relationships
                (contact_a_id, contact_b_id, relationship_type, description, strength)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (contact_a_id, contact_b_id, relationship_type) DO UPDATE
                SET description = EXCLUDED.description, strength = EXCLUDED.strength
            RETURNING *
            """,
            (body.contact_a_id, body.contact_b_id, body.relationship_type, body.description, body.strength),
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.patch("/relationships/{rel_id}")
def update_relationship(rel_id: str, body: dict):
    conn = _conn()
    try:
        cur = conn.cursor()
        fields = []
        vals = []
        if "relationship_type" in body:
            fields.append("relationship_type = %s"); vals.append(body["relationship_type"])
        if "description" in body:
            fields.append("description = %s"); vals.append(body["description"])
        if "strength" in body:
            fields.append("strength = %s"); vals.append(int(body["strength"]))
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        vals.append(rel_id)
        cur.execute(f"UPDATE contact_relationships SET {', '.join(fields)} WHERE rel_id = %s RETURNING rel_id", vals)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Relationship not found")
        conn.commit()
        return {"status": "updated"}
    finally:
        conn.close()


@router.delete("/relationships/{rel_id}")
def delete_relationship(rel_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM contact_relationships WHERE rel_id = %s RETURNING rel_id", (rel_id,))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Relationship not found")
        conn.commit()
        return {"status": "deleted"}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tag registry
# ---------------------------------------------------------------------------

@router.get("/tags")
def list_tags():
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT name, color FROM contact_tags ORDER BY name")
        return {"tags": [dict(r) for r in cur.fetchall()]}
    finally:
        conn.close()


@router.post("/tags", status_code=201)
def create_tag(body: dict):
    name = (body.get("name") or "").strip()
    color = body.get("color") or _auto_tag_color(name)
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT name, color FROM contact_tags WHERE LOWER(name) = LOWER(%s)", (name,))
        existing = cur.fetchone()
        if existing:
            # Return canonical name so the caller uses the existing casing
            return {"name": existing["name"], "color": existing["color"]}
        cur.execute("INSERT INTO contact_tags (name, color) VALUES (%s, %s)", (name, color))
        conn.commit()
        return {"name": name, "color": color}
    finally:
        conn.close()


@router.patch("/tags/{name}")
def update_tag_color(name: str, body: dict):
    color = body.get("color")
    if not color:
        raise HTTPException(status_code=400, detail="color required")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE contact_tags SET color = %s WHERE LOWER(name) = LOWER(%s)", (color, name))
        if cur.rowcount == 0:
            cur.execute("INSERT INTO contact_tags (name, color) VALUES (%s, %s)", (name, color))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Contact Suggestions (AI-powered, human-approved)
# ---------------------------------------------------------------------------

@router.get("/suggestions")
def list_suggestions():
    """Return all pending suggestions from the most recent scan batch."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT s.*, c.name AS target_name, c.email AS target_email,
                   c.organization AS target_org, c.title AS target_title,
                   c.avatar_url AS target_avatar
            FROM contact_suggestions s
            LEFT JOIN contacts c ON c.contact_id = s.target_contact_id
            WHERE s.scan_batch_id = (
                SELECT scan_batch_id FROM contact_suggestions
                ORDER BY created_at DESC LIMIT 1
            )
            ORDER BY s.suggestion_type DESC, s.created_at ASC
        """)
        rows = [dict(r) for r in cur.fetchall()]
        pending = [r for r in rows if r["status"] == "pending"]
        return {"suggestions": rows, "pending_count": len(pending)}
    finally:
        conn.close()


@router.get("/suggestions/scan")
def scan_for_suggestions(request: Request, max_emails: int = Query(40, ge=5, le=100)):
    """Scan Gmail inbox, compare against existing contacts, generate suggestions via Claude."""
    import uuid as _uuid
    import httpx as _httpx
    import anthropic
    import json as _json
    import re as _re

    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get Gmail token
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT access_token, refresh_token, token_expiry FROM google_oauth_tokens WHERE user_id = %s::uuid", (user_id,))
        token_row = cur.fetchone()
        if not token_row:
            raise HTTPException(status_code=400, detail="Google account not connected")

        # Load existing contacts for dedup
        cur.execute("""
            SELECT contact_id, name, LOWER(email) AS email, organization, title, phone, linkedin_url
            FROM contacts WHERE archived = false
        """)
        existing_contacts = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    # Refresh token if needed
    import httpx as _httpx
    from datetime import datetime, timezone
    token_expiry = token_row["token_expiry"]
    access_token = token_row["access_token"]
    if token_expiry and datetime.now(timezone.utc) >= token_expiry:
        r = _httpx.post("https://oauth2.googleapis.com/token", data={
            "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
            "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
            "refresh_token": token_row["refresh_token"],
            "grant_type": "refresh_token",
        }, timeout=15)
        if r.status_code == 200:
            access_token = r.json()["access_token"]

    # Fetch Gmail messages (combined inbox + sent for richer data)
    headers = {"Authorization": f"Bearer {access_token}"}
    messages_raw = []
    for label in ["INBOX", "SENT"]:
        r = _httpx.get(f"https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers=headers,
            params={"labelIds": label, "maxResults": max_emails // 2},
            timeout=20)
        if r.status_code == 200:
            messages_raw.extend(r.json().get("messages", []))

    if not messages_raw:
        return {"suggestions": [], "scan_batch_id": None, "message": "No emails found"}

    # Fetch metadata for each message
    emails = []
    seen_ids = set()
    for m in messages_raw[:max_emails]:
        if m["id"] in seen_ids:
            continue
        seen_ids.add(m["id"])
        resp = _httpx.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{m['id']}",
            headers=headers,
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "To", "Cc", "Date"]},
            timeout=15)
        if resp.status_code != 200:
            continue
        data = resp.json()
        hdrs = {h["name"].lower(): h["value"] for h in data.get("payload", {}).get("headers", [])}
        emails.append({
            "id": m["id"],
            "from": hdrs.get("from", ""),
            "to": hdrs.get("to", ""),
            "cc": hdrs.get("cc", ""),
            "subject": hdrs.get("subject", ""),
            "date": hdrs.get("date", ""),
            "snippet": data.get("snippet", "")[:200],
        })

    if not emails:
        return {"suggestions": [], "scan_batch_id": None, "message": "Could not read emails"}

    # Build existing contacts summary for Claude
    existing_summary = "\n".join(
        f"- name={c['name']} | email={c['email'] or 'none'} | org={c['organization'] or 'none'} | title={c['title'] or 'none'}"
        for c in existing_contacts[:300]
    )
    existing_emails_set = {c["email"] for c in existing_contacts if c["email"]}
    existing_names_lower = {c["name"].lower(): c for c in existing_contacts}

    email_list = "\n".join(
        f"[{i}] id={e['id']} | from={e['from']} | to={e['to']} | cc={e['cc']} | subject={e['subject']} | date={e['date']} | snippet={e['snippet']}"
        for i, e in enumerate(emails)
    )

    client = anthropic.Anthropic()
    prompt = f"""You are a CRM assistant analyzing emails to suggest contact additions and enrichments.

EXISTING CONTACTS (do NOT suggest these as new contacts):
{existing_summary}

RECENT EMAILS:
{email_list}

Your job:
1. FIND NEW CONTACTS: People who appear in From/To/Cc headers that are NOT already in the existing contacts list (match by email address or very similar name). Only suggest real business contacts — skip mailing lists, no-reply addresses, newsletters, automated senders.

2. FIND ENRICHMENTS: Existing contacts who are missing information that appears in the emails (e.g., a contact exists by name but has no email, or has no title/org but it appears in an email signature or header).

Return ONLY valid JSON (no markdown, no explanation):
{{
  "new_contacts": [
    {{
      "name": "Full Name",
      "email": "email@example.com",
      "organization": "Company Name or null",
      "title": "Job Title or null",
      "phone": null,
      "linkedin_url": null,
      "source_email_id": "gmail_message_id",
      "source_subject": "email subject",
      "source_from": "from header",
      "reason": "One sentence: why this person should be added"
    }}
  ],
  "enrichments": [
    {{
      "target_contact_name": "Existing Contact Name",
      "target_contact_email": "existing@email.com or null",
      "fields": {{"email": "new@email.com", "title": "CEO", "organization": "Acme Corp"}},
      "source_email_id": "gmail_message_id",
      "source_subject": "email subject",
      "source_from": "from header",
      "reason": "One sentence: what new info was found"
    }}
  ]
}}

Rules:
- Never suggest contacts with no-reply, noreply, mailer-daemon, postmaster, notifications, alerts, support@, info@ addresses
- Never suggest someone already in existing contacts (check by email first, then by name)
- For enrichments, only suggest fields the contact is actually missing
- Be conservative: prefer fewer high-quality suggestions over many low-quality ones
- Max 15 new contacts, max 10 enrichments"""

    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = resp.content[0].text.strip()

    # Parse Claude's response
    try:
        # Strip markdown code fences if present
        raw_clean = _re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=_re.MULTILINE).strip()
        parsed = _json.loads(raw_clean)
    except Exception:
        raise HTTPException(status_code=500, detail=f"Claude returned unparseable JSON: {raw[:300]}")

    batch_id = str(_uuid.uuid4())
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        inserted = []

        # Insert new contact suggestions
        for nc in parsed.get("new_contacts", [])[:15]:
            email = (nc.get("email") or "").strip().lower() or None
            name = (nc.get("name") or "").strip()
            if not name:
                continue
            # Hard dedup: skip if email already in contacts
            if email and email in existing_emails_set:
                continue
            # Skip if name is extremely similar to existing
            if name.lower() in existing_names_lower and not email:
                continue

            cur.execute("""
                INSERT INTO contact_suggestions
                  (suggestion_type, suggested_name, suggested_email, suggested_org,
                   suggested_title, suggested_phone, suggested_linkedin,
                   source_email_id, source_subject, source_from, reason, scan_batch_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING suggestion_id
            """, (
                "new_contact", name, email,
                nc.get("organization"), nc.get("title"),
                nc.get("phone"), nc.get("linkedin_url"),
                nc.get("source_email_id"), nc.get("source_subject"), nc.get("source_from"),
                nc.get("reason"), batch_id,
            ))
            inserted.append(dict(cur.fetchone()))

        # Insert enrichment suggestions
        for en in parsed.get("enrichments", [])[:10]:
            target_name = (en.get("target_contact_name") or "").strip()
            target_email = (en.get("target_contact_email") or "").strip().lower() or None
            fields = en.get("fields") or {}
            if not fields or not target_name:
                continue

            # Find matching contact
            target_contact_id = None
            if target_email:
                match = next((c for c in existing_contacts if c["email"] == target_email), None)
                if match:
                    target_contact_id = str(match["contact_id"])
            if not target_contact_id:
                match = existing_names_lower.get(target_name.lower())
                if match:
                    target_contact_id = str(match["contact_id"])
            if not target_contact_id:
                continue  # Can't find the contact to enrich

            cur.execute("""
                INSERT INTO contact_suggestions
                  (suggestion_type, target_contact_id, target_contact_name,
                   enrichment_fields, source_email_id, source_subject, source_from,
                   reason, scan_batch_id)
                VALUES (%s,%s::uuid,%s,%s,%s,%s,%s,%s,%s)
                RETURNING suggestion_id
            """, (
                "enrichment", target_contact_id, target_name,
                _json.dumps(fields),
                en.get("source_email_id"), en.get("source_subject"), en.get("source_from"),
                en.get("reason"), batch_id,
            ))
            inserted.append(dict(cur.fetchone()))

        conn.commit()

        # Return full suggestion list for this batch
        cur.execute("""
            SELECT s.*, c.name AS target_name, c.email AS target_email,
                   c.organization AS target_org, c.title AS target_title,
                   c.avatar_url AS target_avatar
            FROM contact_suggestions s
            LEFT JOIN contacts c ON c.contact_id = s.target_contact_id
            WHERE s.scan_batch_id = %s
            ORDER BY s.suggestion_type DESC, s.created_at ASC
        """, (batch_id,))
        suggestions = [dict(r) for r in cur.fetchall()]
        return {"suggestions": suggestions, "scan_batch_id": batch_id, "emails_scanned": len(emails)}
    finally:
        conn.close()


@router.patch("/suggestions/{suggestion_id}")
def review_suggestion(suggestion_id: str, body: dict, request: Request):
    """Approve or reject a suggestion. Approving a new_contact creates it; approving an enrichment patches the contact."""
    action = body.get("action")  # "approve" | "reject"
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    user_id = request.headers.get("X-User-Id")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM contact_suggestions WHERE suggestion_id = %s::uuid", (suggestion_id,))
        sug = cur.fetchone()
        if not sug:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        if sug["status"] != "pending":
            raise HTTPException(status_code=409, detail="Already reviewed")

        sug = dict(sug)
        result = {}

        if action == "approve":
            if sug["suggestion_type"] == "new_contact":
                cur.execute("""
                    INSERT INTO contacts (name, email, organization, title, phone, linkedin_url, tags, subject_areas)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING contact_id
                """, (
                    sug["suggested_name"], sug["suggested_email"],
                    sug["suggested_org"], sug["suggested_title"],
                    sug["suggested_phone"], sug["suggested_linkedin"],
                    [], [],
                ))
                new_id = cur.fetchone()["contact_id"]
                result["contact_id"] = str(new_id)

            elif sug["suggestion_type"] == "enrichment" and sug["target_contact_id"]:
                import json as _j
                fields = sug["enrichment_fields"] or {}
                allowed = {"email", "title", "organization", "phone", "linkedin_url", "website_url"}
                fields = {k: v for k, v in fields.items() if k in allowed and v}
                if fields:
                    set_clause = ", ".join(f"{k} = %s" for k in fields)
                    cur.execute(
                        f"UPDATE contacts SET {set_clause} WHERE contact_id = %s::uuid",
                        list(fields.values()) + [sug["target_contact_id"]],
                    )
                result["contact_id"] = str(sug["target_contact_id"])

        cur.execute("""
            UPDATE contact_suggestions
            SET status = %s, reviewed_at = NOW(), reviewed_by = %s::uuid
            WHERE suggestion_id = %s::uuid
        """, (action + "d", user_id, suggestion_id))
        conn.commit()
        return {"status": action + "d", **result}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Substrate link management (static routes)
# ---------------------------------------------------------------------------

@router.delete("/substrate-links/{link_id}")
def delete_substrate_link(link_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM contact_substrate_links WHERE link_id = %s RETURNING link_id", (link_id,))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Link not found")
        conn.commit()
        return {"status": "deleted"}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Create contact
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Pending contacts (Google import / Gmail activity — require human approval)
# ---------------------------------------------------------------------------

@router.get("/pending")
def list_pending_contacts(
    source: Optional[str] = Query(None),  # google_contacts | gmail_activity
    limit: int = Query(50),
    offset: int = Query(0),
):
    """List pending contacts awaiting approval."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        filters = ["status = 'pending'"]
        params: list = []
        if source:
            filters.append("source = %s")
            params.append(source)
        where = "WHERE " + " AND ".join(filters)
        params.extend([limit, offset])
        cur.execute(
            f"""
            SELECT pending_id, source, name, email, phone, organization, title,
                   google_resource_name, created_at
            FROM pending_contacts
            {where}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            params,
        )
        rows = [dict(r) for r in cur.fetchall()]
        cur.execute(f"SELECT COUNT(*) FROM pending_contacts {where}", params[:-2])
        total = cur.fetchone()["count"]
        return {"pending": rows, "total": total}
    finally:
        conn.close()


@router.post("/pending/{pending_id}/approve", status_code=201)
def approve_pending_contact(pending_id: str, request: Request):
    """
    Approve a pending contact: creates a full contact record and records the
    Google mapping so the outbound push does not create a duplicate.
    """
    user_id = request.headers.get("X-User-Id")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM pending_contacts WHERE pending_id = %s AND status = 'pending'",
            (pending_id,),
        )
        pending = cur.fetchone()
        if not pending:
            raise HTTPException(status_code=404, detail="Pending contact not found or already reviewed")

        # Guard: don't create a duplicate if email already exists
        if pending["email"]:
            cur.execute(
                "SELECT contact_id FROM contacts WHERE email = %s AND archived = false",
                (pending["email"],),
            )
            existing = cur.fetchone()
            if existing:
                # Mark approved and link the mapping instead of creating a duplicate
                contact_id = str(existing["contact_id"])
                if pending["google_resource_name"] and user_id:
                    cur.execute(
                        """
                        INSERT INTO contact_google_mappings
                            (contact_id, user_id, google_resource_name, google_etag, synced_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        ON CONFLICT (contact_id, user_id) DO UPDATE
                            SET google_resource_name = EXCLUDED.google_resource_name,
                                google_etag           = EXCLUDED.google_etag,
                                synced_at             = NOW()
                        """,
                        (contact_id, user_id, pending["google_resource_name"], pending["google_etag"]),
                    )
                cur.execute(
                    "UPDATE pending_contacts SET status = 'approved', reviewed_by = %s, reviewed_at = NOW() WHERE pending_id = %s",
                    (user_id, pending_id),
                )
                conn.commit()
                return {"contact_id": contact_id, "merged_with_existing": True}

        # Create the new contact
        cur.execute(
            """
            INSERT INTO contacts (name, email, phone, organization, title, created_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING contact_id
            """,
            (
                pending["name"], pending["email"], pending["phone"],
                pending["organization"], pending["title"], user_id,
            ),
        )
        contact_id = str(cur.fetchone()["contact_id"])

        # Link Google resource name for this user
        if pending["google_resource_name"] and user_id:
            cur.execute(
                """
                INSERT INTO contact_google_mappings
                    (contact_id, user_id, google_resource_name, google_etag, synced_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (contact_id, user_id) DO NOTHING
                """,
                (contact_id, user_id, pending["google_resource_name"], pending["google_etag"]),
            )

        cur.execute(
            "UPDATE pending_contacts SET status = 'approved', reviewed_by = %s, reviewed_at = NOW() WHERE pending_id = %s",
            (user_id, pending_id),
        )
        conn.commit()

        # Push to all other users' Google accounts
        try:
            from app.worker import push_contact_to_google_task
            push_contact_to_google_task.delay(contact_id)
        except Exception:
            pass

        return {"contact_id": contact_id, "merged_with_existing": False}
    finally:
        conn.close()


@router.delete("/pending/{pending_id}", status_code=200)
def dismiss_pending_contact(pending_id: str, request: Request):
    """Dismiss a pending contact — marks it reviewed without creating a contact record."""
    user_id = request.headers.get("X-User-Id")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE pending_contacts SET status = 'dismissed', reviewed_by = %s, reviewed_at = NOW() WHERE pending_id = %s AND status = 'pending' RETURNING pending_id",
            (user_id, pending_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Pending contact not found or already reviewed")
        conn.commit()
        return {"status": "dismissed"}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Contact CRUD
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
def create_contact(body: ContactCreate, request: Request):
    user_id = request.headers.get("X-User-Id")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO contacts
                (name, email, phone, organization, title, subject_areas, tags,
                 notes, linkedin_url, website_url, avatar_url, created_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                body.name, body.email, body.phone, body.organization, body.title,
                body.subject_areas or [], body.tags or [], body.notes,
                body.linkedin_url, body.website_url, body.avatar_url, user_id,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        contact = dict(row)
        try:
            from app.worker import embed_content_task, push_contact_to_google_task
            embed_content_task.delay("contacts", str(contact["contact_id"]), user_id)
            push_contact_to_google_task.delay(str(contact["contact_id"]))
        except Exception:
            pass
        return contact
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Companies (must be before /{contact_id} to avoid route shadowing)
# ---------------------------------------------------------------------------

@router.get("/companies")
def list_companies(
    search: Optional[str] = Query(None),
    include_archived: bool = False,
):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        filters = []
        params: list = []
        if not include_archived:
            filters.append("co.archived = false")
        if search:
            filters.append("(co.name ILIKE %s OR co.industry ILIKE %s OR co.company_location ILIKE %s)")
            s = f"%{search}%"
            params.extend([s, s, s])
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        cur.execute(
            f"""
            SELECT co.*,
                COUNT(DISTINCT c.contact_id) AS contact_count,
                MAX(c.last_interaction_at) AS last_interaction_at,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'project_id', p.project_id, 'name', p.name,
                        'stage', p.stage, 'project_type', p.project_type
                    ) ORDER BY p.created_at DESC)
                    FROM (
                        SELECT DISTINCT p2.project_id, p2.name, p2.stage, p2.project_type, p2.created_at
                        FROM project_contacts pc
                        JOIN projects p2 ON p2.project_id = pc.project_id
                        JOIN contacts c2 ON c2.contact_id = pc.contact_id
                        WHERE c2.company_id = co.company_id AND p2.status != 'archived'
                    ) p
                ), '[]'::json) AS projects
            FROM companies co
            LEFT JOIN contacts c ON c.company_id = co.company_id AND c.archived = false
            {where}
            GROUP BY co.company_id
            ORDER BY co.name ASC
            """,
            params,
        )
        return {"companies": [dict(r) for r in cur.fetchall()]}
    finally:
        conn.close()


@router.post("/companies")
def create_company(body: CompanyCreate):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO companies (name, website_url, linkedin_url, industry,
                company_size, company_type, company_location, description, notes, tags)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                body.name, body.website_url, body.linkedin_url, body.industry,
                body.company_size, body.company_type, body.company_location,
                body.description, body.notes, body.tags or [],
            ),
        )
        row = dict(cur.fetchone())
        company_id = row["company_id"]
        # Auto-link any contacts with matching organization name
        cur.execute(
            "UPDATE contacts SET company_id = %s WHERE LOWER(organization) = LOWER(%s) AND company_id IS NULL",
            (company_id, body.name),
        )
        conn.commit()
        return row
    finally:
        conn.close()


@router.get("/companies/{company_id}")
def get_company(company_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM companies WHERE company_id = %s", (company_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Company not found")
        company = dict(row)

        cur.execute(
            """
            SELECT contact_id, name, email, title, tags, avatar_url,
                   last_interaction_at, tagline,
                   (SELECT COUNT(*) FROM contact_reminders r
                    WHERE r.contact_id = c.contact_id AND r.resolved = false)::int AS open_reminders
            FROM contacts c
            WHERE c.company_id = %s AND c.archived = false
            ORDER BY c.name ASC
            """,
            (company_id,),
        )
        company["contacts"] = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT DISTINCT p.project_id, p.name, p.project_type, p.stage, p.status,
                            p.created_at
            FROM project_contacts pc
            JOIN projects p ON p.project_id = pc.project_id
            JOIN contacts c ON c.contact_id = pc.contact_id
            WHERE c.company_id = %s AND p.status != 'archived'
            ORDER BY p.created_at DESC
            """,
            (company_id,),
        )
        company["projects"] = [dict(r) for r in cur.fetchall()]

        return company
    finally:
        conn.close()


@router.patch("/companies/{company_id}")
def update_company(company_id: str, body: CompanyPatch):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        updates = []
        params = []
        for col, val in body.model_dump(exclude_none=True).items():
            updates.append(f"{col} = %s")
            params.append(val)
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")
        updates.append("updated_at = NOW()")
        params.append(company_id)
        cur.execute(
            f"UPDATE companies SET {', '.join(updates)} WHERE company_id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Company not found")
        conn.commit()
        return dict(row)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Generate company description via AI
# ---------------------------------------------------------------------------

@router.post("/companies/{company_id}/generate-description")
def generate_company_description(company_id: str, request: Request):
    import anthropic as _anthropic
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM companies WHERE company_id = %s", (company_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Company not found")
        company = dict(row)
        company_name = company["name"]

        client = _anthropic.Anthropic()
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
            messages=[{"role": "user", "content": f"""Search for "{company_name}" and write a short description of what they do — like a quick note, not a formal sentence. Be terse and specific. Use abbreviations where natural (e.g. "w/", "incl.", "&"). Skip obvious words like "company", "organization", "provides", "offers". Do not start with the company name. Focus on what's most relevant to a biotech startup evaluating them as a potential partner, client, or vendor. Output only the description, no punctuation at the end."""}],
        )

        # Extract the text response (last text block after tool use)
        description = ""
        for block in message.content:
            if hasattr(block, "text"):
                description = block.text.strip()

        if not description:
            raise HTTPException(status_code=500, detail="No description generated")

        cur.execute(
            "UPDATE companies SET description = %s, updated_at = NOW() WHERE company_id = %s",
            (description, company_id),
        )
        conn.commit()
        return {"description": description}
    finally:
        conn.close()


@router.delete("/companies/{company_id}/permanent")
def delete_company_permanent(company_id: str):
    """Hard delete a company record and detach all linked contacts (sets their company_id to NULL)."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT company_id, name FROM companies WHERE company_id = %s", (company_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Company not found")
        # Detach contacts (don't delete them — just unlink)
        cur.execute("UPDATE contacts SET company_id = NULL WHERE company_id = %s", (company_id,))
        # Delete the company
        cur.execute("DELETE FROM companies WHERE company_id = %s", (company_id,))
        conn.commit()
        return {"status": "deleted", "company_id": company_id}
    finally:
        conn.close()


@router.post("/{contact_id}/convert-to-company")
def convert_contact_to_company(contact_id: str):
    """Promote a contact record to a company. Copies name, notes, tags, website, linkedin.
    Archives the contact. Links any other contacts with the same organization name."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM contacts WHERE contact_id = %s", (contact_id,))
        contact = cur.fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        contact = dict(contact)

        # Check if a company with this name already exists
        cur.execute("SELECT company_id FROM companies WHERE LOWER(name) = LOWER(%s)", (contact["name"],))
        existing = cur.fetchone()
        if existing:
            new_company_id = existing["company_id"]
            # Just patch in any missing data
            cur.execute("""
                UPDATE companies SET
                  notes = COALESCE(NULLIF(notes, ''), %s),
                  website_url = COALESCE(website_url, %s),
                  linkedin_url = COALESCE(linkedin_url, %s),
                  tags = CASE WHEN array_length(tags, 1) IS NULL THEN %s ELSE tags END
                WHERE company_id = %s
            """, (contact["notes"], contact["website_url"], contact["linkedin_url"],
                  contact["tags"], new_company_id))
        else:
            cur.execute("""
                INSERT INTO companies (name, website_url, linkedin_url, notes, tags, description)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING company_id
            """, (
                contact["name"], contact["website_url"], contact["linkedin_url"],
                contact["notes"], contact["tags"] or [],
                contact.get("ai_summary") or contact.get("tagline") or None,
            ))
            new_company_id = cur.fetchone()["company_id"]

        # Link any contacts with matching organization name (including self)
        cur.execute("""
            UPDATE contacts SET company_id = %s
            WHERE (LOWER(organization) = LOWER(%s) OR contact_id = %s::uuid)
              AND archived = false
        """, (new_company_id, contact["name"], contact_id))

        # Archive the original contact
        cur.execute(
            "UPDATE contacts SET archived = true, updated_at = NOW() WHERE contact_id = %s",
            (contact_id,)
        )

        conn.commit()
        return {"status": "converted", "company_id": str(new_company_id)}
    finally:
        conn.close()



# ---------------------------------------------------------------------------
# Get contact detail
# ---------------------------------------------------------------------------

@router.get("/{contact_id}")
def get_contact(contact_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT c.*, co.name AS company_name, co.website_url AS company_website_url,
                   co.industry AS company_industry, co.company_location
            FROM contacts c
            LEFT JOIN companies co ON co.company_id = c.company_id
            WHERE c.contact_id = %s
            """,
            (contact_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")
        contact = dict(row)

        # Interactions (most recent 50)
        cur.execute(
            """
            SELECT interaction_id, interaction_type, subject, content_preview,
                   occurred_at, direction, metadata
            FROM contact_interactions
            WHERE contact_id = %s
            ORDER BY occurred_at DESC
            LIMIT 50
            """,
            (contact_id,),
        )
        contact["interactions"] = [dict(r) for r in cur.fetchall()]

        # Open reminders
        cur.execute(
            """
            SELECT * FROM contact_reminders
            WHERE contact_id = %s AND resolved = false
            ORDER BY due_date ASC NULLS LAST, created_at ASC
            """,
            (contact_id,),
        )
        contact["reminders"] = [dict(r) for r in cur.fetchall()]

        # Substrate links
        cur.execute(
            """
            SELECT csl.link_id, csl.substrate_id, s.name AS substrate_name,
                   csl.role, csl.notes,
                   s.substrate_purpose, s.partner_name
            FROM contact_substrate_links csl
            JOIN substrates s ON s.substrate_id = csl.substrate_id
            WHERE csl.contact_id = %s
            ORDER BY s.name
            """,
            (contact_id,),
        )
        contact["substrate_links"] = [dict(r) for r in cur.fetchall()]

        # Relationships
        cur.execute(
            """
            SELECT cr.rel_id, cr.relationship_type, cr.description, cr.strength,
                   cr.contact_b_id AS other_contact_id,
                   c.name AS other_contact_name, c.organization AS other_contact_org,
                   c.title AS other_contact_title, 'outgoing' AS direction
            FROM contact_relationships cr
            JOIN contacts c ON c.contact_id = cr.contact_b_id
            WHERE cr.contact_a_id = %s
            UNION ALL
            SELECT cr.rel_id, cr.relationship_type, cr.description, cr.strength,
                   cr.contact_a_id AS other_contact_id,
                   c.name AS other_contact_name, c.organization AS other_contact_org,
                   c.title AS other_contact_title, 'incoming' AS direction
            FROM contact_relationships cr
            JOIN contacts c ON c.contact_id = cr.contact_a_id
            WHERE cr.contact_b_id = %s
            ORDER BY relationship_type, other_contact_name
            """,
            (contact_id, contact_id),
        )
        contact["relationships"] = [dict(r) for r in cur.fetchall()]

        # Linked projects via project_contacts junction table
        cur.execute(
            """
            SELECT p.project_id, p.name, p.project_type, p.stage, p.status,
                   pc.role
            FROM project_contacts pc
            JOIN projects p ON p.project_id = pc.project_id
            WHERE pc.contact_id = %s AND p.status != 'archived'
            ORDER BY p.created_at DESC
            """,
            (contact_id,),
        )
        contact["linked_projects"] = [dict(r) for r in cur.fetchall()]

        return contact
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Update contact
# ---------------------------------------------------------------------------

@router.patch("/{contact_id}")
def update_contact(contact_id: str, body: ContactPatch):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        updates = []
        params = []
        for col in body.model_fields_set:
            val = getattr(body, col)
            updates.append(f"{col} = %s")
            params.append(val)
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")
        updates.append("updated_at = NOW()")
        params.append(contact_id)
        cur.execute(
            f"UPDATE contacts SET {', '.join(updates)} WHERE contact_id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Contact not found")
        # Auto-register any new tags into the tag registry (with default color)
        if body.tags:
            for t in body.tags:
                tname = t.strip()
                if tname:
                    cur.execute(
                        "INSERT INTO contact_tags (name, color) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING",
                        (tname, _auto_tag_color(tname)),
                    )
        conn.commit()
        updated = dict(row)
        try:
            from app.worker import embed_content_task, push_contact_to_google_task
            uid = str(updated.get("user_id") or updated.get("created_by") or "")
            embed_content_task.delay("contacts", contact_id, uid or None)
            push_contact_to_google_task.delay(contact_id)
        except Exception:
            pass
        return updated
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Archive / restore
# ---------------------------------------------------------------------------

@router.delete("/{contact_id}")
def archive_contact(contact_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE contacts SET archived = true, updated_at = NOW() WHERE contact_id = %s RETURNING contact_id",
            (contact_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Contact not found")
        conn.commit()
        return {"status": "archived"}
    finally:
        conn.close()


@router.post("/{contact_id}/restore")
def restore_contact(contact_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE contacts SET archived = false, updated_at = NOW() WHERE contact_id = %s RETURNING contact_id",
            (contact_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Contact not found")
        conn.commit()
        return {"status": "restored"}
    finally:
        conn.close()


@router.delete("/{contact_id}/permanent")
def delete_contact_permanently(contact_id: str):
    """Hard delete — removes the contact and all related records from the DB."""
    conn = _conn()
    try:
        cur = conn.cursor()
        # Delete cascade-eligible related data first
        cur.execute("DELETE FROM contact_interactions WHERE contact_id = %s", (contact_id,))
        cur.execute("DELETE FROM contact_reminders WHERE contact_id = %s", (contact_id,))
        cur.execute("DELETE FROM contact_relationships WHERE contact_a_id = %s OR contact_b_id = %s", (contact_id, contact_id))
        cur.execute("DELETE FROM contact_substrate_links WHERE contact_id = %s", (contact_id,))
        cur.execute("DELETE FROM project_contacts WHERE contact_id = %s", (contact_id,))
        cur.execute(
            "DELETE FROM contacts WHERE contact_id = %s RETURNING contact_id",
            (contact_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Contact not found")
        conn.commit()
        return {"status": "deleted"}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Add interaction (manual note / call)
# ---------------------------------------------------------------------------

@router.get("/{contact_id}/interactions/{interaction_id}/email")
def get_email_detail(contact_id: str, interaction_id: str, request: Request):
    """Fetch full email body from Gmail for a synced email interaction."""
    import httpx as _httpx
    import base64
    import re

    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM contact_interactions WHERE interaction_id = %s AND contact_id = %s",
            (interaction_id, contact_id),
        )
        interaction = cur.fetchone()
        if not interaction:
            raise HTTPException(status_code=404, detail="Interaction not found")

        gmail_id = interaction.get("external_id")
        if not gmail_id:
            raise HTTPException(status_code=404, detail="No Gmail message ID for this interaction")
    finally:
        conn.close()

    access_token = _get_user_google_token(user_id)

    r = _httpx.get(
        f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{gmail_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"format": "full"},
        timeout=20,
    )
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Email not found in Gmail (may have been deleted)")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Gmail API error: {r.status_code}")

    msg = r.json()
    hdr_list = msg.get("payload", {}).get("headers", [])
    hdr = {h["name"].lower(): h["value"] for h in hdr_list}

    # Extract body — walk parts recursively
    def extract_body(payload: dict) -> tuple[str, str]:
        """Return (plain_text, html) from a message payload."""
        mime = payload.get("mimeType", "")
        body_data = payload.get("body", {}).get("data", "")

        if mime == "text/plain" and body_data:
            return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace"), ""
        if mime == "text/html" and body_data:
            return "", base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")

        plain, html = "", ""
        for part in payload.get("parts", []):
            p, h = extract_body(part)
            plain = plain or p
            html = html or h
        return plain, html

    plain_body, html_body = extract_body(msg.get("payload", {}))

    # Strip HTML tags for plain fallback
    if not plain_body and html_body:
        plain_body = re.sub(r"<[^>]+>", "", html_body)
        plain_body = re.sub(r"\n{3,}", "\n\n", plain_body).strip()

    return {
        "interaction_id": str(interaction["interaction_id"]),
        "gmail_id": gmail_id,
        "subject": hdr.get("subject", "(no subject)"),
        "from": hdr.get("from", ""),
        "to": hdr.get("to", ""),
        "cc": hdr.get("cc", ""),
        "date": hdr.get("date", ""),
        "snippet": msg.get("snippet", ""),
        "plain_body": plain_body,
        "html_body": html_body,
        "metadata": dict(interaction.get("metadata") or {}),
    }


@router.post("/{contact_id}/interactions", status_code=201)
def add_interaction(contact_id: str, body: InteractionCreate):
    occurred_at = body.occurred_at or datetime.now(timezone.utc).isoformat()
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO contact_interactions
                (contact_id, interaction_type, subject, content_preview, full_content,
                 occurred_at, direction)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                contact_id, body.interaction_type, body.subject,
                (body.content_preview or (body.full_content or "")[:500]),
                body.full_content, occurred_at, body.direction,
            ),
        )
        row = cur.fetchone()
        # Update last_interaction_at on contact
        cur.execute(
            "UPDATE contacts SET last_interaction_at = NOW(), updated_at = NOW() WHERE contact_id = %s",
            (contact_id,),
        )
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.patch("/{contact_id}/interactions/{interaction_id}", status_code=200)
def edit_interaction(contact_id: str, interaction_id: str, body: dict):
    allowed = {"interaction_type", "subject", "content_preview", "full_content"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    conn = _conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            sets = ", ".join(f"{k} = %s" for k in updates)
            vals = list(updates.values()) + [interaction_id, contact_id]
            cur.execute(
                f"UPDATE contact_interactions SET {sets}, updated_at = NOW() WHERE interaction_id = %s AND contact_id = %s RETURNING *",
                vals,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Interaction not found")
            conn.commit()
            return dict(row)
    finally:
        conn.close()


@router.delete("/{contact_id}/interactions/{interaction_id}", status_code=200)
def delete_interaction(contact_id: str, interaction_id: str):
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM contact_interactions WHERE interaction_id = %s AND contact_id = %s",
                (interaction_id, contact_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Interaction not found")
            conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------

@router.post("/{contact_id}/reminders", status_code=201)
def create_reminder(contact_id: str, body: ReminderCreate, request: Request):
    from app.routers.auth import get_current_user
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Create a task assigned to the requesting user so it surfaces in their task list
        task_id = None
        if user:
            type_label = {
                "follow_up": "Follow-up",
                "unfinished_deal": "Unfinished Deal",
                "unanswered_email": "Unanswered Email",
            }.get(body.reminder_type, body.reminder_type.replace("_", " ").title())
            cur.execute(
                """
                INSERT INTO tasks (user_id, title, description, due_date, contact_id, source)
                VALUES (%s::uuid, %s, %s, %s::date, %s::uuid, 'reminder')
                RETURNING task_id
                """,
                (
                    user["user_id"],
                    f"[{type_label}] {body.title}",
                    body.description,
                    body.due_date or None,
                    contact_id,
                ),
            )
            task_id = str(cur.fetchone()["task_id"])

        cur.execute(
            """
            INSERT INTO contact_reminders
                (contact_id, reminder_type, title, description, due_date, task_id)
            VALUES (%s, %s, %s, %s, %s, %s::uuid)
            RETURNING *
            """,
            (contact_id, body.reminder_type, body.title, body.description, body.due_date, task_id),
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Substrate links
# ---------------------------------------------------------------------------

@router.post("/{contact_id}/substrate-links", status_code=201)
def add_substrate_link(contact_id: str, body: SubstrateLinkCreate):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO contact_substrate_links (contact_id, substrate_id, role, notes)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (contact_id, substrate_id) DO UPDATE
                SET role = EXCLUDED.role, notes = EXCLUDED.notes
            RETURNING *
            """,
            (contact_id, body.substrate_id, body.role, body.notes),
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# AI enrichment + summary (trigger Celery tasks)
# ---------------------------------------------------------------------------

@router.post("/{contact_id}/enrich")
def enrich_contact(contact_id: str):
    """Queue web enrichment for a contact (Claude + Semantic Scholar)."""
    _assert_contact_exists(contact_id)
    try:
        from app.worker import enrich_contact_task
        task = enrich_contact_task.delay(contact_id)
        return {"status": "queued", "task_id": task.id}
    except Exception as exc:
        logger.error("enrich_contact queue failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/{contact_id}/summary")
def update_contact_summary(contact_id: str, body: dict):
    """Manually update the AI summary text for a contact."""
    _assert_contact_exists(contact_id)
    summary = body.get("ai_summary", "").strip()
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE contacts SET ai_summary = %s, tagline = NULL, ai_summary_updated_at = NOW() WHERE contact_id = %s",
            (summary or None, contact_id),
        )
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@router.post("/{contact_id}/summarize")
def summarize_contact(contact_id: str):
    """Queue AI summary refresh for a contact."""
    _assert_contact_exists(contact_id)
    try:
        from app.worker import summarize_contact_task
        task = summarize_contact_task.delay(contact_id)
        return {"status": "queued", "task_id": task.id}
    except Exception as exc:
        logger.error("summarize_contact queue failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


def _assert_contact_exists(contact_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM contacts WHERE contact_id = %s", (contact_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Send email via Gmail API
# ---------------------------------------------------------------------------

@router.post("/{contact_id}/send-email", status_code=201)
def send_email(contact_id: str, body: SendEmailRequest, request: Request):
    """Send an email to the contact via the authenticated user's Gmail account."""
    import base64
    import email as _email
    from email.mime.text import MIMEText
    import httpx as _httpx

    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Load contact to get email + name
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT contact_id, name, email FROM contacts WHERE contact_id = %s", (contact_id,))
        contact = cur.fetchone()
    finally:
        conn.close()

    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not contact["email"]:
        raise HTTPException(status_code=422, detail="Contact has no email address")

    access_token = _get_user_google_token(user_id)

    # Build MIME message
    msg = MIMEText(body.body, "plain", "utf-8")
    msg["To"] = f"{contact['name']} <{contact['email']}>"
    msg["Subject"] = body.subject
    if body.cc:
        msg["Cc"] = ", ".join(body.cc)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    r = _httpx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"raw": raw},
        timeout=20,
    )
    if r.status_code not in (200, 201):
        logger.error("Gmail send failed: %s", r.text)
        raise HTTPException(status_code=502, detail=f"Gmail API error: {r.json().get('error', {}).get('message', r.text)}")

    gmail_id = r.json().get("id")

    # Record as interaction
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO contact_interactions
                (contact_id, interaction_type, subject, content_preview, full_content,
                 occurred_at, direction, external_id)
            VALUES (%s, 'email_sent', %s, %s, %s, NOW(), 'outbound', %s)
            RETURNING interaction_id
            """,
            (contact_id, body.subject, body.body[:500], body.body, gmail_id),
        )
        interaction_id = cur.fetchone()["interaction_id"]
        cur.execute(
            "UPDATE contacts SET last_interaction_at = NOW(), updated_at = NOW() WHERE contact_id = %s",
            (contact_id,),
        )
        conn.commit()
    finally:
        conn.close()

    return {"status": "sent", "gmail_message_id": gmail_id, "interaction_id": str(interaction_id)}


# ---------------------------------------------------------------------------
# Create calendar event via Google Calendar API
# ---------------------------------------------------------------------------

@router.post("/{contact_id}/calendar-event", status_code=201)
def create_calendar_event(contact_id: str, body: CalendarEventRequest, request: Request):
    """Create a Google Calendar event with the contact as attendee."""
    import httpx as _httpx

    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Load contact
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT contact_id, name, email FROM contacts WHERE contact_id = %s", (contact_id,))
        contact = cur.fetchone()
    finally:
        conn.close()

    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    access_token = _get_user_google_token(user_id)

    attendees = []
    if contact["email"]:
        attendees.append({"email": contact["email"]})
    for e in (body.attendee_emails or []):
        if e and e != contact["email"]:
            attendees.append({"email": e})

    event_body = {
        "summary": body.title,
        "description": body.description or "",
        "start": {"dateTime": body.start_datetime, "timeZone": body.timezone},
        "end": {"dateTime": body.end_datetime, "timeZone": body.timezone},
        "attendees": attendees,
        "reminders": {"useDefault": True},
    }

    r = _httpx.post(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json=event_body,
        timeout=20,
    )
    if r.status_code not in (200, 201):
        logger.error("Calendar create failed: %s", r.text)
        raise HTTPException(status_code=502, detail=f"Calendar API error: {r.json().get('error', {}).get('message', r.text)}")

    event = r.json()
    event_id = event.get("id")
    event_link = event.get("htmlLink")

    # Record as interaction
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO contact_interactions
                (contact_id, interaction_type, subject, content_preview,
                 occurred_at, direction, external_id, metadata)
            VALUES (%s, 'meeting', %s, %s, %s, 'outbound', %s, %s)
            RETURNING interaction_id
            """,
            (
                contact_id,
                body.title,
                body.description or "",
                body.start_datetime,
                event_id,
                psycopg2.extras.Json({"event_link": event_link, "start": body.start_datetime, "end": body.end_datetime}),
            ),
        )
        interaction_id = cur.fetchone()["interaction_id"]
        cur.execute(
            "UPDATE contacts SET last_interaction_at = NOW(), updated_at = NOW() WHERE contact_id = %s",
            (contact_id,),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "status": "created",
        "event_id": event_id,
        "event_link": event_link,
        "interaction_id": str(interaction_id),
    }


