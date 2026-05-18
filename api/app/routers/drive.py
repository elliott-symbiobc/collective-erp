"""
drive.py — Google Drive integration for projects.

GET    /projects/{id}/drive               — folder info + cached file list
POST   /projects/{id}/drive/link          — link a Drive folder (by URL or ID)
DELETE /projects/{id}/drive/unlink        — remove Drive link
POST   /projects/{id}/drive/sync          — re-index files from Drive
POST   /projects/{id}/drive/create        — create a new Doc / Sheet / Folder
GET    /projects/{id}/drive/files/{fid}   — read file content (exported as text)
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

router = APIRouter(prefix="/projects", tags=["drive"])

DRIVE_FILES_URL  = "https://www.googleapis.com/drive/v3/files"
DRIVE_EXPORT_URL = "https://www.googleapis.com/drive/v3/files/{id}/export"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

DRIVE_SCOPES = {"https://www.googleapis.com/auth/drive"}

MIME_ICONS = {
    "application/vnd.google-apps.document":     "doc",
    "application/vnd.google-apps.spreadsheet":  "sheet",
    "application/vnd.google-apps.presentation": "slide",
    "application/vnd.google-apps.folder":       "folder",
    "application/pdf":                          "pdf",
    "text/plain":                               "text",
}

EXPORTABLE = {
    "application/vnd.google-apps.document":     "text/plain",
    "application/vnd.google-apps.spreadsheet":  "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}


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


# ── Google token helpers ──────────────────────────────────────────────────────

def _get_token(user_id: str) -> str:
    """Return a valid Drive-scoped access token, refreshing if needed."""
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
    has_drive = any("drive" in s for s in scopes)
    if not has_drive:
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


# ── Drive API helpers ─────────────────────────────────────────────────────────

def _list_files(token: str, folder_id: str) -> list[dict]:
    params = {
        "q":                       f"'{folder_id}' in parents and trashed = false",
        "fields":                  "files(id,name,mimeType,webViewLink,modifiedTime,size)",
        "orderBy":                 "folder,name_natural",
        "pageSize":                100,
        "supportsAllDrives":       "true",
        "includeItemsFromAllDrives": "true",
    }
    r = httpx.get(DRIVE_FILES_URL, headers=_auth(token), params=params, timeout=20)
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Drive folder not found")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Drive API error: {r.text[:200]}")
    return r.json().get("files", [])


def _get_folder_name(token: str, folder_id: str) -> str:
    r = httpx.get(
        f"{DRIVE_FILES_URL}/{folder_id}",
        headers=_auth(token),
        params={"fields": "name", "supportsAllDrives": "true"},
        timeout=10,
    )
    if r.status_code != 200:
        return folder_id
    return r.json().get("name", folder_id)


def _export_text(token: str, file_id: str, mime_type: str) -> Optional[str]:
    export_mime = EXPORTABLE.get(mime_type)
    if not export_mime:
        return None
    r = httpx.get(
        DRIVE_EXPORT_URL.format(id=file_id),
        headers=_auth(token),
        params={"mimeType": export_mime},
        timeout=30,
    )
    if r.status_code != 200:
        return None
    text = r.text
    # Trim to 32k chars to avoid huge DB writes
    return text[:32768] if text else None


def _parse_folder_id(url_or_id: str) -> str:
    """Extract folder ID from a Drive URL or return as-is."""
    m = re.search(r"/folders/([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    m = re.search(r"id=([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    # Assume raw ID
    stripped = url_or_id.strip()
    if re.match(r"^[a-zA-Z0-9_-]{10,}$", stripped):
        return stripped
    raise HTTPException(status_code=400, detail="Could not parse folder ID from input")


def _serialize(obj):
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


def _row_dict(row) -> dict:
    return {k: _serialize(v) for k, v in dict(row).items()}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/drive")
def get_drive(project_id: str, request: Request):
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT drive_folder_id, drive_folder_name, drive_synced_at FROM projects WHERE project_id=%s",
            [project_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404)
        info = _row_dict(row)

        files = []
        if info.get("drive_folder_id"):
            cur.execute(
                """SELECT file_id, name, mime_type, web_view_link, modified_time, size_bytes, synced_at
                   FROM project_drive_files WHERE project_id=%s ORDER BY (mime_type = 'application/vnd.google-apps.folder') DESC, name ASC""",
                [project_id],
            )
            files = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    return {**info, "files": files}


class LinkBody(BaseModel):
    folder_url: str   # Drive URL or bare folder ID


@router.post("/{project_id}/drive/link")
def link_folder(project_id: str, body: LinkBody, request: Request):
    uid = _require_user(request)
    folder_id = _parse_folder_id(body.folder_url)
    token = _get_token(uid)

    # Verify access + get name
    folder_name = _get_folder_name(token, folder_id)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE projects SET drive_folder_id=%s, drive_folder_name=%s, updated_at=NOW() WHERE project_id=%s",
            [folder_id, folder_name, project_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404)
        conn.commit()
    finally:
        conn.close()

    # Kick off initial sync
    _do_sync(project_id, folder_id, token)

    return {"folder_id": folder_id, "folder_name": folder_name}


@router.delete("/{project_id}/drive/unlink")
def unlink_folder(project_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE projects SET drive_folder_id=NULL, drive_folder_name=NULL, drive_synced_at=NULL WHERE project_id=%s",
            [project_id],
        )
        cur.execute("DELETE FROM project_drive_files WHERE project_id=%s", [project_id])
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.post("/{project_id}/drive/sync")
def sync_drive(project_id: str, request: Request):
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT drive_folder_id FROM projects WHERE project_id=%s", [project_id])
        row = cur.fetchone()
    finally:
        conn.close()

    if not row or not row["drive_folder_id"]:
        raise HTTPException(status_code=400, detail="No Drive folder linked to this project")

    token = _get_token(uid)
    count = _do_sync(project_id, row["drive_folder_id"], token)
    return {"synced": count}


def _do_sync(project_id: str, folder_id: str, token: str) -> int:
    """Fetch files from Drive and upsert into project_drive_files."""
    files = _list_files(token, folder_id)
    conn = _conn()
    try:
        cur = conn.cursor()
        for f in files:
            mime = f.get("mimeType", "")
            mod_raw = f.get("modifiedTime")
            mod_ts  = None
            if mod_raw:
                try:
                    mod_ts = datetime.fromisoformat(mod_raw.replace("Z", "+00:00"))
                except Exception:
                    pass

            # Export text for Docs/Sheets (skip if too large)
            content = None
            size = f.get("size")
            if mime in EXPORTABLE and (not size or int(size) < 500_000):
                try:
                    content = _export_text(token, f["id"], mime)
                except Exception:
                    pass

            cur.execute(
                """
                INSERT INTO project_drive_files
                    (file_id, project_id, name, mime_type, web_view_link,
                     modified_time, size_bytes, content_text, synced_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                ON CONFLICT (file_id, project_id) DO UPDATE SET
                    name          = EXCLUDED.name,
                    mime_type     = EXCLUDED.mime_type,
                    web_view_link = EXCLUDED.web_view_link,
                    modified_time = EXCLUDED.modified_time,
                    size_bytes    = EXCLUDED.size_bytes,
                    content_text  = COALESCE(EXCLUDED.content_text, project_drive_files.content_text),
                    synced_at     = NOW()
                """,
                [
                    f["id"], project_id, f.get("name", "Untitled"), mime,
                    f.get("webViewLink"), mod_ts,
                    int(size) if size else None,
                    content,
                ],
            )

        # Remove files no longer in the folder
        live_ids = [f["id"] for f in files]
        if live_ids:
            cur.execute(
                "DELETE FROM project_drive_files WHERE project_id=%s AND file_id != ALL(%s)",
                [project_id, live_ids],
            )
        else:
            cur.execute("DELETE FROM project_drive_files WHERE project_id=%s", [project_id])

        cur.execute(
            "UPDATE projects SET drive_synced_at=NOW() WHERE project_id=%s",
            [project_id],
        )
        conn.commit()
    finally:
        conn.close()

    return len(files)


class CreateFileBody(BaseModel):
    name: str
    file_type: str = "doc"   # doc | sheet | slide | folder


GDRIVE_MIME = {
    "doc":    "application/vnd.google-apps.document",
    "sheet":  "application/vnd.google-apps.spreadsheet",
    "slide":  "application/vnd.google-apps.presentation",
    "folder": "application/vnd.google-apps.folder",
}


@router.post("/{project_id}/drive/create")
def create_file(project_id: str, body: CreateFileBody, request: Request):
    uid = _require_user(request)
    token = _get_token(uid)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT drive_folder_id FROM projects WHERE project_id=%s", [project_id])
        row = cur.fetchone()
    finally:
        conn.close()

    if not row or not row["drive_folder_id"]:
        raise HTTPException(status_code=400, detail="No Drive folder linked")

    mime = GDRIVE_MIME.get(body.file_type)
    if not mime:
        raise HTTPException(status_code=400, detail=f"Unknown file_type: {body.file_type}")

    payload = {
        "name":     body.name,
        "mimeType": mime,
        "parents":  [row["drive_folder_id"]],
    }
    r = httpx.post(
        DRIVE_FILES_URL,
        headers={**_auth(token), "Content-Type": "application/json"},
        json=payload,
        params={"fields": "id,name,mimeType,webViewLink"},
        timeout=15,
    )
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Drive create failed: {r.text[:200]}")

    created = r.json()

    # Add to cache
    conn2 = _conn()
    try:
        cur2 = conn2.cursor()
        cur2.execute(
            """INSERT INTO project_drive_files
               (file_id, project_id, name, mime_type, web_view_link, synced_at)
               VALUES (%s,%s,%s,%s,%s,NOW())
               ON CONFLICT (file_id, project_id) DO NOTHING""",
            [created["id"], project_id, created.get("name"), created.get("mimeType"),
             created.get("webViewLink")],
        )
        conn2.commit()
    finally:
        conn2.close()

    return created


@router.get("/{project_id}/drive/files/{file_id}")
def get_file_content(project_id: str, file_id: str, request: Request):
    uid = _require_user(request)

    # Try cache first
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name, mime_type, web_view_link, content_text, synced_at "
            "FROM project_drive_files WHERE file_id=%s AND project_id=%s",
            [file_id, project_id],
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if row and row["content_text"]:
        return _row_dict(row)

    # Live fetch
    token = _get_token(uid)
    r = httpx.get(
        f"{DRIVE_FILES_URL}/{file_id}",
        headers=_auth(token),
        params={"fields": "id,name,mimeType,webViewLink"},
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="File not found in Drive")

    meta = r.json()
    content = _export_text(token, file_id, meta.get("mimeType", ""))

    # Update cache
    if content:
        conn3 = _conn()
        try:
            cur3 = conn3.cursor()
            cur3.execute(
                """UPDATE project_drive_files SET content_text=%s, synced_at=NOW()
                   WHERE file_id=%s AND project_id=%s""",
                [content, file_id, project_id],
            )
            conn3.commit()
        finally:
            conn3.close()

    return {
        "file_id":      file_id,
        "name":         meta.get("name"),
        "mime_type":    meta.get("mimeType"),
        "web_view_link": meta.get("webViewLink"),
        "content_text": content,
    }