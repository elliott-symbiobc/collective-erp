"""
funding.py — Funding opportunities endpoints.

GET    /funding                              — list all opportunities (filterable)
POST   /funding                              — create opportunity
PATCH  /funding/{opportunity_id}             — update fields
DELETE /funding/{opportunity_id}             — delete opportunity
GET    /funding/drive/search?q=              — search Google Drive files
GET    /funding/email/search?q=              — search Gmail threads
GET    /funding/{opportunity_id}/attachments — list attachments
POST   /funding/{opportunity_id}/attachments — add attachment
DELETE /funding/{opportunity_id}/attachments/{id} — remove attachment
"""

import logging
import os
from typing import Optional

import httpx
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/funding", tags=["funding"])

DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
GMAIL_BASE      = "https://gmail.googleapis.com/gmail/v1/users/me"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

MIME_LABELS = {
    "application/vnd.google-apps.document":     "Doc",
    "application/vnd.google-apps.spreadsheet":  "Sheet",
    "application/vnd.google-apps.presentation": "Slide",
    "application/vnd.google-apps.folder":       "Folder",
    "application/pdf":                          "PDF",
}


def _require_user(request: Request) -> str:
    uid = request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return uid


def _get_google_token(user_id: str) -> str:
    from datetime import datetime, timezone, timedelta
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT access_token, refresh_token, token_expiry FROM google_oauth_tokens WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=400, detail="google_not_connected")

    expiry = row["token_expiry"]
    if expiry and expiry.tzinfo is None:
        from datetime import timezone as tz
        expiry = expiry.replace(tzinfo=tz.utc)
    if expiry and datetime.now(timezone.utc) >= expiry - timedelta(minutes=2):
        r = httpx.post(
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
        d = r.json()
        return d["access_token"]

    return row["access_token"]

UPDATABLE = {
    "title", "stage", "deadline", "deadline_time", "tags", "funding_type",
    "amount", "decision_date", "funding_dispersion", "source_link", "notes",
    "gcal_event_id", "assignee_id",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_opportunities(
    search: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),       # comma-separated
    tags: Optional[str] = Query(None),         # comma-separated
):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            filters: list[str] = []
            params: list = []

            if search:
                filters.append("(title ILIKE %s OR notes ILIKE %s)")
                s = f"%{search}%"
                params.extend([s, s])
            if stage:
                stages = [s.strip() for s in stage.split(",") if s.strip()]
                filters.append("stage = ANY(%s)")
                params.append(stages)
            if tags:
                tag_list = [t.strip() for t in tags.split(",") if t.strip()]
                if tag_list:
                    filters.append("tags && %s")
                    params.append(tag_list)

            where = ("WHERE " + " AND ".join(filters)) if filters else ""

            cur.execute(f"""
                SELECT
                    fo.opportunity_id, fo.title, fo.stage, fo.deadline, fo.deadline_time, fo.tags,
                    fo.funding_type, fo.amount, fo.decision_date, fo.funding_dispersion,
                    fo.source_link, fo.notes, fo.gcal_event_id,
                    fo.assignee_id,
                    COALESCE(u.full_name, u.name, u.email) AS assignee_name,
                    fo.created_at, fo.updated_at
                FROM funding_opportunities fo
                LEFT JOIN users u ON u.user_id = fo.assignee_id
                {where}
                ORDER BY
                    CASE stage
                        WHEN 'New'         THEN 0
                        WHEN 'In Progress' THEN 1
                        WHEN 'Applied'     THEN 2
                        WHEN 'Won'         THEN 3
                        WHEN 'Rejected'    THEN 4
                        WHEN 'Withdrawn'   THEN 5
                        ELSE 6
                    END,
                    deadline ASC NULLS LAST,
                    title ASC
            """, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_opportunity(body: dict):
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="title is required")

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO funding_opportunities
                    (title, stage, deadline, deadline_time, tags, funding_type, amount,
                     decision_date, funding_dispersion, source_link, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING opportunity_id
            """, (
                body["title"],
                body.get("stage", "New"),
                body.get("deadline") or None,
                body.get("deadline_time") or None,
                body.get("tags", []),
                body.get("funding_type") or None,
                body.get("amount") or None,
                body.get("decision_date") or None,
                body.get("funding_dispersion") or None,
                body.get("source_link") or None,
                body.get("notes") or None,
            ))
            row = cur.fetchone()
            conn.commit()
            return {"opportunity_id": str(row["opportunity_id"])}
    finally:
        conn.close()


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch("/{opportunity_id}")
def update_opportunity(opportunity_id: str, body: dict):
    updates = {k: v for k, v in body.items() if k in UPDATABLE}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [opportunity_id]

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE funding_opportunities SET {set_clause}, updated_at = NOW() WHERE opportunity_id = %s",
                values,
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Opportunity not found")
            conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{opportunity_id}", status_code=204)
def delete_opportunity(opportunity_id: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM funding_opportunities WHERE opportunity_id = %s",
                (opportunity_id,),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Opportunity not found")
            conn.commit()
    finally:
        conn.close()

# ── Drive search ───────────────────────────────────────────────────────────────

@router.get("/drive/search")
def drive_search(request: Request, q: str = Query(..., min_length=1), max_results: int = Query(20, le=50)):
    uid = _require_user(request)
    token = _get_google_token(uid)

    query = f"name contains '{q}' and trashed = false"
    resp = httpx.get(
        DRIVE_FILES_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "q": query,
            "fields": "files(id,name,mimeType,webViewLink,modifiedTime)",
            "pageSize": max_results,
            "orderBy": "modifiedTime desc",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Drive API error")

    files = resp.json().get("files", [])
    return [
        {
            "id": f["id"],
            "title": f["name"],
            "mime_type": f.get("mimeType"),
            "url": f.get("webViewLink"),
            "label": MIME_LABELS.get(f.get("mimeType", ""), "File"),
            "modified": f.get("modifiedTime"),
        }
        for f in files
    ]


# ── Gmail search ───────────────────────────────────────────────────────────────

@router.get("/email/search")
def email_search(request: Request, q: str = Query(..., min_length=1), max_results: int = Query(20, le=50)):
    uid = _require_user(request)
    token = _get_google_token(uid)

    resp = httpx.get(
        f"{GMAIL_BASE}/threads",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": q, "maxResults": max_results},
        timeout=15,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Gmail API error")

    threads = resp.json().get("threads", [])
    if not threads:
        return []

    # Fetch snippet + subject for each thread
    results = []
    for t in threads[:max_results]:
        tid = t["id"]
        tr = httpx.get(
            f"{GMAIL_BASE}/threads/{tid}",
            headers={"Authorization": f"Bearer {token}"},
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]},
            timeout=10,
        )
        if tr.status_code != 200:
            continue
        data = tr.json()
        msgs = data.get("messages", [])
        if not msgs:
            continue
        headers = {h["name"]: h["value"] for h in msgs[0].get("payload", {}).get("headers", [])}
        results.append({
            "id": tid,
            "title": headers.get("Subject") or "(no subject)",
            "from_": headers.get("From", ""),
            "date": headers.get("Date", ""),
            "snippet": data.get("snippet", ""),
            "url": f"https://mail.google.com/mail/u/0/#inbox/{tid}",
        })

    return results


# ── Attachments CRUD ──────────────────────────────────────────────────────────

@router.get("/{opportunity_id}/attachments")
def list_attachments(opportunity_id: str):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, type, external_id, title, url, mime_type, attached_at "
                "FROM funding_attachments WHERE opportunity_id = %s ORDER BY attached_at DESC",
                (opportunity_id,),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.post("/{opportunity_id}/attachments", status_code=201)
def add_attachment(opportunity_id: str, body: dict):
    required = {"type", "external_id", "title"}
    if not required.issubset(body.keys()):
        raise HTTPException(status_code=400, detail=f"Required fields: {required}")
    if body["type"] not in ("drive", "email"):
        raise HTTPException(status_code=400, detail="type must be 'drive' or 'email'")

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO funding_attachments (opportunity_id, type, external_id, title, url, mime_type)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (opportunity_id, external_id) DO NOTHING
                   RETURNING id""",
                (
                    opportunity_id,
                    body["type"],
                    body["external_id"],
                    body["title"],
                    body.get("url"),
                    body.get("mime_type"),
                ),
            )
            row = cur.fetchone()
            conn.commit()
            if not row:
                return {"id": None, "already_attached": True}
            return {"id": str(row["id"])}
    finally:
        conn.close()


@router.delete("/{opportunity_id}/attachments/{attachment_id}", status_code=204)
def delete_attachment(opportunity_id: str, attachment_id: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM funding_attachments WHERE id = %s AND opportunity_id = %s",
                (attachment_id, opportunity_id),
            )
            conn.commit()
    finally:
        conn.close()


# ── Users list (for assignee picker) ──────────────────────────────────────────

@router.get("/users")
def list_users():
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT user_id, email, COALESCE(full_name, name, email) AS display_name "
                "FROM users WHERE is_active = true ORDER BY display_name ASC"
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── AI Enrichment ──────────────────────────────────────────────────────────────

@router.post("/{opportunity_id}/enrich")
def enrich_opportunity(opportunity_id: str):
    import anthropic
    import json as _json
    from app.core.agent_config import get_agent_config
    from app.agents.usage_logger import log_anthropic_call

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT title, stage, funding_type, amount, tags, notes, source_link, decision_date "
                "FROM funding_opportunities WHERE opportunity_id = %s",
                (opportunity_id,),
            )
            opp = cur.fetchone()
    finally:
        conn.close()

    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    cfg = get_agent_config("funding_enrich")
    model = cfg.get("model") or "claude-haiku-4-5-20251001"
    max_tokens = cfg.get("max_tokens") or 1024
    system_prompt = cfg.get("system_prompt_override") or cfg.get("default_system_prompt") or ""

    user_msg = (
        f"Funding opportunity to enrich:\n\n"
        f"Title: {opp['title']}\n"
        f"Stage: {opp['stage']}\n"
        f"Current funding_type: {opp['funding_type'] or 'unknown'}\n"
        f"Current amount: {opp['amount'] or 'unknown'}\n"
        f"Current tags: {', '.join(opp['tags']) if opp['tags'] else 'none'}\n"
        f"Current decision_date: {opp['decision_date'] or 'unknown'}\n"
        f"Source link: {opp['source_link'] or 'none'}\n"
        f"Current notes: {opp['notes'] or 'none'}\n"
    )

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    try:
        msg = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )
        log_anthropic_call(
            operation="funding_enrich",
            model=model,
            input_tokens=msg.usage.input_tokens,
            output_tokens=msg.usage.output_tokens,
        )
    except Exception as exc:
        logger.error("Enrichment API call failed: %s", exc)
        raise HTTPException(status_code=502, detail="AI enrichment failed")

    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        result = _json.loads(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="AI returned unparseable response")

    return result


# ── Fundraising Plan CRUD ──────────────────────────────────────────────────────

@router.get("/plan")
def get_plan():
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT config FROM funding_plan WHERE id = 'default'")
            row = cur.fetchone()
            return row["config"] if row and row["config"] else {}
    finally:
        conn.close()


@router.put("/plan")
def save_plan(body: dict):
    import json as _json
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO funding_plan (id, config, updated_at) VALUES ('default', %s, NOW()) "
                "ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()",
                (_json.dumps(body),),
            )
            conn.commit()
        return {"ok": True}
    finally:
        conn.close()
