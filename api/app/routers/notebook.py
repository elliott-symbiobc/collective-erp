"""
notebook.py — Electronic Lab Notebook (ELN) endpoints.

GET  /notebook/notebooks         — list notebooks (own + shared)
POST /notebook/notebooks         — create notebook
PATCH /notebook/notebooks/{id}   — rename / update notebook
DELETE /notebook/notebooks/{id}  — soft-delete notebook

GET  /notebook/entries           — list entries (personal + shared, optional notebook filter)
POST /notebook/entries           — create entry (with optional notebook_id)
GET  /notebook/entries/{id}      — get single entry with edit history
PATCH /notebook/entries/{id}     — update entry (auto-tracks edits)
DELETE /notebook/entries/{id}    — soft-delete entry
GET  /notebook/loose             — entries not assigned to any notebook
GET  /notebook/analytics         — admin: entries/day, per-user, type breakdown

POST /notebook/entries/{id}/ws-ticket   — issue short-lived WebSocket auth ticket
WS   /notebook/entries/{id}/transcribe  — streaming transcription relay (Deepgram)
POST /notebook/entries/{id}/analyze     — (re)trigger AI analysis
"""
import asyncio
import json
import logging
import os
import uuid as _uuid
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.routers.auth import get_current_user, require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notebook", tags=["notebook"])

EXPERIMENT_TYPES = [
    "Fermentation", "Assay", "Analysis", "Protocol Development",
    "Literature Review", "Meeting Notes", "Planning", "Other",
]


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _redisconn():
    import redis as redis_lib
    return redis_lib.from_url(os.environ["REDIS_URL"])


# ── Pydantic models ────────────────────────────────────────────────────────────

class NotebookCreate(BaseModel):
    name: str = "New Notebook"
    description: str = ""
    is_shared: bool = False
    color: str = "#6366f1"
    project_id: Optional[str] = None


class NotebookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_shared: Optional[bool] = None
    color: Optional[str] = None
    project_id: Optional[str] = None


class EntryCreate(BaseModel):
    title: str = "Untitled Entry"
    entry_type: str = "experiment"  # experiment | meeting | note
    notebook_id: Optional[str] = None
    # Experiment fields
    experiment_types: list[str] = []
    is_shared: bool = False
    objective: str = ""
    protocol: str = ""
    observations: str = ""
    results: str = ""
    conclusions: str = ""
    tags: list[str] = []
    linked_run_ids: list[str] = []
    linked_strain_ids: list[str] = []
    linked_substrate_ids: list[str] = []
    # Note / meeting fields
    body: Optional[str] = None
    raw_transcript: Optional[str] = None
    ai_summary: Optional[str] = None
    ai_status: str = "none"
    action_items: list = []
    decisions: list = []
    follow_ups: list = []
    calendar_event_id: Optional[str] = None
    calendar_event_title: Optional[str] = None
    calendar_event_time: Optional[str] = None


class EntryUpdate(BaseModel):
    title: Optional[str] = None
    entry_type: Optional[str] = None
    notebook_id: Optional[str] = None
    # Experiment fields
    experiment_types: Optional[list[str]] = None
    is_shared: Optional[bool] = None
    objective: Optional[str] = None
    protocol: Optional[str] = None
    observations: Optional[str] = None
    results: Optional[str] = None
    conclusions: Optional[str] = None
    tags: Optional[list[str]] = None
    linked_run_ids: Optional[list[str]] = None
    linked_strain_ids: Optional[list[str]] = None
    linked_substrate_ids: Optional[list[str]] = None
    linked_protocols: Optional[list[dict]] = None
    # Note / meeting fields
    body: Optional[str] = None
    raw_transcript: Optional[str] = None
    ai_summary: Optional[str] = None
    ai_status: Optional[str] = None
    action_items: Optional[list] = None
    decisions: Optional[list] = None
    follow_ups: Optional[list] = None
    calendar_event_id: Optional[str] = None
    calendar_event_title: Optional[str] = None
    calendar_event_time: Optional[str] = None
    created_at: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_dict(row: dict) -> dict:
    d = dict(row)
    if d.get("entry_id"):
        d["entry_id"] = str(d["entry_id"])
    if d.get("user_id"):
        d["user_id"] = str(d["user_id"])
    if d.get("created_at"):
        d["created_at"] = d["created_at"].isoformat()
    if d.get("updated_at"):
        d["updated_at"] = d["updated_at"].isoformat()
    if d.get("edited_at"):
        d["edited_at"] = d["edited_at"].isoformat()
    return d


# ── Notebook CRUD ─────────────────────────────────────────────────────────────

@router.get("/notebooks")
def list_notebooks(request: Request):
    """List all notebooks visible to the current user (own + shared)."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        user_id = user["user_id"] if user else None
        if user_id:
            cur.execute(
                """
                SELECT n.*,
                       u.full_name AS owner_name,
                       COUNT(e.entry_id) AS entry_count,
                       p.name AS project_name
                FROM eln_notebooks n
                LEFT JOIN users u ON u.user_id = n.user_id
                LEFT JOIN eln_entries e ON e.notebook_id = n.notebook_id AND e.is_deleted = false
                LEFT JOIN projects p ON p.project_id = n.project_id
                WHERE n.is_deleted = false
                  AND (n.user_id = %s::uuid OR n.is_shared = true)
                GROUP BY n.notebook_id, u.full_name, p.name
                ORDER BY n.updated_at DESC
                """,
                (user_id,),
            )
        else:
            cur.execute(
                """
                SELECT n.*, u.full_name AS owner_name,
                       COUNT(e.entry_id) AS entry_count,
                       p.name AS project_name
                FROM eln_notebooks n
                LEFT JOIN users u ON u.user_id = n.user_id
                LEFT JOIN eln_entries e ON e.notebook_id = n.notebook_id AND e.is_deleted = false
                LEFT JOIN projects p ON p.project_id = n.project_id
                WHERE n.is_deleted = false AND n.is_shared = true
                GROUP BY n.notebook_id, u.full_name, p.name
                ORDER BY n.updated_at DESC
                """,
            )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            d["notebook_id"] = str(d["notebook_id"]) if d["notebook_id"] else None
            d["user_id"] = str(d["user_id"]) if d["user_id"] else None
            d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
            d["updated_at"] = d["updated_at"].isoformat() if d["updated_at"] else None
            rows.append(d)
        return rows
    finally:
        conn.close()


@router.post("/notebooks", status_code=201)
def create_notebook(body: NotebookCreate, request: Request):
    """Create a new notebook."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        user_id = user["user_id"] if user else None
        cur.execute(
            """
            INSERT INTO eln_notebooks (user_id, name, description, is_shared, color, project_id)
            VALUES (%s::uuid, %s, %s, %s, %s, %s::uuid)
            RETURNING *
            """,
            (user_id, body.name, body.description, body.is_shared, body.color, body.project_id or None),
        )
        row = dict(cur.fetchone())
        row["notebook_id"] = str(row["notebook_id"])
        row["user_id"] = str(row["user_id"]) if row["user_id"] else None
        row["created_at"] = row["created_at"].isoformat()
        row["updated_at"] = row["updated_at"].isoformat()
        conn.commit()
        return row
    finally:
        conn.close()


@router.patch("/notebooks/{notebook_id}")
def update_notebook(notebook_id: str, body: NotebookUpdate, request: Request):
    """Rename or update a notebook."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM eln_notebooks WHERE notebook_id = %s::uuid AND is_deleted = false", (notebook_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notebook not found")
        is_admin = user and user.get("role") == "admin"
        is_owner = user and str(row["user_id"]) == user.get("user_id")
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not authorised")

        updates = ["updated_at = now()"]
        params: list = []
        if body.name is not None:
            updates.append("name = %s"); params.append(body.name)
        if body.description is not None:
            updates.append("description = %s"); params.append(body.description)
        if body.is_shared is not None:
            updates.append("is_shared = %s"); params.append(body.is_shared)
        if body.color is not None:
            updates.append("color = %s"); params.append(body.color)
        if body.project_id is not None:
            updates.append("project_id = %s::uuid"); params.append(body.project_id or None)

        params.append(notebook_id)
        cur.execute(f"UPDATE eln_notebooks SET {', '.join(updates)} WHERE notebook_id = %s::uuid RETURNING *", params)
        row = dict(cur.fetchone())
        row["notebook_id"] = str(row["notebook_id"])
        row["user_id"] = str(row["user_id"]) if row["user_id"] else None
        row["created_at"] = row["created_at"].isoformat()
        row["updated_at"] = row["updated_at"].isoformat()
        conn.commit()
        return row
    finally:
        conn.close()


@router.delete("/notebooks/{notebook_id}", status_code=204)
def delete_notebook(notebook_id: str, request: Request):
    """Soft-delete a notebook (entries are preserved, just unlinked)."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM eln_notebooks WHERE notebook_id = %s::uuid AND is_deleted = false", (notebook_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notebook not found")
        is_admin = user and user.get("role") == "admin"
        is_owner = user and str(row["user_id"]) == user.get("user_id")
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not authorised")
        cur.execute("UPDATE eln_notebooks SET is_deleted = true, updated_at = now() WHERE notebook_id = %s::uuid", (notebook_id,))
        conn.commit()
    finally:
        conn.close()


# ── Entry CRUD ─────────────────────────────────────────────────────────────────

@router.get("/entries")
def list_entries(
    request: Request,
    scope: str = Query("all", description="all | mine | shared"),
    notebook_id: Optional[str] = Query(None, description="Filter by notebook"),
    entry_type: Optional[str] = Query(None, description="Filter by entry_type"),
    loose: bool = Query(False, description="Only entries without a notebook"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: str = Query("", description="Search title/objective/body"),
):
    """List notebook entries. Returns personal entries + shared team entries."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        filters = ["e.is_deleted = false"]
        params: list = []

        if scope == "mine" and user:
            filters.append("e.user_id = %s::uuid")
            params.append(user["user_id"])
        elif scope == "shared":
            # shared with me = is_shared OR I'm a collaborator (but not my own entries)
            if user:
                filters.append("(e.is_shared = true OR EXISTS (SELECT 1 FROM eln_entry_collaborators ec WHERE ec.entry_id = e.entry_id AND ec.user_id = %s::uuid))")
                params.append(user["user_id"])
            else:
                filters.append("e.is_shared = true")
        else:
            # all = own entries + shared + collaborated
            if user:
                filters.append("(e.user_id = %s::uuid OR e.is_shared = true OR EXISTS (SELECT 1 FROM eln_entry_collaborators ec WHERE ec.entry_id = e.entry_id AND ec.user_id = %s::uuid))")
                params.append(user["user_id"])
                params.append(user["user_id"])
            else:
                filters.append("e.is_shared = true")

        if notebook_id:
            filters.append("e.notebook_id = %s::uuid")
            params.append(notebook_id)

        if loose:
            filters.append("e.notebook_id IS NULL")

        if entry_type:
            filters.append("e.entry_type = %s")
            params.append(entry_type)

        if search.strip():
            filters.append("(e.title ILIKE %s OR e.objective ILIKE %s OR e.body ILIKE %s)")
            like = f"%{search.strip()}%"
            params.extend([like, like, like])

        where = " AND ".join(filters)
        params.extend([limit, offset])

        cur.execute(
            f"""
            SELECT e.entry_id, e.user_id, e.notebook_id, e.title,
                   e.entry_type, e.experiment_types, e.is_shared,
                   e.objective, e.body, e.ai_status, e.tags,
                   e.calendar_event_title, e.calendar_event_time,
                   e.created_at, e.updated_at,
                   u.full_name AS author_name, u.email AS author_email,
                   nb.name AS notebook_name, nb.color AS notebook_color,
                   (SELECT COUNT(*) FROM eln_edits ed WHERE ed.entry_id = e.entry_id) AS edit_count
            FROM eln_entries e
            LEFT JOIN users u ON u.user_id = e.user_id
            LEFT JOIN eln_notebooks nb ON nb.notebook_id = e.notebook_id
            WHERE {where}
            ORDER BY e.updated_at DESC
            LIMIT %s OFFSET %s
            """,
            params,
        )
        rows = [_row_to_dict(r) for r in cur.fetchall()]

        # total count
        cur.execute(
            f"SELECT COUNT(*) FROM eln_entries e WHERE {where}",
            params[:-2],
        )
        total = cur.fetchone()["count"]

        return {"entries": rows, "total": total, "limit": limit, "offset": offset}
    finally:
        conn.close()


@router.post("/entries", status_code=201)
def create_entry(body: EntryCreate, request: Request):
    """Create a new notebook entry."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        user_id = user["user_id"] if user else None
        import json as _json
        cur.execute(
            """
            INSERT INTO eln_entries (
                user_id, notebook_id, title, entry_type, experiment_types, is_shared,
                objective, protocol, observations, results, conclusions, tags,
                linked_run_ids, linked_strain_ids, linked_substrate_ids,
                body, raw_transcript, ai_summary, ai_status,
                action_items, decisions, follow_ups,
                calendar_event_id, calendar_event_title, calendar_event_time
            ) VALUES (
                %s::uuid, %s::uuid, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s::uuid[], %s::uuid[], %s::uuid[],
                %s, %s, %s, %s,
                %s::jsonb, %s::jsonb, %s::jsonb,
                %s, %s, %s::timestamptz
            ) RETURNING *
            """,
            (
                user_id, body.notebook_id or None, body.title, body.entry_type,
                body.experiment_types, body.is_shared,
                body.objective, body.protocol, body.observations,
                body.results, body.conclusions, body.tags,
                body.linked_run_ids or [], body.linked_strain_ids or [], body.linked_substrate_ids or [],
                body.body, body.raw_transcript, body.ai_summary, body.ai_status,
                _json.dumps(body.action_items or []),
                _json.dumps(body.decisions or []),
                _json.dumps(body.follow_ups or []),
                body.calendar_event_id, body.calendar_event_title,
                body.calendar_event_time or None,
            ),
        )
        row = _row_to_dict(cur.fetchone())
        conn.commit()
        try:
            from app.worker import embed_content_task
            embed_content_task.delay("eln_entries", row["entry_id"], row.get("user_id"))
        except Exception:
            pass
        return row
    finally:
        conn.close()


@router.post("/entries/import-gdoc")
def import_gdoc(body: dict, request: Request):
    """Import a Google Doc as a new notebook entry.

    Body: { gdoc_url: str, notebook_id?: str }
    Returns the new entry.
    """
    import re
    import httpx as _httpx

    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    gdoc_url = (body.get("gdoc_url") or "").strip()
    if not gdoc_url:
        raise HTTPException(status_code=422, detail="gdoc_url is required")

    # Extract doc ID from URL  (handles /document/d/{id}/edit and bare IDs)
    m = re.search(r'/document/d/([a-zA-Z0-9_-]+)', gdoc_url)
    if not m:
        if re.match(r'^[a-zA-Z0-9_-]{20,}$', gdoc_url):
            doc_id = gdoc_url
        else:
            raise HTTPException(status_code=422, detail="Could not parse Google Doc URL. Paste the full URL from your browser.")
    else:
        doc_id = m.group(1)

    try:
        from app.routers.drive import _get_token
        token = _get_token(user["user_id"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google account not connected. Connect it in Settings. ({e})")

    headers = {"Authorization": f"Bearer {token}"}

    meta_res = _httpx.get(
        f"https://www.googleapis.com/drive/v3/files/{doc_id}?fields=name",
        headers=headers, timeout=15,
    )
    if meta_res.status_code == 404:
        raise HTTPException(status_code=404, detail="Google Doc not found — check the URL and sharing settings.")
    if meta_res.status_code == 403:
        raise HTTPException(status_code=403, detail="No access to this Google Doc — make sure it's shared with your Google account.")
    if not meta_res.is_success:
        raise HTTPException(status_code=502, detail=f"Failed to fetch doc metadata: {meta_res.text[:200]}")

    title = meta_res.json().get("name", "Imported Note")

    text_res = _httpx.get(
        f"https://www.googleapis.com/drive/v3/files/{doc_id}/export?mimeType=text/plain",
        headers=headers, timeout=30,
    )
    if not text_res.is_success:
        raise HTTPException(status_code=502, detail=f"Failed to export doc content: {text_res.text[:200]}")

    plain_text = text_res.text.strip()
    paragraphs = [p.strip() for p in re.split(r'\n{2,}', plain_text) if p.strip()]
    body_html = "".join(f"<p>{para.replace(chr(10), '<br>')}</p>" for para in paragraphs) if paragraphs else "<p></p>"

    notebook_id = body.get("notebook_id") or None

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """INSERT INTO eln_entries (user_id, title, entry_type, body, gdoc_id, gdoc_url, notebook_id)
               VALUES (%s::uuid, %s, 'note', %s, %s, %s, %s::uuid)
               RETURNING *""",
            (
                user["user_id"],
                title,
                body_html,
                doc_id,
                f"https://docs.google.com/document/d/{doc_id}/edit",
                notebook_id,
            ),
        )
        new_entry = _row_to_dict(cur.fetchone())
        conn.commit()
    finally:
        conn.close()

    return new_entry


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, request: Request):
    """Get a single entry with its edit history."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT e.*, u.full_name AS author_name, u.email AS author_email
            FROM eln_entries e
            LEFT JOIN users u ON u.user_id = e.user_id
            WHERE e.entry_id = %s::uuid AND e.is_deleted = false
            """,
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        entry = _row_to_dict(row)

        # Collaborators
        cur.execute(
            """
            SELECT ec.user_id, u.full_name, u.email, ec.added_at
            FROM eln_entry_collaborators ec
            JOIN users u ON u.user_id = ec.user_id
            WHERE ec.entry_id = %s::uuid
            ORDER BY ec.added_at
            """,
            (entry_id,),
        )
        collaborators = []
        for c in cur.fetchall():
            d = dict(c)
            d["user_id"] = str(d["user_id"])
            d["added_at"] = d["added_at"].isoformat()
            collaborators.append(d)
        entry["collaborators"] = collaborators

        # Access check: owner, shared, collaborator, or admin
        is_admin = user and user.get("role") == "admin"
        is_owner = user and str(row["user_id"]) == user.get("user_id")
        is_collaborator = user and any(c["user_id"] == user.get("user_id") for c in collaborators)
        if not (entry["is_shared"] or is_owner or is_admin or is_collaborator):
            raise HTTPException(status_code=403, detail="Access denied")

        # Edit history (last 20)
        cur.execute(
            """
            SELECT ed.edit_id, ed.fields, ed.edited_at,
                   u.full_name AS editor_name, u.email AS editor_email
            FROM eln_edits ed
            LEFT JOIN users u ON u.user_id = ed.user_id
            WHERE ed.entry_id = %s::uuid
            ORDER BY ed.edited_at DESC
            LIMIT 20
            """,
            (entry_id,),
        )
        entry["edit_history"] = [_row_to_dict(r) for r in cur.fetchall()]
        return entry
    finally:
        conn.close()


@router.patch("/entries/{entry_id}")
def update_entry(entry_id: str, body: EntryUpdate, request: Request):
    """Update a notebook entry. Tracks which fields changed in eln_edits."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Fetch existing
        cur.execute(
            "SELECT * FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Entry not found")

        is_admin = user and user.get("role") == "admin"
        is_owner = user and str(existing["user_id"]) == user.get("user_id")
        # Check if user is a collaborator
        is_collaborator = False
        if user and not is_owner and not is_admin:
            cur.execute(
                "SELECT 1 FROM eln_entry_collaborators WHERE entry_id = %s::uuid AND user_id = %s::uuid",
                (entry_id, user["user_id"]),
            )
            is_collaborator = cur.fetchone() is not None
        if not (is_owner or is_admin or is_collaborator):
            raise HTTPException(status_code=403, detail="Not authorised to edit this entry")

        updates: list[str] = ["updated_at = now()"]
        params: list = []
        changed_fields: list[str] = []

        import json as _json
        field_map = {
            "title": ("%s", body.title),
            "entry_type": ("%s", body.entry_type),
            "experiment_types": ("%s", body.experiment_types),
            "is_shared": ("%s", body.is_shared),
            "objective": ("%s", body.objective),
            "protocol": ("%s", body.protocol),
            "observations": ("%s", body.observations),
            "results": ("%s", body.results),
            "conclusions": ("%s", body.conclusions),
            "tags": ("%s", body.tags),
            "body": ("%s", body.body),
            "raw_transcript": ("%s", body.raw_transcript),
            "ai_summary": ("%s", body.ai_summary),
            "ai_status": ("%s", body.ai_status),
            "calendar_event_id": ("%s", body.calendar_event_id),
            "calendar_event_title": ("%s", body.calendar_event_title),
        }
        # notebook_id handled separately (needs ::uuid cast and allows None)
        if body.notebook_id is not None:
            updates.append("notebook_id = %s::uuid")
            params.append(body.notebook_id or None)
            changed_fields.append("notebook_id")

        if body.calendar_event_time is not None:
            updates.append("calendar_event_time = %s::timestamptz")
            params.append(body.calendar_event_time or None)
            changed_fields.append("calendar_event_time")

        if body.created_at is not None:
            updates.append("created_at = %s::timestamptz")
            params.append(body.created_at)
            changed_fields.append("created_at")

        # JSONB arrays
        for jfield in ("action_items", "decisions", "follow_ups"):
            val = getattr(body, jfield)
            if val is not None:
                updates.append(f"{jfield} = %s::jsonb")
                params.append(_json.dumps(val))
                changed_fields.append(jfield)

        # Linked entity arrays
        if body.linked_run_ids is not None:
            updates.append("linked_run_ids = %s::uuid[]")
            params.append(body.linked_run_ids)
            changed_fields.append("linked_run_ids")
        if body.linked_strain_ids is not None:
            updates.append("linked_strain_ids = %s::uuid[]")
            params.append(body.linked_strain_ids)
            changed_fields.append("linked_strain_ids")
        if body.linked_substrate_ids is not None:
            updates.append("linked_substrate_ids = %s::uuid[]")
            params.append(body.linked_substrate_ids)
            changed_fields.append("linked_substrate_ids")
        if body.linked_protocols is not None:
            updates.append("linked_protocols = %s::jsonb")
            params.append(_json.dumps(body.linked_protocols))
            changed_fields.append("linked_protocols")

        for field, (placeholder, value) in field_map.items():
            if value is not None:
                updates.append(f"{field} = {placeholder}")
                params.append(value)
                if str(existing.get(field, "")) != str(value):
                    changed_fields.append(field)

        if len(updates) == 1:
            raise HTTPException(status_code=422, detail="No fields to update")

        params.append(entry_id)
        cur.execute(
            f"UPDATE eln_entries SET {', '.join(updates)} WHERE entry_id = %s::uuid RETURNING *",
            params,
        )
        updated = _row_to_dict(cur.fetchone())

        # Record edit
        if changed_fields:
            user_id = user["user_id"] if user else None
            cur.execute(
                "INSERT INTO eln_edits (entry_id, user_id, fields) VALUES (%s::uuid, %s::uuid, %s)",
                (entry_id, user_id, changed_fields),
            )

        conn.commit()
        _uid = user["user_id"] if user else None
        try:
            from app.worker import embed_content_task
            embed_content_task.delay("eln_entries", entry_id, _uid)
        except Exception:
            pass
        # Auto-sync to Google Docs if this entry has a linked doc and content changed
        content_fields = {"title", "body", "objective", "observations", "results", "conclusions"}
        if _uid and updated.get("gdoc_id") and content_fields.intersection(changed_fields):
            try:
                from app.worker import sync_entry_gdoc_task
                sync_entry_gdoc_task.delay(entry_id, _uid)
            except Exception:
                pass
        return updated
    finally:
        conn.close()


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: str, request: Request):
    """Soft-delete a notebook entry."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        is_admin = user and user.get("role") == "admin"
        is_owner = user and str(row["user_id"]) == user.get("user_id")
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not authorised")
        cur.execute(
            "UPDATE eln_entries SET is_deleted = true, updated_at = now() WHERE entry_id = %s::uuid",
            (entry_id,),
        )
        conn.commit()
    finally:
        conn.close()


@router.get("/by-project/{project_id}")
def notebooks_by_project(project_id: str, request: Request):
    """List notebooks linked to a specific project."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT n.*,
                   u.full_name AS owner_name,
                   COUNT(e.entry_id) AS entry_count
            FROM eln_notebooks n
            LEFT JOIN users u ON u.user_id = n.user_id
            LEFT JOIN eln_entries e ON e.notebook_id = n.notebook_id AND e.is_deleted = false
            WHERE n.is_deleted = false
              AND n.project_id = %s::uuid
            GROUP BY n.notebook_id, u.full_name
            ORDER BY n.updated_at DESC
            """,
            (project_id,),
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            d["notebook_id"] = str(d["notebook_id"]) if d["notebook_id"] else None
            d["user_id"] = str(d["user_id"]) if d["user_id"] else None
            d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
            d["updated_at"] = d["updated_at"].isoformat() if d["updated_at"] else None
            rows.append(d)
        return rows
    finally:
        conn.close()


@router.post("/entries/{entry_id}/attach-protocol", status_code=200)
def attach_protocol_snapshot(entry_id: str, body: dict, request: Request):
    """Embed a read-only protocol snapshot into a notebook entry.

    body: { protocol_id: str }
    Fetches the current version of the protocol, snapshots its content,
    and appends it to linked_protocols on the entry.
    """
    import json as _json
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Verify entry ownership
        cur.execute(
            "SELECT user_id, linked_protocols FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        entry = cur.fetchone()
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        is_admin = user and user.get("role") == "admin"
        is_owner = user and str(entry["user_id"]) == user.get("user_id")
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not authorised")

        protocol_id = body.get("protocol_id")
        if not protocol_id:
            raise HTTPException(status_code=422, detail="protocol_id required")

        # Fetch current protocol state
        cur.execute(
            """
            SELECT protocol_id, title,
                   COALESCE(version_major,1) AS version_major,
                   COALESCE(version_minor,0) AS version_minor,
                   version, content_markdown, protocol_type, author
            FROM protocols WHERE protocol_id = %s
            """,
            (protocol_id,),
        )
        proto = cur.fetchone()
        if not proto:
            raise HTTPException(status_code=404, detail="Protocol not found")

        version_label = f"{proto['version_major']}.{proto['version_minor']}"

        # Check if already attached
        existing = entry["linked_protocols"] or []
        if isinstance(existing, str):
            existing = _json.loads(existing)
        if any(p.get("protocol_id") == protocol_id for p in existing):
            return {"ok": True, "message": "already_attached", "linked_protocols": existing}

        snapshot = {
            "protocol_id":       protocol_id,
            "title":             proto["title"],
            "version_label":     version_label,
            "protocol_type":     proto["protocol_type"],
            "author":            proto["author"],
            "content_markdown":  proto["content_markdown"],
            "linked_at":         __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }
        existing.append(snapshot)

        cur.execute(
            "UPDATE eln_entries SET linked_protocols = %s::jsonb, updated_at = now() WHERE entry_id = %s::uuid",
            (_json.dumps(existing), entry_id),
        )
        conn.commit()
        return {"ok": True, "linked_protocols": existing}
    finally:
        conn.close()


@router.delete("/entries/{entry_id}/detach-protocol/{protocol_id}", status_code=200)
def detach_protocol_snapshot(entry_id: str, protocol_id: str, request: Request):
    """Remove a protocol snapshot from an entry."""
    import json as _json
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id, linked_protocols FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        entry = cur.fetchone()
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        is_admin = user and user.get("role") == "admin"
        is_owner = user and str(entry["user_id"]) == user.get("user_id")
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not authorised")

        existing = entry["linked_protocols"] or []
        if isinstance(existing, str):
            existing = _json.loads(existing)
        updated = [p for p in existing if p.get("protocol_id") != protocol_id]

        cur.execute(
            "UPDATE eln_entries SET linked_protocols = %s::jsonb, updated_at = now() WHERE entry_id = %s::uuid",
            (_json.dumps(updated), entry_id),
        )
        conn.commit()
        return {"ok": True, "linked_protocols": updated}
    finally:
        conn.close()


@router.get("/platform-users")
def list_platform_users(request: Request):
    """Return basic user info for all active platform users (for sharing/collaboration)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id, full_name, email FROM users WHERE is_active = true ORDER BY full_name"
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            d["user_id"] = str(d["user_id"])
            rows.append(d)
        return rows
    finally:
        conn.close()


@router.get("/recent")
def recent_entries(request: Request, limit: int = Query(5, ge=1, le=20)):
    """Get recent entries for the top-bar panel (own + shared)."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        user_id = user["user_id"] if user else None

        if user_id:
            cur.execute(
                """
                SELECT e.entry_id, e.title, e.entry_type, e.experiment_types, e.is_shared,
                       e.objective, e.body, e.ai_status, e.updated_at, e.created_at,
                       nb.name AS notebook_name, nb.color AS notebook_color,
                       u.full_name AS author_name
                FROM eln_entries e
                LEFT JOIN users u ON u.user_id = e.user_id
                LEFT JOIN eln_notebooks nb ON nb.notebook_id = e.notebook_id
                WHERE e.is_deleted = false
                  AND (e.user_id = %s::uuid OR e.is_shared = true)
                ORDER BY e.updated_at DESC
                LIMIT %s
                """,
                (user_id, limit),
            )
        else:
            cur.execute(
                """
                SELECT e.entry_id, e.title, e.entry_type, e.experiment_types, e.is_shared,
                       e.objective, e.body, e.ai_status, e.updated_at, e.created_at,
                       nb.name AS notebook_name, nb.color AS notebook_color,
                       u.full_name AS author_name
                FROM eln_entries e
                LEFT JOIN users u ON u.user_id = e.user_id
                LEFT JOIN eln_notebooks nb ON nb.notebook_id = e.notebook_id
                WHERE e.is_deleted = false AND e.is_shared = true
                ORDER BY e.updated_at DESC
                LIMIT %s
                """,
                (limit,),
            )
        return [_row_to_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.get("/loose")
def loose_entries(
    request: Request,
    entry_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Entries not assigned to any notebook."""
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        params: list = []
        filters = ["e.is_deleted = false", "e.notebook_id IS NULL"]
        if user:
            filters.append("(e.user_id = %s::uuid OR e.is_shared = true)")
            params.append(user["user_id"])
        else:
            filters.append("e.is_shared = true")
        if entry_type:
            filters.append("e.entry_type = %s")
            params.append(entry_type)
        where = " AND ".join(filters)
        params.extend([limit, offset])
        cur.execute(
            f"""
            SELECT e.entry_id, e.user_id, e.notebook_id, e.title,
                   e.entry_type, e.experiment_types, e.is_shared,
                   e.objective, e.body, e.ai_status, e.tags,
                   e.calendar_event_title, e.calendar_event_time,
                   e.created_at, e.updated_at,
                   u.full_name AS author_name
            FROM eln_entries e
            LEFT JOIN users u ON u.user_id = e.user_id
            WHERE {where}
            ORDER BY e.updated_at DESC
            LIMIT %s OFFSET %s
            """,
            params,
        )
        rows = [_row_to_dict(r) for r in cur.fetchall()]
        cur.execute(f"SELECT COUNT(*) FROM eln_entries e WHERE {where}", params[:-2])
        total = cur.fetchone()["count"]
        return {"entries": rows, "total": total, "limit": limit, "offset": offset}
    finally:
        conn.close()


# ── WebSocket ticket ──────────────────────────────────────────────────────────

@router.post("/entries/{entry_id}/ws-ticket")
def get_entry_ws_ticket(entry_id: str, request: Request):
    """Issue a 60-second one-time ticket for WebSocket auth on an entry."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row or str(row[0]) != user["user_id"]:
            raise HTTPException(status_code=404, detail="Entry not found")
    finally:
        conn.close()

    ticket = str(_uuid.uuid4())
    r = _redisconn()
    r.setex(
        f"ws_ticket:{ticket}",
        60,
        json.dumps({"user_id": user["user_id"], "email": user["email"], "role": user["role"]}),
    )
    return {"ticket": ticket}


# ── WebSocket: streaming transcription relay ───────────────────────────────────

@router.websocket("/entries/{entry_id}/transcribe")
async def entry_transcribe_stream(websocket: WebSocket, entry_id: str, ticket: str = ""):
    """Relay audio from browser to Deepgram and persist transcript to eln_entries."""
    await websocket.accept()

    # Auth via Redis ticket
    user = None
    if ticket:
        try:
            r = _redisconn()
            raw = r.getdel(f"ws_ticket:{ticket}")
            if raw:
                user = json.loads(raw)
        except Exception as e:
            logger.warning("entry ws ticket lookup failed: %s", e)

    if not user:
        await websocket.send_json({"type": "error", "error": "not_authenticated"})
        await websocket.close(code=4001)
        return

    api_key = os.environ.get("DEEPGRAM_API_KEY", "")
    if not api_key:
        await websocket.send_json({"type": "error", "error": "deepgram_not_configured"})
        await websocket.close(code=4002)
        return

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            await websocket.send_json({"type": "error", "error": "entry_not_found"})
            await websocket.close(code=4003)
            return
    finally:
        conn.close()

    dg_url = (
        "wss://api.deepgram.com/v1/listen"
        "?model=nova-2&language=en&smart_format=true"
        "&interim_results=true&vad_events=true&endpointing=300&utterance_end_ms=1000"
    )
    transcript_parts: list[str] = []

    try:
        import websockets as ws_lib

        async with ws_lib.connect(
            dg_url,
            additional_headers={"Authorization": f"Token {api_key}"},
            max_size=10 * 1024 * 1024,
        ) as dg_ws:

            async def forward_audio():
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg["type"] == "websocket.disconnect":
                            break
                        if "bytes" in msg and msg["bytes"]:
                            await dg_ws.send(msg["bytes"])
                        elif "text" in msg:
                            data = json.loads(msg["text"])
                            if data.get("type") == "stop":
                                await dg_ws.send(json.dumps({"type": "CloseStream"}))
                                break
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.warning("entry forward_audio error: %s", e)

            async def forward_transcript():
                try:
                    async for message in dg_ws:
                        if isinstance(message, bytes):
                            continue
                        data = json.loads(message)
                        msg_type = data.get("type")
                        if msg_type == "Results":
                            alt = data.get("channel", {}).get("alternatives", [{}])[0]
                            transcript = alt.get("transcript", "")
                            is_final = data.get("is_final", False)
                            speech_final = data.get("speech_final", False)
                            if transcript:
                                if is_final:
                                    transcript_parts.append(transcript)
                                try:
                                    await websocket.send_json({
                                        "type": "transcript",
                                        "transcript": transcript,
                                        "is_final": is_final,
                                        "speech_final": speech_final,
                                    })
                                except Exception:
                                    break
                        elif msg_type == "UtteranceEnd":
                            try:
                                await websocket.send_json({"type": "utterance_end"})
                            except Exception:
                                break
                except Exception as e:
                    logger.warning("entry forward_transcript error: %s", e)

            await asyncio.gather(forward_audio(), forward_transcript())

    except Exception as e:
        logger.error("entry_transcribe_stream error for %s: %s", entry_id, e)
        try:
            await websocket.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass

    if transcript_parts:
        full_text = " ".join(transcript_parts)
        db = _conn()
        try:
            c = db.cursor()
            c.execute(
                "UPDATE eln_entries SET raw_transcript = %s, ai_status = 'processing', entry_type = 'meeting', updated_at = now() WHERE entry_id = %s::uuid",
                (full_text, entry_id),
            )
            db.commit()
        except Exception as e:
            logger.error("Failed to persist transcript for entry %s: %s", entry_id, e)
        finally:
            db.close()

        from app.worker import analyze_entry_task
        analyze_entry_task.delay(entry_id)

    try:
        await websocket.send_json({"type": "done", "parts": len(transcript_parts)})
    except Exception:
        pass


# ── AI analysis (re)trigger ────────────────────────────────────────────────────

@router.post("/entries/{entry_id}/analyze")
def trigger_entry_analyze(entry_id: str, request: Request):
    """(Re)trigger AI analysis on a meeting entry's transcript."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, raw_transcript FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        if str(row[0]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")
        if not row[1]:
            raise HTTPException(status_code=422, detail="No transcript to analyze")
        cur.execute(
            "UPDATE eln_entries SET ai_status = 'processing', updated_at = now() WHERE entry_id = %s::uuid",
            (entry_id,),
        )
        conn.commit()
    finally:
        conn.close()

    from app.worker import analyze_entry_task
    analyze_entry_task.delay(entry_id)
    return {"ok": True, "status": "processing"}


@router.post("/entries/{entry_id}/format-notes")
def format_entry_notes(entry_id: str, request: Request):
    """Use Claude to format and clean up the meeting notes body."""
    import anthropic

    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, body, title, calendar_event_title FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        if str(row[0]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")
        _, body, title, event_title = row
        if not body or not body.strip():
            raise HTTPException(status_code=422, detail="No notes to format")
    finally:
        conn.close()

    client = anthropic.Anthropic()
    meeting_name = title or event_title or "Meeting"
    prompt = f"""You are formatting rough meeting notes into a clean, readable document.

Meeting: {meeting_name}
Raw notes:
{body[:8000]}

Format these notes into clean, well-structured markdown. Rules:
- Preserve ALL information — do not drop any facts, numbers, or details
- Use ## for main sections, ### for subsections
- Use bullet lists for lists of items
- Bold (**text**) key numbers, names, and decisions
- Fix obvious typos or unclear abbreviations
- Keep the tone professional but concise
- Do NOT add new information or commentary
- Return ONLY the formatted markdown, nothing else"""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    formatted = msg.content[0].text.strip()

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE eln_entries SET body = %s, updated_at = now() WHERE entry_id = %s::uuid",
            (formatted, entry_id),
        )
        conn.commit()
    finally:
        conn.close()

    return {"formatted_body": formatted}


# ── Attachments ───────────────────────────────────────────────────────────────

@router.post("/entries/{entry_id}/attachments")
async def upload_attachment(entry_id: str, file: UploadFile = File(...), request: Request = None):
    """Upload a PDF attachment to a notebook entry."""
    from pathlib import Path

    user = get_current_user(request)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        if str(row[0]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")
    finally:
        conn.close()

    fname = file.filename or "attachment.pdf"
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are accepted")

    upload_dir = Path("/app/uploads/notebook") / entry_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    attachment_id = str(_uuid.uuid4())
    safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in fname[:80])
    dest = upload_dir / f"{attachment_id[:8]}_{safe_name}"

    contents = await file.read()
    dest.write_bytes(contents)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO eln_entry_attachments
               (attachment_id, entry_id, original_name, file_path, file_size, content_type, uploaded_by)
               VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::uuid)
               RETURNING attachment_id, original_name, file_size, uploaded_at""",
            (attachment_id, entry_id, fname, str(dest), len(contents), file.content_type or "application/pdf", user["user_id"]),
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    return {
        "attachment_id": str(row[0]),
        "original_name": row[1],
        "file_size": row[2],
        "uploaded_at": row[3].isoformat() if row[3] else None,
    }


@router.get("/entries/{entry_id}/attachments")
def list_attachments(entry_id: str, request: Request):
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        if str(row[0]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")

        cur.execute(
            """SELECT attachment_id, original_name, file_size, content_type, uploaded_at
               FROM eln_entry_attachments WHERE entry_id = %s::uuid ORDER BY uploaded_at""",
            (entry_id,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    return [
        {
            "attachment_id": str(r[0]),
            "original_name": r[1],
            "file_size": r[2],
            "content_type": r[3],
            "uploaded_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


@router.get("/entries/{entry_id}/attachments/{attachment_id}")
def download_attachment(entry_id: str, attachment_id: str, request: Request):
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.file_path, a.original_name, a.content_type, e.user_id
               FROM eln_entry_attachments a
               JOIN eln_entries e ON e.entry_id = a.entry_id
               WHERE a.attachment_id = %s::uuid AND a.entry_id = %s::uuid AND e.is_deleted = false""",
            (attachment_id, entry_id),
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if str(row[3]) != user["user_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not authorised")

    from pathlib import Path
    path = Path(row[0])
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(path),
        media_type=row[2] or "application/pdf",
        filename=row[1],
        headers={"Content-Disposition": f'inline; filename="{row[1]}"'},
    )


@router.delete("/entries/{entry_id}/attachments/{attachment_id}")
def delete_attachment(entry_id: str, attachment_id: str, request: Request):
    user = get_current_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.file_path, e.user_id
               FROM eln_entry_attachments a
               JOIN eln_entries e ON e.entry_id = a.entry_id
               WHERE a.attachment_id = %s::uuid AND a.entry_id = %s::uuid""",
            (attachment_id, entry_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Attachment not found")
        if str(row[1]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")

        cur.execute(
            "DELETE FROM eln_entry_attachments WHERE attachment_id = %s::uuid",
            (attachment_id,),
        )
        conn.commit()
    finally:
        conn.close()

    from pathlib import Path
    try:
        Path(row[0]).unlink(missing_ok=True)
    except Exception:
        pass

    return {"ok": True}


# ── Collaborators ─────────────────────────────────────────────────────────────

class CollaboratorAdd(BaseModel):
    user_id: str
    message: Optional[str] = None


@router.post("/entries/{entry_id}/collaborators")
def add_collaborator(entry_id: str, body: CollaboratorAdd, request: Request):
    """Add a platform user as collaborator on an entry and notify them."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id, title FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        is_admin = user.get("role") == "admin"
        is_owner = str(row["user_id"]) == user["user_id"]
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Only the owner can manage collaborators")

        cur.execute(
            """
            INSERT INTO eln_entry_collaborators (entry_id, user_id, added_by)
            VALUES (%s::uuid, %s::uuid, %s::uuid)
            ON CONFLICT (entry_id, user_id) DO NOTHING
            """,
            (entry_id, body.user_id, user["user_id"]),
        )

        # Notify the new collaborator
        sender_name = user.get("full_name") or user.get("email") or "Someone"
        entry_title = row["title"] or "a note"
        notif_title = f"{sender_name} shared \"{entry_title}\" with you"
        notif_message = body.message.strip() if body.message and body.message.strip() else None
        try:
            from app.routers.notifications import create_notification
            create_notification(
                conn,
                recipient_id=body.user_id,
                sender_id=user["user_id"],
                notification_type="general",
                entity_type="notebook_entry",
                entity_id=entry_id,
                title=notif_title,
                message=notif_message,
            )
        except Exception:
            pass  # notification failure must never block the share

        conn.commit()

        cur.execute(
            """
            SELECT ec.user_id, u.full_name, u.email, ec.added_at
            FROM eln_entry_collaborators ec
            JOIN users u ON u.user_id = ec.user_id
            WHERE ec.entry_id = %s::uuid ORDER BY ec.added_at
            """,
            (entry_id,),
        )
        collaborators = [{"user_id": str(r["user_id"]), "full_name": r["full_name"], "email": r["email"], "added_at": r["added_at"].isoformat()} for r in cur.fetchall()]
        return {"ok": True, "collaborators": collaborators}
    finally:
        conn.close()


@router.delete("/entries/{entry_id}/collaborators/{collab_user_id}")
def remove_collaborator(entry_id: str, collab_user_id: str, request: Request):
    """Remove a collaborator from an entry."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        is_admin = user.get("role") == "admin"
        is_owner = str(row["user_id"]) == user["user_id"]
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Only the owner can manage collaborators")

        cur.execute(
            "DELETE FROM eln_entry_collaborators WHERE entry_id = %s::uuid AND user_id = %s::uuid",
            (entry_id, collab_user_id),
        )
        conn.commit()

        cur.execute(
            """
            SELECT ec.user_id, u.full_name, u.email, ec.added_at
            FROM eln_entry_collaborators ec
            JOIN users u ON u.user_id = ec.user_id
            WHERE ec.entry_id = %s::uuid ORDER BY ec.added_at
            """,
            (entry_id,),
        )
        collaborators = [{"user_id": str(r["user_id"]), "full_name": r["full_name"], "email": r["email"], "added_at": r["added_at"].isoformat()} for r in cur.fetchall()]
        return {"ok": True, "collaborators": collaborators}
    finally:
        conn.close()


# ── Comments ─────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    body: str

class CommentUpdate(BaseModel):
    body: str


def _can_access_entry(cur, entry_id: str, user_id: str, role: str) -> bool:
    """Return True if user is owner, collaborator, or admin."""
    if role == "admin":
        return True
    cur.execute(
        """SELECT 1 FROM eln_entries e
           WHERE e.entry_id = %s::uuid AND e.is_deleted = false
             AND (e.user_id = %s::uuid OR e.is_shared = true
                  OR EXISTS (SELECT 1 FROM eln_entry_collaborators ec
                             WHERE ec.entry_id = e.entry_id AND ec.user_id = %s::uuid))""",
        (entry_id, user_id, user_id),
    )
    return cur.fetchone() is not None


@router.get("/entries/{entry_id}/comments")
def list_comments(entry_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if not _can_access_entry(cur, entry_id, user["user_id"], user.get("role", "")):
            raise HTTPException(status_code=403, detail="No access")
        cur.execute(
            """SELECT c.comment_id, c.entry_id, c.user_id, c.body, c.created_at, c.updated_at,
                      u.full_name AS author_name, u.email AS author_email
               FROM eln_entry_comments c
               JOIN users u ON u.user_id = c.user_id
               WHERE c.entry_id = %s::uuid AND c.is_deleted = false
               ORDER BY c.created_at ASC""",
            (entry_id,),
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            for f in ("comment_id", "entry_id", "user_id"):
                if d.get(f): d[f] = str(d[f])
            for ts in ("created_at", "updated_at"):
                if d.get(ts) and hasattr(d[ts], "isoformat"): d[ts] = d[ts].isoformat()
            rows.append(d)
        return {"comments": rows}
    finally:
        conn.close()


@router.post("/entries/{entry_id}/comments", status_code=201)
def add_comment(entry_id: str, body: CommentCreate, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="Comment cannot be empty")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if not _can_access_entry(cur, entry_id, user["user_id"], user.get("role", "")):
            raise HTTPException(status_code=403, detail="No access")
        cur.execute(
            """INSERT INTO eln_entry_comments (entry_id, user_id, body)
               VALUES (%s::uuid, %s::uuid, %s)
               RETURNING comment_id, entry_id, user_id, body, created_at, updated_at""",
            (entry_id, user["user_id"], body.body.strip()),
        )
        row = dict(cur.fetchone())
        conn.commit()
        for f in ("comment_id", "entry_id", "user_id"):
            if row.get(f): row[f] = str(row[f])
        for ts in ("created_at", "updated_at"):
            if row.get(ts) and hasattr(row[ts], "isoformat"): row[ts] = row[ts].isoformat()
        row["author_name"] = user.get("full_name") or user.get("email", "")
        row["author_email"] = user.get("email", "")
        return row
    finally:
        conn.close()


@router.patch("/entries/{entry_id}/comments/{comment_id}")
def update_comment(entry_id: str, comment_id: str, body: CommentUpdate, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="Comment cannot be empty")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM eln_entry_comments WHERE comment_id = %s::uuid AND entry_id = %s::uuid AND is_deleted = false",
            (comment_id, entry_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Comment not found")
        is_owner = str(row["user_id"]) == user["user_id"]
        is_admin = user.get("role") == "admin"
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Cannot edit another user's comment")
        cur.execute(
            "UPDATE eln_entry_comments SET body = %s, updated_at = now() WHERE comment_id = %s::uuid RETURNING comment_id, body, updated_at",
            (body.body.strip(), comment_id),
        )
        updated = dict(cur.fetchone())
        conn.commit()
        for f in ("comment_id",):
            if updated.get(f): updated[f] = str(updated[f])
        if updated.get("updated_at") and hasattr(updated["updated_at"], "isoformat"):
            updated["updated_at"] = updated["updated_at"].isoformat()
        return updated
    finally:
        conn.close()


@router.delete("/entries/{entry_id}/comments/{comment_id}", status_code=204)
def delete_comment(entry_id: str, comment_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM eln_entry_comments WHERE comment_id = %s::uuid AND entry_id = %s::uuid AND is_deleted = false",
            (comment_id, entry_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Comment not found")
        is_owner = str(row["user_id"]) == user["user_id"]
        is_admin = user.get("role") == "admin"
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Cannot delete another user's comment")
        cur.execute(
            "UPDATE eln_entry_comments SET is_deleted = true WHERE comment_id = %s::uuid",
            (comment_id,),
        )
        conn.commit()
    finally:
        conn.close()


# ── Google Docs import ───────────────────────────────────────────────────────

# ── Google Docs export ────────────────────────────────────────────────────────

@router.post("/entries/{entry_id}/gdoc-export")
def gdoc_export(entry_id: str, request: Request):
    """Create or update a Google Doc with this entry's content.

    Requires the user to have a connected Google account with Drive scope.
    """
    import re
    import httpx as _httpx

    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id, title, body, objective, observations, results, conclusions, entry_type, gdoc_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        is_owner = str(row["user_id"]) == user["user_id"]
        is_admin = user.get("role") == "admin"
        if not (is_owner or is_admin):
            raise HTTPException(status_code=403, detail="Not authorised")
    finally:
        conn.close()

    # Get Google token with Drive scope
    try:
        from app.routers.drive import _get_token
        token = _get_token(user["user_id"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google account not connected or Drive not authorised. Connect your Google account in Settings. ({e})")

    title = row["title"] or "Untitled Entry"
    # Build plain-text content from HTML body (strip tags)
    def strip_html(html: str) -> str:
        if not html:
            return ""
        text = re.sub(r'<br\s*/?>', '\n', html or "")
        text = re.sub(r'</p>|</h[1-6]>|</li>|</tr>', '\n', text)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'&amp;', '&', text)
        text = re.sub(r'&lt;', '<', text)
        text = re.sub(r'&gt;', '>', text)
        text = re.sub(r'&nbsp;', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    sections = [f"# {title}\n"]
    if row["entry_type"] == "experiment":
        for field, label in [("objective","Objective"), ("observations","Observations"), ("results","Results"), ("conclusions","Conclusions")]:
            if row.get(field):
                sections.append(f"\n## {label}\n{strip_html(row[field])}")
    else:
        if row.get("body"):
            sections.append(f"\n{strip_html(row['body'])}")

    content = "\n".join(sections)

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    existing_doc_id = row.get("gdoc_id")

    if existing_doc_id:
        # Update existing doc: clear and rewrite content
        try:
            # Get current doc length to clear it
            doc_res = _httpx.get(
                f"https://docs.googleapis.com/v1/documents/{existing_doc_id}",
                headers=headers, timeout=15,
            )
            if doc_res.status_code == 200:
                doc_data = doc_res.json()
                end_index = doc_data.get("body", {}).get("content", [{}])[-1].get("endIndex", 2)
                if end_index > 2:
                    # Delete all existing content
                    _httpx.post(
                        f"https://docs.googleapis.com/v1/documents/{existing_doc_id}:batchUpdate",
                        headers=headers,
                        json={"requests": [{"deleteContentRange": {"range": {"startIndex": 1, "endIndex": end_index - 1}}}]},
                        timeout=15,
                    )
                # Insert new content
                _httpx.post(
                    f"https://docs.googleapis.com/v1/documents/{existing_doc_id}:batchUpdate",
                    headers=headers,
                    json={"requests": [{"insertText": {"location": {"index": 1}, "text": content}}]},
                    timeout=15,
                )
                gdoc_url = f"https://docs.google.com/document/d/{existing_doc_id}/edit"
                return {"ok": True, "gdoc_url": gdoc_url, "gdoc_id": existing_doc_id}
        except Exception:
            pass  # Fall through to create new doc

    # Create new Google Doc
    create_res = _httpx.post(
        "https://docs.googleapis.com/v1/documents",
        headers=headers,
        json={"title": title},
        timeout=15,
    )
    if create_res.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Failed to create Google Doc: {create_res.text[:200]}")

    doc_id = create_res.json()["documentId"]

    # Insert content
    _httpx.post(
        f"https://docs.googleapis.com/v1/documents/{doc_id}:batchUpdate",
        headers=headers,
        json={"requests": [{"insertText": {"location": {"index": 1}, "text": content}}]},
        timeout=15,
    )

    gdoc_url = f"https://docs.google.com/document/d/{doc_id}/edit"

    # Persist doc ID and URL
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE eln_entries SET gdoc_id = %s, gdoc_url = %s, updated_at = now() WHERE entry_id = %s::uuid",
            (doc_id, gdoc_url, entry_id),
        )
        conn.commit()
    finally:
        conn.close()

    return {"ok": True, "gdoc_url": gdoc_url, "gdoc_id": doc_id}
