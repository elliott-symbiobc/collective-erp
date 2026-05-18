"""
marketing.py — Marketing module: Key Language library with Google Doc bidirectional sync.

GET    /marketing/key-language              — list all entries
POST   /marketing/key-language              — create entry
PATCH  /marketing/key-language/{id}         — update entry
DELETE /marketing/key-language/{id}         — delete entry
GET    /marketing/key-language/doc          — get linked Google Doc info
POST   /marketing/key-language/doc/link     — link a Google Doc (by URL or ID)
DELETE /marketing/key-language/doc/unlink   — unlink Google Doc
POST   /marketing/key-language/doc/push     — push library entries → Google Doc
POST   /marketing/key-language/doc/pull     — pull Google Doc → library entries
"""

import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/marketing", tags=["marketing"])

GOOGLE_TOKEN_URL  = "https://oauth2.googleapis.com/token"
DRIVE_FILES_URL   = "https://www.googleapis.com/drive/v3/files"
DRIVE_EXPORT_URL  = "https://www.googleapis.com/drive/v3/files/{id}/export"
DOCS_API_BASE     = "https://docs.googleapis.com/v1/documents"


# ── DB helpers ────────────────────────────────────────────────────────────────

def _conn():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return conn


def _require_user(request: Request) -> str:
    uid = request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return uid


def _serialize(obj):
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


def _row_dict(row) -> dict:
    return {k: _serialize(v) for k, v in dict(row).items()}


# ── Google token helpers (mirrors drive.py) ───────────────────────────────────

def _get_token(user_id: str) -> str:
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT access_token, refresh_token, token_expiry, scopes "
            "FROM google_oauth_tokens WHERE user_id = %s",
            [user_id],
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(
            status_code=403,
            detail={"code": "no_google_token", "message": "Google account not connected. Connect via Contacts → Google."},
        )

    scopes = row["scopes"] or []
    if not any("drive" in s for s in scopes):
        raise HTTPException(
            status_code=403,
            detail={"code": "needs_drive_scope", "message": "Drive access not granted. Re-connect Google account to enable Drive."},
        )

    expiry = row["token_expiry"]
    if expiry and datetime.now(timezone.utc) >= expiry - timedelta(minutes=2):
        r = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id":     os.environ.get("GOOGLE_CLIENT_ID", ""),
                "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
                "refresh_token": row["refresh_token"],
                "grant_type":    "refresh_token",
            },
            timeout=15,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to refresh Google token")
        data = r.json()
        new_token  = data["access_token"]
        new_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
        conn2 = _conn()
        try:
            cur2 = conn2.cursor()
            cur2.execute(
                "UPDATE google_oauth_tokens SET access_token=%s, token_expiry=%s, updated_at=NOW() WHERE user_id=%s",
                [new_token, new_expiry, user_id],
            )
            conn2.commit()
        finally:
            conn2.close()
        return new_token

    return row["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Doc ID parsing ────────────────────────────────────────────────────────────

def _parse_doc_id(url_or_id: str) -> str:
    """Extract Google Doc ID from a URL or return as-is."""
    m = re.search(r"/document/d/([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    stripped = url_or_id.strip()
    if re.match(r"^[a-zA-Z0-9_-]{20,}$", stripped):
        return stripped
    raise HTTPException(status_code=400, detail="Could not parse Google Doc ID from input")


# ── Doc text format ───────────────────────────────────────────────────────────
#
# The Google Doc uses this human-readable plain-text format:
#
#   # Collective ERP Key Language Library
#
#   ---
#
#   ## Category Name
#
#   **Term**
#   Content text here.
#
#   **Another Term**
#   More content.
#
#   ---
#
#   ## Uncategorized
#   ...

def _entries_to_text(entries: list[dict]) -> str:
    """
    Produce plain text for a Google Doc. Format:

        KEY LANGUAGE LIBRARY — Collective ERP

        ════════════════════════════════
        TAGLINE
        ════════════════════════════════

        [Tagline]
        Content here.

        ════════════════════════════════
        GENERAL DESCRIPTIONS
        ════════════════════════════════

        [Sentence]
        Content here.

        [Short]
        Content here.
    """
    from collections import defaultdict
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        cat = (e.get("category") or "").strip() or "Uncategorized"
        by_cat[cat].append(e)

    divider = "═" * 40
    lines = ["KEY LANGUAGE LIBRARY — Collective ERP", ""]
    for cat, items in by_cat.items():
        lines += [divider, cat.upper(), divider, ""]
        for item in items:
            term = item["term"].strip()
            content = (item.get("content") or "").strip()
            lines.append(f"[{term}]")
            lines.append(content if content else "(empty)")
            if item.get("notes", "").strip():
                lines.append(f"Notes: {item['notes'].strip()}")
            lines.append("")
        lines.append("")
    return "\n".join(lines)


def _text_to_entries(text: str) -> list[dict]:
    """Parse the Google Doc plain-text format back into entry dicts."""
    entries = []
    current_category = ""
    current_term: Optional[str] = None
    current_content_lines: list[str] = []

    def flush():
        nonlocal current_term, current_content_lines
        if current_term:
            content = "\n".join(current_content_lines).strip()
            if content.lower() == "(empty)":
                content = ""
            entries.append({
                "term":     current_term,
                "content":  content,
                "category": current_category,
                "notes":    "",
            })
        current_term = None
        current_content_lines = []

    divider_pat = re.compile(r"^[═=─-]{10,}$")

    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()

        # Divider line — next non-empty line is the category name
        if divider_pat.match(line.strip()):
            flush()
            i += 1
            # Peek ahead for category name (skip blank lines)
            while i < len(lines) and not lines[i].strip():
                i += 1
            if i < len(lines):
                candidate = lines[i].strip()
                # Only treat as category if followed by another divider
                if i + 1 < len(lines) and divider_pat.match(lines[i + 1].strip()):
                    current_category = candidate.title()
                    i += 2  # skip the closing divider
                    continue
            continue

        # Term label: [Term Name]
        term_match = re.match(r"^\[(.+?)\]\s*$", line)
        if term_match:
            flush()
            current_term = term_match.group(1).strip()
            i += 1
            continue

        # Notes line
        if line.startswith("Notes:") and current_term:
            # Ignore notes on pull (they're informational)
            i += 1
            continue

        # Skip header line and empty lines outside term blocks
        if current_term is not None and line:
            current_content_lines.append(line)

        i += 1

    flush()
    return entries


# ── Key Language CRUD ─────────────────────────────────────────────────────────

DEFAULT_SLOTS = [
    {"category": "Tagline",                "terms": ["Tagline"]},
    {"category": "General Descriptions",   "terms": ["Sentence", "Short", "Long"]},
    {"category": "Technical Descriptions", "terms": ["Sentence", "Short", "Long"]},
    {"category": "Investor Descriptions",  "terms": ["Sentence", "Short", "Long"]},
    {"category": "Bakery Descriptions",    "terms": ["Sentence", "Short", "Long"]},
]


@router.get("/key-language")
def list_key_language(request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, term, content, category, notes, sort_order, created_at, updated_at "
            "FROM key_language ORDER BY category, sort_order, term"
        )
        entries = [_row_dict(r) for r in cur.fetchall()]

        cur.execute(
            "SELECT key_language_doc_id, key_language_doc_url, key_language_synced_at, slots_config "
            "FROM marketing_settings WHERE id=1"
        )
        settings = cur.fetchone()
    finally:
        conn.close()

    settings_dict = _row_dict(settings) if settings else {}
    slots = settings_dict.pop("slots_config", None) or DEFAULT_SLOTS

    return {
        "entries": entries,
        "doc": settings_dict,
        "slots": slots,
    }


class RenameCategoryBody(BaseModel):
    old_name: str
    new_name: str


@router.post("/key-language/category/rename")
def rename_category(body: RenameCategoryBody, request: Request):
    _require_user(request)
    if not body.new_name.strip():
        raise HTTPException(status_code=400, detail="New name cannot be empty")
    conn = _conn()
    try:
        cur = conn.cursor()
        # Update all entries with the old category name
        cur.execute(
            "UPDATE key_language SET category=%s, updated_at=NOW() WHERE category=%s",
            [body.new_name.strip(), body.old_name],
        )
        # Update slots_config JSON
        cur.execute("SELECT slots_config FROM marketing_settings WHERE id=1")
        row = cur.fetchone()
        slots = row["slots_config"] if row and row["slots_config"] else DEFAULT_SLOTS
        updated_slots = [
            {**s, "category": body.new_name.strip()} if s["category"] == body.old_name else s
            for s in slots
        ]
        import json
        cur.execute(
            "UPDATE marketing_settings SET slots_config=%s::jsonb WHERE id=1",
            [json.dumps(updated_slots)],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "slots": updated_slots}


class CreateEntryBody(BaseModel):
    term: str
    content: str = ""
    category: str = ""
    notes: str = ""
    sort_order: int = 0


@router.post("/key-language")
def create_entry(body: CreateEntryBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO key_language (term, content, category, notes, sort_order)
               VALUES (%s, %s, %s, %s, %s) RETURNING *""",
            [body.term, body.content, body.category, body.notes, body.sort_order],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


class UpdateEntryBody(BaseModel):
    term: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


@router.patch("/key-language/{entry_id}")
def update_entry(entry_id: str, body: UpdateEntryBody, request: Request):
    _require_user(request)
    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k}=%s" for k in fields)
    values = list(fields.values()) + [entry_id]
    conn = _conn()
    try:
        cur = conn.cursor()
        # Snapshot current content into history before overwriting
        if "content" in fields:
            cur.execute("SELECT content FROM key_language WHERE id=%s", [entry_id])
            old = cur.fetchone()
            if old and old["content"]:
                cur.execute(
                    "INSERT INTO key_language_history (entry_id, content) VALUES (%s, %s)",
                    [entry_id, old["content"]],
                )
        cur.execute(
            f"UPDATE key_language SET {set_clause}, updated_at=NOW() WHERE id=%s RETURNING *",
            values,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.get("/key-language/{entry_id}/history")
def get_entry_history(entry_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, content, saved_at FROM key_language_history WHERE entry_id=%s ORDER BY saved_at DESC LIMIT 50",
            [entry_id],
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return rows


class RestoreBody(BaseModel):
    history_id: str


@router.post("/key-language/{entry_id}/restore")
def restore_entry(entry_id: str, body: RestoreBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT content FROM key_language_history WHERE id=%s AND entry_id=%s",
            [body.history_id, entry_id],
        )
        hist = cur.fetchone()
        if not hist:
            raise HTTPException(status_code=404, detail="History record not found")
        # Save current to history first
        cur.execute("SELECT content FROM key_language WHERE id=%s", [entry_id])
        old = cur.fetchone()
        if old and old["content"]:
            cur.execute(
                "INSERT INTO key_language_history (entry_id, content) VALUES (%s, %s)",
                [entry_id, old["content"]],
            )
        cur.execute(
            "UPDATE key_language SET content=%s, updated_at=NOW() WHERE id=%s RETURNING *",
            [hist["content"], entry_id],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.delete("/key-language/{entry_id}")
def delete_entry(entry_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM key_language WHERE id=%s", [entry_id])
        if cur.rowcount == 0:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── Google Doc link / unlink ──────────────────────────────────────────────────

class LinkDocBody(BaseModel):
    doc_url: str


@router.post("/key-language/doc/link")
def link_doc(body: LinkDocBody, request: Request):
    uid = _require_user(request)
    doc_id = _parse_doc_id(body.doc_url)
    token = _get_token(uid)

    # Verify access by fetching doc metadata
    r = httpx.get(
        f"{DRIVE_FILES_URL}/{doc_id}",
        headers=_auth(token),
        params={"fields": "id,name,webViewLink,mimeType", "supportsAllDrives": "true"},
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail="Could not access the Google Doc. Check permissions.")
    meta = r.json()
    if meta.get("mimeType") != "application/vnd.google-apps.document":
        raise HTTPException(status_code=400, detail="The linked file must be a Google Doc (not a Sheet, Folder, etc.)")

    doc_url = meta.get("webViewLink", body.doc_url)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE marketing_settings SET key_language_doc_id=%s, key_language_doc_url=%s WHERE id=1",
            [doc_id, doc_url],
        )
        conn.commit()
    finally:
        conn.close()

    return {"doc_id": doc_id, "doc_url": doc_url, "name": meta.get("name")}


@router.delete("/key-language/doc/unlink")
def unlink_doc(request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE marketing_settings SET key_language_doc_id=NULL, key_language_doc_url=NULL, key_language_synced_at=NULL WHERE id=1"
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── Push: DB → Google Doc ─────────────────────────────────────────────────────

@router.post("/key-language/doc/push")
def push_to_doc(request: Request):
    uid = _require_user(request)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT key_language_doc_id FROM marketing_settings WHERE id=1")
        row = cur.fetchone()
        if not row or not row["key_language_doc_id"]:
            raise HTTPException(status_code=400, detail="No Google Doc linked")
        doc_id = row["key_language_doc_id"]

        cur.execute(
            "SELECT term, content, category, notes FROM key_language ORDER BY category, sort_order, term"
        )
        entries = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    token = _get_token(uid)
    new_text = _entries_to_text(entries)

    # Get current document end index
    r = httpx.get(f"{DOCS_API_BASE}/{doc_id}", headers=_auth(token), timeout=15)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Could not read Google Doc: {r.text[:200]}")

    doc = r.json()
    body_content = doc.get("body", {}).get("content", [])
    end_index = 1
    for element in body_content:
        ei = element.get("endIndex")
        if ei:
            end_index = ei

    # Build batchUpdate requests: delete all then insert fresh.
    # end_index == 2 means only the implicit trailing newline exists (empty doc);
    # deleteContentRange requires startIndex < endIndex, so skip it in that case.
    requests = []
    if end_index > 2:
        requests.append({
            "deleteContentRange": {
                "range": {"startIndex": 1, "endIndex": end_index - 1}
            }
        })
    requests.append({
        "insertText": {
            "location": {"index": 1},
            "text": new_text,
        }
    })

    r2 = httpx.post(
        f"{DOCS_API_BASE}/{doc_id}:batchUpdate",
        headers={**_auth(token), "Content-Type": "application/json"},
        json={"requests": requests},
        timeout=30,
    )
    if r2.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Google Docs write failed: {r2.text[:300]}")

    # Update synced_at
    conn2 = _conn()
    try:
        cur2 = conn2.cursor()
        cur2.execute("UPDATE marketing_settings SET key_language_synced_at=NOW() WHERE id=1")
        conn2.commit()
    finally:
        conn2.close()

    return {"ok": True, "pushed": len(entries)}


# ── Doc change check ─────────────────────────────────────────────────────────

@router.get("/key-language/doc/check")
def check_doc_sync(request: Request):
    """Return whether the linked Google Doc has been modified since last sync."""
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT key_language_doc_id, key_language_synced_at FROM marketing_settings WHERE id=1"
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row or not row["key_language_doc_id"]:
        return {"needs_pull": False}

    doc_id = row["key_language_doc_id"]
    synced_at = row["key_language_synced_at"]

    try:
        token = _get_token(uid)
    except HTTPException:
        return {"needs_pull": False}

    r = httpx.get(
        f"{DRIVE_FILES_URL}/{doc_id}",
        headers=_auth(token),
        params={"fields": "id,modifiedTime", "supportsAllDrives": "true"},
        timeout=10,
    )
    if r.status_code != 200:
        return {"needs_pull": False}

    doc_modified_at = r.json().get("modifiedTime")
    if not doc_modified_at:
        return {"needs_pull": False}

    if synced_at is None:
        return {"needs_pull": True, "doc_modified_at": doc_modified_at}

    doc_dt = datetime.fromisoformat(doc_modified_at.replace("Z", "+00:00"))
    needs_pull = doc_dt > synced_at
    return {"needs_pull": needs_pull, "doc_modified_at": doc_modified_at}


# ── Pull: Google Doc → DB ─────────────────────────────────────────────────────

@router.post("/key-language/doc/pull")
def pull_from_doc(request: Request):
    uid = _require_user(request)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT key_language_doc_id FROM marketing_settings WHERE id=1")
        row = cur.fetchone()
        if not row or not row["key_language_doc_id"]:
            raise HTTPException(status_code=400, detail="No Google Doc linked")
        doc_id = row["key_language_doc_id"]
    finally:
        conn.close()

    token = _get_token(uid)

    # Export doc as plain text
    r = httpx.get(
        DRIVE_EXPORT_URL.format(id=doc_id),
        headers=_auth(token),
        params={"mimeType": "text/plain"},
        timeout=30,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Could not export Google Doc: {r.text[:200]}")

    entries = _text_to_entries(r.text)
    if not entries:
        raise HTTPException(status_code=422, detail="No valid entries found in the document. Check the formatting.")

    # Replace all existing entries with parsed ones
    conn2 = _conn()
    try:
        cur2 = conn2.cursor()
        cur2.execute("DELETE FROM key_language")
        for i, e in enumerate(entries):
            cur2.execute(
                """INSERT INTO key_language (term, content, category, notes, sort_order)
                   VALUES (%s, %s, %s, %s, %s)""",
                [e["term"], e["content"], e["category"], e["notes"], i],
            )
        cur2.execute("UPDATE marketing_settings SET key_language_synced_at=NOW() WHERE id=1")
        conn2.commit()
    finally:
        conn2.close()

    return {"ok": True, "imported": len(entries)}


# ── Pitch Decks ───────────────────────────────────────────────────────────────

DECK_TYPES = [
    "Investor Deck",
    "Post-NDA Investor Deck",
    "Client Deck — General",
    "Client Deck — Bakery",
    "Partner Deck — Technical",
]


def _parse_drive_file_id(url_or_id: str) -> str:
    """Extract a Drive file ID from various URL formats."""
    stripped = url_or_id.strip()
    # /file/d/{id}/
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", stripped)
    if m:
        return m.group(1)
    # /presentation/d/{id}/ or /document/d/{id}/
    m = re.search(r"/(?:presentation|document|spreadsheets)/d/([a-zA-Z0-9_-]+)", stripped)
    if m:
        return m.group(1)
    # ?id={id} or open?id={id}
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", stripped)
    if m:
        return m.group(1)
    # raw ID
    if re.match(r"^[a-zA-Z0-9_-]{20,}$", stripped):
        return stripped
    raise HTTPException(status_code=400, detail="Could not parse Drive file ID from URL")


class ResolveFileBody(BaseModel):
    url: str


@router.post("/pitch-decks/file/resolve")
def resolve_drive_file(body: ResolveFileBody, request: Request):
    """Resolve a Drive URL → file name and web link."""
    uid = _require_user(request)
    file_id = _parse_drive_file_id(body.url)
    token = _get_token(uid)
    r = httpx.get(
        f"{DRIVE_FILES_URL}/{file_id}",
        headers=_auth(token),
        params={"fields": "id,name,mimeType,webViewLink", "supportsAllDrives": "true"},
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail="Could not access this file. Check that it's shared with your Google account.")
    meta = r.json()
    return {
        "file_id":      meta["id"],
        "name":         meta.get("name", "Untitled"),
        "mime_type":    meta.get("mimeType"),
        "web_view_link": meta.get("webViewLink"),
    }


class PitchDeckBody(BaseModel):
    title: str
    description: str = ""
    pdf_url:   Optional[str] = None
    pdf_name:  Optional[str] = None
    pptx_url:  Optional[str] = None
    pptx_name: Optional[str] = None


class PitchDeckFileBody(BaseModel):
    slot: str   # "pdf" or "pptx"
    url:  str
    name: str


@router.get("/pitch-decks")
def list_pitch_decks(request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, title, description, pdf_url, pdf_name, pptx_url, pptx_name, created_at, updated_at "
            "FROM pitch_decks ORDER BY created_at ASC"
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return {"decks": rows, "deck_types": DECK_TYPES}


@router.post("/pitch-decks")
def create_pitch_deck(body: PitchDeckBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO pitch_decks (title, description, pdf_url, pdf_name, pptx_url, pptx_name)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
            [body.title, body.description, body.pdf_url, body.pdf_name, body.pptx_url, body.pptx_name],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.patch("/pitch-decks/{deck_id}")
def update_pitch_deck(deck_id: str, body: PitchDeckBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE pitch_decks
               SET title=%s, description=%s, pdf_url=%s, pdf_name=%s,
                   pptx_url=%s, pptx_name=%s, updated_at=NOW()
               WHERE id=%s RETURNING *""",
            [body.title, body.description, body.pdf_url, body.pdf_name,
             body.pptx_url, body.pptx_name, deck_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.patch("/pitch-decks/{deck_id}/file")
def attach_file(deck_id: str, body: PitchDeckFileBody, request: Request):
    """Attach or replace a single file slot (pdf or pptx)."""
    _require_user(request)
    if body.slot not in ("pdf", "pptx"):
        raise HTTPException(status_code=400, detail="slot must be 'pdf' or 'pptx'")
    url_col  = f"{body.slot}_url"
    name_col = f"{body.slot}_name"
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE pitch_decks SET {url_col}=%s, {name_col}=%s, updated_at=NOW() WHERE id=%s RETURNING *",
            [body.url, body.name, deck_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.delete("/pitch-decks/{deck_id}/file/{slot}")
def detach_file(deck_id: str, slot: str, request: Request):
    """Remove a file attachment from a slot."""
    _require_user(request)
    if slot not in ("pdf", "pptx"):
        raise HTTPException(status_code=400, detail="slot must be 'pdf' or 'pptx'")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE pitch_decks SET {slot}_url=NULL, {slot}_name=NULL, updated_at=NOW() WHERE id=%s RETURNING *",
            [deck_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.delete("/pitch-decks/{deck_id}")
def delete_pitch_deck(deck_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM pitch_decks WHERE id=%s", [deck_id])
        if cur.rowcount == 0:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── Assets ────────────────────────────────────────────────────────────────────

ASSET_TYPES = ["logo", "image", "document", "video", "link", "other"]


class AssetBody(BaseModel):
    title: str
    url: str = ""
    asset_type: str = "other"
    description: str = ""


@router.get("/assets")
def list_assets(request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, title, url, asset_type, description, created_at, updated_at "
            "FROM marketing_assets ORDER BY asset_type, title"
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return rows


@router.post("/assets")
def create_asset(body: AssetBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO marketing_assets (title, url, asset_type, description)
               VALUES (%s, %s, %s, %s) RETURNING *""",
            [body.title, body.url, body.asset_type, body.description],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.patch("/assets/{asset_id}")
def update_asset(asset_id: str, body: AssetBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE marketing_assets
               SET title=%s, url=%s, asset_type=%s, description=%s, updated_at=NOW()
               WHERE id=%s RETURNING *""",
            [body.title, body.url, body.asset_type, body.description, asset_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return _row_dict(row)


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM marketing_assets WHERE id=%s", [asset_id])
        if cur.rowcount == 0:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# WordPress Website Integration
# ─────────────────────────────────────────────────────────────────────────────

WP_BASE_URL    = os.environ.get("WP_BASE_URL", "http://wordpress-production")
WP_APP_USER    = os.environ.get("WP_APP_USER", "admin")
WP_APP_PASSWORD = os.environ.get("WP_APP_PASSWORD", "")

_WP_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SymbioPlatform/1.0)"}

WP_KNOWN_PAGES = [
    {"id": 44,  "slug": "home",           "label": "Home"},
    {"id": 133, "slug": "news",           "label": "News"},
    {"id": 124, "slug": "team",           "label": "Team"},
    {"id": 110, "slug": "privacy-policy", "label": "Privacy Policy"},
    {"id": 259, "slug": "impact",         "label": "Impact"},
    {"id": 273, "slug": "appreciations",  "label": "Appreciations"},
    {"id": 313, "slug": "contact",        "label": "Contact"},
    {"id": 314, "slug": "technology",     "label": "Technology"},
]

ACF_BLOCK_FIELDS = {
    "page-header":      ["heading", "subheading"],
    "hero":             ["heading", "subheading", "cta_text", "cta_url"],
    "value-props":      ["title", "items"],
    "kpi-strip":        ["kpis"],
    "cta-dark":         ["heading", "subheading", "cta_text", "cta_url"],
    "technology":       ["heading", "body", "image_caption"],
    "process":          ["heading", "steps"],
    "applications-grid":["heading", "items"],
    "testimonials":     ["heading", "items"],
}


def _wp_auth() -> tuple[str, str]:
    return (WP_APP_USER, WP_APP_PASSWORD)


def _wp_get(path: str, params: dict | None = None):
    url = f"{WP_BASE_URL}/wp-json/wp/v2{path}"
    r = httpx.get(url, auth=_wp_auth(), params=params or {}, headers=_WP_HEADERS, timeout=15)
    if not r.is_success:
        raise HTTPException(status_code=r.status_code, detail=r.text[:300])
    return r.json()


def _wp_post(path: str, body: dict):
    url = f"{WP_BASE_URL}/wp-json/wp/v2{path}"
    r = httpx.post(url, auth=_wp_auth(), json=body, headers=_WP_HEADERS, timeout=15)
    if not r.is_success:
        raise HTTPException(status_code=r.status_code, detail=r.text[:300])
    return r.json()


def _wp_patch(path: str, body: dict):
    url = f"{WP_BASE_URL}/wp-json/wp/v2{path}"
    r = httpx.patch(url, auth=_wp_auth(), json=body, headers=_WP_HEADERS, timeout=15)
    if not r.is_success:
        raise HTTPException(status_code=r.status_code, detail=r.text[:300])
    return r.json()


def _wp_delete(path: str):
    url = f"{WP_BASE_URL}/wp-json/wp/v2{path}"
    r = httpx.delete(url, auth=_wp_auth(), headers=_WP_HEADERS, timeout=15)
    if not r.is_success:
        raise HTTPException(status_code=r.status_code, detail=r.text[:300])
    return r.json()


def _wp_post_summary(p: dict) -> dict:
    return {
        "id": p["id"],
        "slug": p.get("slug", ""),
        "title": p.get("title", {}).get("rendered", ""),
        "status": p.get("status", ""),
        "date": p.get("date", ""),
        "modified": p.get("modified", ""),
        "link": p.get("link", ""),
        "excerpt": p.get("excerpt", {}).get("rendered", ""),
        "featured_media": p.get("featured_media", 0),
        "categories": p.get("categories", []),
        "tags": p.get("tags", []),
    }


def _extract_acf_blocks(raw_content: str) -> list[dict]:
    """Parse wp:acf/block-name comments and extract block data."""
    import json as _json
    blocks = []
    pattern = re.compile(
        r'<!-- wp:acf/([a-z0-9_-]+)\s+(\{.*?\})\s*/-->',
        re.DOTALL
    )
    for m in pattern.finditer(raw_content):
        block_name = m.group(1)
        try:
            data = _json.loads(m.group(2))
        except Exception:
            data = {}
        acf = data.get("data", {})
        blocks.append({
            "block": block_name,
            "raw_data": data,
            "acf": acf,
            "fields": ACF_BLOCK_FIELDS.get(block_name, list(acf.keys())),
        })
    return blocks


# ── Posts ────────────────────────────────────────────────────────────────────

@router.get("/website/posts")
def list_posts(request: Request, page: int = 1, per_page: int = 20, status: str = "any"):
    _require_user(request)
    params = {"page": page, "per_page": per_page, "status": status, "_embed": 1}
    posts = _wp_get("/posts", params)
    return [_wp_post_summary(p) for p in posts]


@router.get("/website/posts/{post_id}")
def get_post(post_id: int, request: Request):
    _require_user(request)
    p = _wp_get(f"/posts/{post_id}")
    return {
        **_wp_post_summary(p),
        "content": p.get("content", {}).get("raw", p.get("content", {}).get("rendered", "")),
        "content_rendered": p.get("content", {}).get("rendered", ""),
    }


class PostBody(BaseModel):
    title: str
    content: str = ""
    status: str = "draft"
    excerpt: str = ""
    categories: list[int] = []
    tags: list[int] = []
    date: Optional[str] = None  # ISO 8601, local time (WP treats as site timezone)


@router.post("/website/posts")
def create_post(body: PostBody, request: Request):
    _require_user(request)
    payload: dict = {
        "title": body.title,
        "content": body.content,
        "status": body.status,
        "excerpt": body.excerpt,
        "categories": body.categories,
        "tags": body.tags,
    }
    if body.date:
        payload["date"] = body.date
    p = _wp_post("/posts", payload)
    return _wp_post_summary(p)


class PostPatchBody(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None
    excerpt: Optional[str] = None
    categories: Optional[list[int]] = None
    tags: Optional[list[int]] = None
    date: Optional[str] = None


@router.patch("/website/posts/{post_id}")
def update_post(post_id: int, body: PostPatchBody, request: Request):
    _require_user(request)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    p = _wp_patch(f"/posts/{post_id}", payload)
    return _wp_post_summary(p)


@router.delete("/website/posts/{post_id}")
def delete_post(post_id: int, request: Request):
    _require_user(request)
    _wp_delete(f"/posts/{post_id}?force=true")
    return {"ok": True}


# ── Pages ────────────────────────────────────────────────────────────────────

def _wp_get_page(page_id: int) -> dict:
    """Fetch a WP page, falling back from edit context to view context on error."""
    try:
        return _wp_get(f"/pages/{page_id}", {"context": "edit"})
    except Exception:
        return _wp_get(f"/pages/{page_id}")


@router.get("/website/pages")
def list_pages(request: Request):
    _require_user(request)
    pages = []
    for pg in WP_KNOWN_PAGES:
        try:
            p = _wp_get_page(pg["id"])
            content = p.get("content", {})
            raw = content.get("raw") or content.get("rendered", "")
            pages.append({
                "id": pg["id"],
                "slug": pg["slug"],
                "label": pg["label"],
                "title": p.get("title", {}).get("rendered", pg["label"]),
                "modified": p.get("modified", ""),
                "link": p.get("link", ""),
                "blocks": _extract_acf_blocks(raw),
            })
        except Exception as e:
            pages.append({
                "id": pg["id"],
                "slug": pg["slug"],
                "label": pg["label"],
                "title": pg["label"],
                "modified": "",
                "link": "",
                "blocks": [],
                "error": str(e),
            })
    return pages


@router.get("/website/pages/{page_id}")
def get_page(page_id: int, request: Request):
    _require_user(request)
    p = _wp_get_page(page_id)
    content = p.get("content", {})
    raw = content.get("raw") or content.get("rendered", "")
    return {
        "id": p["id"],
        "slug": p.get("slug", ""),
        "title": p.get("title", {}).get("rendered", ""),
        "modified": p.get("modified", ""),
        "link": p.get("link", ""),
        "raw_content": raw,
        "blocks": _extract_acf_blocks(raw),
    }


class PageBlockPatch(BaseModel):
    block: str
    field: str
    value: str
    block_index: int = 0


@router.patch("/website/pages/{page_id}/block")
def patch_page_block(page_id: int, body: PageBlockPatch, request: Request):
    """Update a single ACF block field in a page's raw content."""
    import json as _json
    _require_user(request)
    p = _wp_get_page(page_id)
    content = p.get("content", {})
    raw = content.get("raw") or content.get("rendered", "")

    pattern = re.compile(
        r'(<!-- wp:acf/' + re.escape(body.block) + r'\s+)(\{.*?\})(\s*/-->)',
        re.DOTALL
    )
    matches = list(pattern.finditer(raw))
    if body.block_index >= len(matches):
        raise HTTPException(status_code=404, detail="Block not found")

    m = matches[body.block_index]
    try:
        data = _json.loads(m.group(2))
    except Exception:
        raise HTTPException(status_code=422, detail="Block data not parseable")

    if "data" not in data:
        data["data"] = {}
    data["data"][body.field] = body.value

    new_comment = m.group(1) + _json.dumps(data) + m.group(3)
    new_raw = raw[:m.start()] + new_comment + raw[m.end():]
    _wp_patch(f"/pages/{page_id}", {"content": new_raw})
    return {"ok": True}


# ── Categories & Tags ────────────────────────────────────────────────────────

@router.get("/website/categories")
def list_categories(request: Request):
    _require_user(request)
    return _wp_get("/categories", {"per_page": 100})


@router.get("/website/tags")
def list_tags(request: Request):
    _require_user(request)
    return _wp_get("/tags", {"per_page": 100})


# ─────────────────────────────────────────────────────────────────────────────
# Brand Asset File Upload / Download
# ─────────────────────────────────────────────────────────────────────────────

import uuid as _uuid_mod
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse

BRAND_UPLOAD_DIR = "/app/uploads/brand"
BRAND_CATEGORIES = ["logo", "letter_mark", "brand_guidelines", "tagline", "icons"]

os.makedirs(BRAND_UPLOAD_DIR, exist_ok=True)


@router.get("/brand-assets")
def list_brand_assets(request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, category, original_name, mime_type, file_size, created_at "
            "FROM marketing_brand_files ORDER BY category, created_at"
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    grouped: dict = {c: [] for c in BRAND_CATEGORIES}
    for r in rows:
        cat = r["category"]
        if cat not in grouped:
            grouped[cat] = []
        grouped[cat].append({
            "id": str(r["id"]),
            "category": cat,
            "original_name": r["original_name"],
            "mime_type": r["mime_type"] or "",
            "file_size": r["file_size"] or 0,
            "created_at": r["created_at"].isoformat() if r["created_at"] else "",
        })
    return grouped


@router.post("/brand-assets/upload")
async def upload_brand_asset(
    request: Request,
    category: str = Form(...),
    file: UploadFile = File(...),
):
    _require_user(request)
    if category not in BRAND_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {category}")

    file_id = str(_uuid_mod.uuid4())
    ext = os.path.splitext(file.filename or "")[1]
    stored_name = f"{file_id}{ext}"
    dest = os.path.join(BRAND_UPLOAD_DIR, stored_name)

    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """INSERT INTO marketing_brand_files
               (id, category, original_name, stored_name, mime_type, file_size)
               VALUES (%s, %s, %s, %s, %s, %s)
               RETURNING id, category, original_name, mime_type, file_size, created_at""",
            [file_id, category, file.filename, stored_name,
             file.content_type, len(content)],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    return {
        "id": str(row["id"]),
        "category": row["category"],
        "original_name": row["original_name"],
        "mime_type": row["mime_type"] or "",
        "file_size": row["file_size"] or 0,
        "created_at": row["created_at"].isoformat() if row["created_at"] else "",
    }


@router.get("/brand-assets/{file_id}/download")
def download_brand_asset(file_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT original_name, stored_name, mime_type FROM marketing_brand_files WHERE id=%s",
            [file_id],
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404)

    path = os.path.join(BRAND_UPLOAD_DIR, row["stored_name"])
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=path,
        filename=row["original_name"],
        media_type=row["mime_type"] or "application/octet-stream",
    )


@router.delete("/brand-assets/{file_id}")
def delete_brand_asset(file_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "DELETE FROM marketing_brand_files WHERE id=%s RETURNING stored_name",
            [file_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()

    path = os.path.join(BRAND_UPLOAD_DIR, row["stored_name"])
    try:
        os.remove(path)
    except FileNotFoundError:
        pass

    return {"ok": True}
