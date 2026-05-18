"""
portal.py — Client-facing document portals.

Public (no auth):
  GET  /portal/{token}                          — project info + file list (or {password_required:true})
  POST /portal/{token}/auth                     — authenticate with password, receive session token
  GET  /portal/{token}/files/{file_id}/download — proxy file download from Drive
  GET  /portal/{token}/folders/{folder_id}      — list subfolder contents
  POST /portal/{token}/track                    — log viewer activity (page visit, file view)

Authenticated (X-User-Id required):
  POST   /projects/{project_id}/portal                        — create portal link
  GET    /projects/{project_id}/portal                        — get portal info
  PATCH  /projects/{project_id}/portal/folder                 — set/change portal's own Drive folder
  PATCH  /projects/{project_id}/portal/content                — set description / password settings
  PATCH  /projects/{project_id}/portal/slug                   — set/clear custom short slug
  PATCH  /projects/{project_id}/portal/assign                 — assign/unassign employee
  PATCH  /projects/{project_id}/portal/category               — set category (client/investor/partner)
  GET    /projects/{project_id}/portal/content                — get description + contacts + updates
  POST   /projects/{project_id}/portal/contacts               — add contact
  PATCH  /projects/{project_id}/portal/contacts/{cid}         — edit contact
  DELETE /projects/{project_id}/portal/contacts/{cid}         — delete contact
  POST   /projects/{project_id}/portal/updates                — post update
  DELETE /projects/{project_id}/portal/updates/{uid}          — delete update
  DELETE /projects/{project_id}/portal                        — revoke portal
  GET    /portals                                             — list all portals

  GET    /projects/{project_id}/portal/viewers                — list investors/viewers
  POST   /projects/{project_id}/portal/viewers                — add investor with password
  PATCH  /projects/{project_id}/portal/viewers/{vid}          — update investor
  DELETE /projects/{project_id}/portal/viewers/{vid}          — remove investor
  GET    /projects/{project_id}/portal/activity               — access log
"""

import logging
import os
from datetime import datetime, timezone

import httpx
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional

try:
    import bcrypt as bcrypt_lib
except ImportError:
    bcrypt_lib = None  # type: ignore

logger = logging.getLogger(__name__)

router = APIRouter(tags=["portal"])

DRIVE_FILES_URL  = "https://www.googleapis.com/drive/v3/files"
DRIVE_EXPORT_URL = "https://www.googleapis.com/drive/v3/files/{id}/export"

EXPORTABLE_TO_PDF = {
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.google-apps.presentation",
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


def _serialize(obj):
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


def _row_dict(row) -> dict:
    return {k: _serialize(v) for k, v in dict(row).items()}


def _hash_password(password: str) -> str:
    if bcrypt_lib is None:
        raise HTTPException(status_code=500, detail="bcrypt not available")
    return bcrypt_lib.hashpw(password.encode(), bcrypt_lib.gensalt()).decode()


def _check_password(password: str, hashed: str) -> bool:
    if bcrypt_lib is None:
        return False
    try:
        return bcrypt_lib.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


def _get_active_portal_id(cur, project_id: str) -> str:
    """Return portal_id for the active portal of project_id, or raise 404."""
    cur.execute(
        "SELECT portal_id FROM project_portals WHERE project_id=%s AND is_active=true",
        [project_id],
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No active portal for this project")
    return str(row["portal_id"])


# ── Token validation ──────────────────────────────────────────────────────────

def _validate_token(token: str) -> dict:
    """Return portal row or raise 404/403."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT pp.portal_id, pp.project_id, pp.label, pp.created_by,
                      pp.expires_at, pp.is_active,
                      pp.portal_drive_folder_id, pp.portal_drive_folder_name,
                      pp.description,
                      pp.is_password_protected, pp.password_hash,
                      pp.name AS standalone_name,
                      pp.slug, pp.assigned_to, pp.category,
                      p.name AS project_name,
                      p.drive_folder_id AS project_drive_folder_id,
                      p.drive_folder_name AS project_drive_folder_name
               FROM project_portals pp
               LEFT JOIN projects p ON p.project_id = pp.project_id
               WHERE pp.token = %s OR pp.slug = %s""",
            [token, token],
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Portal not found")
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="This portal link has been revoked")
    if row["expires_at"] and datetime.now(timezone.utc) > row["expires_at"]:
        raise HTTPException(status_code=403, detail="This portal link has expired")

    effective_folder_id   = row["portal_drive_folder_id"] or row.get("project_drive_folder_id")
    effective_folder_name = row["portal_drive_folder_name"] or row.get("project_drive_folder_name")
    display_name = row.get("project_name") or row.get("standalone_name") or "Data Room"

    d = _row_dict(row)
    d["effective_folder_id"]   = effective_folder_id
    d["effective_folder_name"] = effective_folder_name
    d["display_name"]          = display_name
    return d


def _validate_portal_session(portal_id: str, session_token: str | None) -> dict | None:
    """Validate a portal session token. Returns viewer row or None if invalid."""
    if not session_token:
        return None
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT ps.session_token, ps.portal_id, ps.viewer_id, ps.expires_at,
                      pv.name AS viewer_name, pv.email AS viewer_email, pv.firm AS viewer_firm
               FROM portal_sessions ps
               LEFT JOIN portal_viewers pv ON pv.viewer_id = ps.viewer_id
               WHERE ps.session_token = %s AND ps.portal_id = %s""",
            [session_token, portal_id],
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        return None
    if row["expires_at"] and datetime.now(timezone.utc) > row["expires_at"]:
        return None
    return _row_dict(row)


def _require_portal_session(portal: dict, request: Request) -> dict:
    """For password-protected portals, require a valid session. Returns session info."""
    if not portal.get("is_password_protected"):
        return {}
    session_token = request.headers.get("X-Portal-Session")
    session = _validate_portal_session(str(portal["portal_id"]), session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Password required")
    return session


def _log_event(
    portal_id: str,
    event_type: str,
    viewer_id: str | None = None,
    viewer_name: str | None = None,
    file_id: str | None = None,
    file_name: str | None = None,
    section: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
):
    """Write to portal_access_log (best-effort, never raises)."""
    try:
        conn = _conn()
        try:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO portal_access_log
                     (portal_id, viewer_id, viewer_name, event_type,
                      file_id, file_name, section, ip_address, user_agent)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [portal_id, viewer_id, viewer_name, event_type,
                 file_id, file_name, section, ip_address, user_agent],
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        logger.warning("Failed to log portal event: %s", exc)


def _get_drive_token(user_id: str) -> str:
    from app.routers.drive import _get_token
    return _get_token(user_id)


def _list_folder_live(token: str, folder_id: str) -> list[dict]:
    """List files directly from Drive."""
    params = {
        "q":                         f"'{folder_id}' in parents and trashed = false",
        "fields":                    "files(id,name,mimeType,webViewLink,modifiedTime,size)",
        "orderBy":                   "folder,name_natural",
        "pageSize":                  100,
        "supportsAllDrives":         "true",
        "includeItemsFromAllDrives": "true",
    }
    r = httpx.get(
        DRIVE_FILES_URL,
        headers={"Authorization": f"Bearer {token}"},
        params=params,
        timeout=20,
    )
    if r.status_code != 200:
        logger.warning("Drive list failed: %s", r.text[:200])
        return []
    raw = r.json().get("files", [])
    return [
        {
            "file_id":       f["id"],
            "name":          f.get("name", "Untitled"),
            "mime_type":     f.get("mimeType"),
            "web_view_link": f.get("webViewLink"),
            "modified_time": f.get("modifiedTime"),
            "size_bytes":    int(f["size"]) if f.get("size") else None,
        }
        for f in raw
    ]


def _get_file_descriptions(cur, portal_id: str) -> dict:
    cur.execute(
        "SELECT file_id, description FROM portal_file_descriptions WHERE portal_id=%s",
        [portal_id],
    )
    return {row["file_id"]: row["description"] for row in cur.fetchall()}


def _get_portal_contacts(cur, portal_id: str) -> list[dict]:
    cur.execute(
        """SELECT id, name, title, email, phone
           FROM portal_contacts
           WHERE portal_id=%s
           ORDER BY sort_order ASC, created_at ASC""",
        [portal_id],
    )
    return [_row_dict(r) for r in cur.fetchall()]


def _get_portal_updates(cur, portal_id: str) -> list[dict]:
    cur.execute(
        """SELECT pu.id, pu.title, pu.body, pu.created_at, u.name AS created_by_name
           FROM portal_updates pu
           LEFT JOIN users u ON u.user_id = pu.created_by
           WHERE pu.portal_id = %s
           ORDER BY pu.created_at DESC""",
        [portal_id],
    )
    return [_row_dict(r) for r in cur.fetchall()]


# ── Public endpoints ──────────────────────────────────────────────────────────

@router.get("/portal/{token}")
def get_portal(token: str, request: Request):
    portal = _validate_token(token)
    portal_id = str(portal["portal_id"])

    # If password-protected, check for valid session
    if portal.get("is_password_protected"):
        session_token = request.headers.get("X-Portal-Session")
        session = _validate_portal_session(portal_id, session_token)
        if not session:
            return {"password_required": True}

    has_own_folder = bool(portal.get("portal_drive_folder_id"))
    effective_folder_id = portal.get("effective_folder_id")

    if not effective_folder_id:
        files = []
    elif has_own_folder:
        drive_token = _get_drive_token(portal["created_by"])
        files = _list_folder_live(drive_token, portal["portal_drive_folder_id"])
    else:
        conn = _conn()
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT file_id, name, mime_type, web_view_link,
                          modified_time, size_bytes, synced_at
                   FROM project_drive_files
                   WHERE project_id = %s
                   ORDER BY (mime_type = 'application/vnd.google-apps.folder') DESC, name ASC""",
                [portal["project_id"]],
            )
            files = [_row_dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    conn = _conn()
    try:
        cur = conn.cursor()
        descs    = _get_file_descriptions(cur, portal_id)
        contacts = _get_portal_contacts(cur, portal_id)
        updates  = _get_portal_updates(cur, portal_id)
    finally:
        conn.close()

    for f in files:
        f["description"] = descs.get(f.get("file_id"))

    return {
        "project_name":      portal["display_name"],
        "drive_folder_name": portal["effective_folder_name"],
        "label":             portal["label"],
        "description":       portal.get("description"),
        "contacts":          contacts,
        "updates":           updates,
        "files":             files,
    }


class PortalAuthBody(BaseModel):
    password: str


@router.post("/portal/{token}/auth")
def portal_auth(token: str, body: PortalAuthBody, request: Request):
    """Authenticate with a portal password. Returns a session token."""
    portal = _validate_token(token)
    portal_id = str(portal["portal_id"])

    if not portal.get("is_password_protected"):
        raise HTTPException(status_code=400, detail="This portal is not password-protected")

    ip = request.client.host if request.client else None
    ua = request.headers.get("User-Agent")

    # Check viewer-specific passwords first
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT viewer_id, name, email, firm, password_hash
               FROM portal_viewers
               WHERE portal_id = %s AND is_active = true""",
            [portal_id],
        )
        viewers = cur.fetchall()
    finally:
        conn.close()

    matched_viewer = None
    for v in viewers:
        if _check_password(body.password, v["password_hash"]):
            matched_viewer = v
            break

    # Fall back to portal-level password
    if not matched_viewer and portal.get("password_hash"):
        if not _check_password(body.password, portal["password_hash"]):
            raise HTTPException(status_code=401, detail="Incorrect password")
    elif not matched_viewer:
        raise HTTPException(status_code=401, detail="Incorrect password")

    viewer_id   = str(matched_viewer["viewer_id"]) if matched_viewer else None
    viewer_name = matched_viewer["name"] if matched_viewer else None

    # Create session
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO portal_sessions (portal_id, viewer_id)
               VALUES (%s, %s)
               RETURNING session_token""",
            [portal_id, viewer_id],
        )
        session_token = str(cur.fetchone()["session_token"])
        conn.commit()
    finally:
        conn.close()

    _log_event(
        portal_id=portal_id,
        event_type="login",
        viewer_id=viewer_id,
        viewer_name=viewer_name,
        ip_address=ip,
        user_agent=ua,
    )

    return {
        "session_token": session_token,
        "viewer_name":   viewer_name,
    }


class TrackBody(BaseModel):
    event_type: str                 # page_visit | file_view | file_download
    section: Optional[str] = None  # overview | updates | documents
    file_id: Optional[str] = None
    file_name: Optional[str] = None


@router.post("/portal/{token}/track")
def portal_track(token: str, body: TrackBody, request: Request):
    """Log viewer activity. Silently succeeds even if portal is not password-protected."""
    portal = _validate_token(token)
    portal_id = str(portal["portal_id"])

    session = None
    if portal.get("is_password_protected"):
        session_token = request.headers.get("X-Portal-Session")
        session = _validate_portal_session(portal_id, session_token)

    viewer_id   = session.get("viewer_id") if session else None
    viewer_name = session.get("viewer_name") if session else None
    ip = request.client.host if request.client else None
    ua = request.headers.get("User-Agent")

    allowed = {"page_visit", "file_view", "file_download"}
    event_type = body.event_type if body.event_type in allowed else "page_visit"

    _log_event(
        portal_id=portal_id,
        event_type=event_type,
        viewer_id=viewer_id,
        viewer_name=viewer_name,
        file_id=body.file_id,
        file_name=body.file_name,
        section=body.section,
        ip_address=ip,
        user_agent=ua,
    )

    # Notify assigned employee on first page_visit within a 4-hour window
    if event_type == "page_visit" and portal.get("assigned_to"):
        try:
            from app.routers.notifications import create_notification
            conn = _conn()
            try:
                cur = conn.cursor()
                cur.execute(
                    """SELECT 1 FROM task_notifications
                       WHERE notification_type = 'portal_view'
                         AND entity_id = %s::uuid
                         AND created_at > NOW() - INTERVAL '4 hours'
                       LIMIT 1""",
                    [portal_id],
                )
                if not cur.fetchone():
                    display = portal.get("display_name", "Portal")
                    viewer_label = viewer_name or "Someone"
                    create_notification(
                        conn,
                        recipient_id=str(portal["assigned_to"]),
                        sender_id=None,
                        notification_type="portal_view",
                        entity_type="portal",
                        entity_id=portal_id,
                        title=f"{viewer_label} viewed the {display} portal",
                        message=None,
                    )
                    conn.commit()
            finally:
                conn.close()
        except Exception as e:
            logger.warning("Portal view notification failed: %s", e)

    return {"ok": True}


@router.get("/portal/{token}/files/{file_id}/download")
def portal_download(token: str, file_id: str, request: Request):
    portal = _validate_token(token)
    _require_portal_session(portal, request)
    drive_token = _get_drive_token(portal["created_by"])
    auth_headers = {"Authorization": f"Bearer {drive_token}"}

    mime = None
    name = None
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name, mime_type FROM project_drive_files WHERE file_id=%s AND project_id=%s",
            [file_id, portal["project_id"]],
        )
        row = cur.fetchone()
        if row:
            mime = row["mime_type"]
            name = row["name"]
    finally:
        conn.close()

    if not name:
        r = httpx.get(
            f"{DRIVE_FILES_URL}/{file_id}",
            headers=auth_headers,
            params={"fields": "name,mimeType", "supportsAllDrives": "true"},
            timeout=10,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=404, detail="File not found")
        meta = r.json()
        mime = meta.get("mimeType", "")
        name = meta.get("name", "file")

    # Log the download
    session_token = request.headers.get("X-Portal-Session")
    session = _validate_portal_session(str(portal["portal_id"]), session_token) if portal.get("is_password_protected") else None
    _log_event(
        portal_id=str(portal["portal_id"]),
        event_type="file_download",
        viewer_id=session.get("viewer_id") if session else None,
        viewer_name=session.get("viewer_name") if session else None,
        file_id=file_id,
        file_name=name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )

    if mime in EXPORTABLE_TO_PDF:
        r = httpx.get(
            DRIVE_EXPORT_URL.format(id=file_id),
            headers=auth_headers,
            params={"mimeType": "application/pdf", "supportsAllDrives": "true"},
            timeout=60,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to export file from Drive")
        return Response(
            content=r.content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'},
        )
    else:
        r = httpx.get(
            f"{DRIVE_FILES_URL}/{file_id}",
            headers=auth_headers,
            params={"alt": "media", "supportsAllDrives": "true"},
            timeout=60,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to download file from Drive")
        content_type = mime if mime and "/" in mime else "application/octet-stream"
        return Response(
            content=r.content,
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )


@router.get("/portal/{token}/folders/{folder_id}")
def portal_list_folder(token: str, folder_id: str, request: Request):
    """List contents of a subfolder within the portal."""
    portal = _validate_token(token)
    _require_portal_session(portal, request)
    portal_id = str(portal["portal_id"])
    drive_token = _get_drive_token(portal["created_by"])
    files = _list_folder_live(drive_token, folder_id)
    conn = _conn()
    try:
        cur = conn.cursor()
        descs = _get_file_descriptions(cur, portal_id)
    finally:
        conn.close()
    for f in files:
        f["description"] = descs.get(f["file_id"])
    return {"files": files}


# ── Authenticated endpoints ───────────────────────────────────────────────────

@router.post("/projects/{project_id}/portal")
def create_portal(project_id: str, request: Request):
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT project_id FROM projects WHERE project_id=%s", [project_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")
        cur.execute(
            "UPDATE project_portals SET is_active=false WHERE project_id=%s",
            [project_id],
        )
        cur.execute(
            """INSERT INTO project_portals (project_id, created_by)
               VALUES (%s, %s)
               RETURNING portal_id, token""",
            [project_id, uid],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    return {"portal_id": str(row["portal_id"]), "token": row["token"]}


@router.get("/projects/{project_id}/portal")
def get_project_portal(project_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT portal_id, token, slug, is_active, created_at, expires_at,
                      portal_drive_folder_id, portal_drive_folder_name,
                      is_password_protected
               FROM project_portals
               WHERE project_id=%s AND is_active=true
               ORDER BY created_at DESC LIMIT 1""",
            [project_id],
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        return {"portal": None}
    return {"portal": _row_dict(row)}


class PortalFolderBody(BaseModel):
    folder_url: str


@router.patch("/projects/{project_id}/portal/folder")
def set_portal_folder(project_id: str, body: PortalFolderBody, request: Request):
    uid = _require_user(request)
    drive_token = _get_drive_token(uid)

    from app.routers.drive import _parse_folder_id, _get_folder_name
    folder_id   = _parse_folder_id(body.folder_url)
    folder_name = _get_folder_name(drive_token, folder_id)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE project_portals
               SET portal_drive_folder_id=%s, portal_drive_folder_name=%s
               WHERE project_id=%s AND is_active=true""",
            [folder_id, folder_name, project_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="No active portal for this project")
        conn.commit()
    finally:
        conn.close()

    return {"folder_id": folder_id, "folder_name": folder_name}


class PortalContentBody(BaseModel):
    description: Optional[str] = None
    is_password_protected: Optional[bool] = None
    password: Optional[str] = None  # plain text; will be hashed


@router.patch("/projects/{project_id}/portal/content")
def set_portal_content(project_id: str, body: PortalContentBody, request: Request):
    _require_user(request)

    sets  = []
    vals  = []

    if body.description is not None:
        sets.append("description=%s"); vals.append(body.description)

    if body.is_password_protected is not None:
        sets.append("is_password_protected=%s"); vals.append(body.is_password_protected)

    if body.password is not None:
        if body.password.strip():
            sets.append("password_hash=%s"); vals.append(_hash_password(body.password))
        else:
            # Empty string clears the portal-level password
            sets.append("password_hash=NULL")

    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update")

    vals.append(project_id)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE project_portals SET {', '.join(sets)} WHERE project_id=%s AND is_active=true",
            vals,
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="No active portal for this project")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.get("/projects/{project_id}/portal/content")
def get_portal_content(project_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT portal_id, description, is_password_protected,
                      (password_hash IS NOT NULL) AS has_portal_password
               FROM project_portals WHERE project_id=%s AND is_active=true""",
            [project_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No active portal for this project")
        portal_id   = str(row["portal_id"])
        description = row["description"]
        is_pw       = row["is_password_protected"]
        has_pw      = row["has_portal_password"]
        contacts    = _get_portal_contacts(cur, portal_id)
        updates     = _get_portal_updates(cur, portal_id)
    finally:
        conn.close()
    return {
        "description": description,
        "is_password_protected": is_pw,
        "has_portal_password": has_pw,
        "contacts": contacts,
        "updates": updates,
    }


class PortalSlugBody(BaseModel):
    slug: Optional[str] = None  # None or empty string clears the slug


import re as _re

_SLUG_RE = _re.compile(r'^[a-z0-9][a-z0-9\-]{1,62}[a-z0-9]$')


@router.patch("/projects/{project_id}/portal/slug")
def set_portal_slug(project_id: str, body: PortalSlugBody, request: Request):
    _require_user(request)
    slug = body.slug.strip().lower() if body.slug else None
    if slug == "":
        slug = None
    if slug and not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Slug must be 3–64 lowercase letters, numbers, or hyphens, starting and ending with a letter or number")
    conn = _conn()
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                "UPDATE project_portals SET slug=%s WHERE project_id=%s AND is_active=true",
                [slug, project_id],
            )
        except Exception as e:
            if "unique" in str(e).lower():
                raise HTTPException(status_code=409, detail="That slug is already in use")
            raise
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="No active portal for this project")
        conn.commit()
    finally:
        conn.close()
    return {"slug": slug}


@router.patch("/portals/room/{portal_id}/slug")
def set_room_slug(portal_id: str, body: PortalSlugBody, request: Request):
    _require_user(request)
    slug = body.slug.strip().lower() if body.slug else None
    if slug == "":
        slug = None
    if slug and not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Slug must be 3–64 lowercase letters, numbers, or hyphens, starting and ending with a letter or number")
    conn = _conn()
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                "UPDATE project_portals SET slug=%s WHERE portal_id=%s",
                [slug, portal_id],
            )
        except Exception as e:
            if "unique" in str(e).lower():
                raise HTTPException(status_code=409, detail="That slug is already in use")
            raise
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Portal not found")
        conn.commit()
    finally:
        conn.close()
    return {"slug": slug}


class PortalAssignBody(BaseModel):
    assigned_to: Optional[str] = None  # user_id or None to unassign


class PortalCategoryBody(BaseModel):
    category: str  # 'client' | 'investor' | 'partner'


@router.patch("/projects/{project_id}/portal/assign")
def assign_portal(project_id: str, body: PortalAssignBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET assigned_to=%s WHERE project_id=%s AND is_active=true",
            [body.assigned_to, project_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="No active portal for this project")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.patch("/projects/{project_id}/portal/category")
def set_portal_category(project_id: str, body: PortalCategoryBody, request: Request):
    _require_user(request)
    if body.category not in ("client", "investor", "partner"):
        raise HTTPException(status_code=400, detail="category must be client, investor, or partner")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET category=%s WHERE project_id=%s AND is_active=true",
            [body.category, project_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="No active portal for this project")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.patch("/portals/room/{portal_id}/assign")
def assign_room_portal(portal_id: str, body: PortalAssignBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET assigned_to=%s WHERE portal_id=%s",
            [body.assigned_to, portal_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Portal not found")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.patch("/portals/room/{portal_id}/category")
def set_room_category(portal_id: str, body: PortalCategoryBody, request: Request):
    _require_user(request)
    if body.category not in ("client", "investor", "partner"):
        raise HTTPException(status_code=400, detail="category must be client, investor, or partner")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET category=%s WHERE portal_id=%s",
            [body.category, portal_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Portal not found")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


class ContactBody(BaseModel):
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class ContactPatchBody(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


@router.post("/projects/{project_id}/portal/contacts")
def add_portal_contact(project_id: str, body: ContactBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            """INSERT INTO portal_contacts (portal_id, name, title, email, phone)
               VALUES (%s, %s, %s, %s, %s)
               RETURNING id, name, title, email, phone""",
            [portal_id, body.name, body.title, body.email, body.phone],
        )
        row = _row_dict(cur.fetchone())
        conn.commit()
    finally:
        conn.close()
    return row


@router.patch("/projects/{project_id}/portal/contacts/{cid}")
def edit_portal_contact(project_id: str, cid: int, body: ContactPatchBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        updates = []
        values  = []
        if body.name is not None:
            updates.append("name=%s"); values.append(body.name)
        if body.title is not None:
            updates.append("title=%s"); values.append(body.title)
        if body.email is not None:
            updates.append("email=%s"); values.append(body.email)
        if body.phone is not None:
            updates.append("phone=%s"); values.append(body.phone)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        values.extend([cid, portal_id])
        cur.execute(
            f"UPDATE portal_contacts SET {', '.join(updates)} WHERE id=%s AND portal_id=%s RETURNING id, name, title, email, phone",
            values,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")
        result = _row_dict(row)
        conn.commit()
    finally:
        conn.close()
    return result


@router.delete("/projects/{project_id}/portal/contacts/{cid}")
def delete_portal_contact(project_id: str, cid: int, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            "DELETE FROM portal_contacts WHERE id=%s AND portal_id=%s",
            [cid, portal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


class UpdateBody(BaseModel):
    title: str
    body: Optional[str] = None


@router.post("/projects/{project_id}/portal/updates")
def post_portal_update(project_id: str, body: UpdateBody, request: Request):
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            """INSERT INTO portal_updates (portal_id, title, body, created_by)
               VALUES (%s, %s, %s, %s)
               RETURNING id, title, body, created_at""",
            [portal_id, body.title, body.body, uid],
        )
        row = _row_dict(cur.fetchone())
        conn.commit()
    finally:
        conn.close()
    return row


@router.delete("/projects/{project_id}/portal/updates/{uid}")
def delete_portal_update(project_id: str, uid: int, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            "DELETE FROM portal_updates WHERE id=%s AND portal_id=%s",
            [uid, portal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.get("/portals")
def list_all_portals(request: Request):
    """List all portals for the management view (authenticated)."""
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT pp.portal_id, pp.token, pp.slug, pp.is_active, pp.created_at, pp.expires_at,
                      pp.portal_drive_folder_id, pp.portal_drive_folder_name,
                      pp.is_password_protected,
                      pp.project_id,
                      pp.assigned_to AS assigned_to_id,
                      pp.category,
                      COALESCE(p.name, pp.name) AS project_name,
                      p.drive_folder_name AS project_drive_folder_name,
                      u.name  AS created_by_name,
                      ua.name AS assigned_to_name,
                      (pp.project_id IS NULL) AS is_standalone,
                      (SELECT COUNT(*) FROM portal_viewers pv
                       WHERE pv.portal_id = pp.portal_id AND pv.is_active = true) AS viewer_count,
                      (SELECT c.name || COALESCE(' (' || c.organization || ')', '')
                       FROM project_contacts pc
                       JOIN contacts c ON c.contact_id = pc.contact_id
                       WHERE pc.project_id = pp.project_id AND pc.is_primary = true
                       LIMIT 1) AS client_name
               FROM project_portals pp
               LEFT JOIN projects p   ON p.project_id  = pp.project_id
               LEFT JOIN users u      ON u.user_id      = pp.created_by
               LEFT JOIN users ua     ON ua.user_id     = pp.assigned_to
               ORDER BY pp.created_at DESC""",
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return rows


# ── Standalone (project-free) portal endpoints ───────────────────────────────

class StandalonePortalBody(BaseModel):
    name: str


@router.post("/portals/standalone")
def create_standalone_portal(body: StandalonePortalBody, request: Request):
    """Create a data room portal not linked to any project."""
    uid = _require_user(request)
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO project_portals (project_id, created_by, name, category)
               VALUES (NULL, %s, %s, 'investor')
               RETURNING portal_id, token""",
            [uid, body.name.strip()],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    return {"portal_id": str(row["portal_id"]), "token": row["token"]}


@router.get("/portals/room/{portal_id}")
def get_standalone_portal(portal_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT portal_id, token, slug, is_active, created_at, expires_at,
                      portal_drive_folder_id, portal_drive_folder_name,
                      is_password_protected, name,
                      COALESCE(messaging_enabled, false) AS messaging_enabled,
                      messaging_channel_id::text
               FROM project_portals
               WHERE portal_id = %s""",
            [portal_id],
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Portal not found")
    return _row_dict(row)


class PortalMessagingBody(BaseModel):
    messaging_enabled: bool


@router.patch("/portals/room/{portal_id}/messaging")
def set_portal_messaging(portal_id: str, body: PortalMessagingBody, request: Request):
    """Enable or disable messaging for a portal."""
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET messaging_enabled=%s WHERE portal_id=%s",
            [body.messaging_enabled, portal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"messaging_enabled": body.messaging_enabled}


class RoomNameBody(BaseModel):
    name: str


@router.patch("/portals/room/{portal_id}/name")
def rename_standalone_portal(portal_id: str, body: RoomNameBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET name=%s WHERE portal_id=%s",
            [body.name.strip(), portal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.patch("/portals/room/{portal_id}/folder")
def set_room_folder(portal_id: str, body: PortalFolderBody, request: Request):
    uid = _require_user(request)
    drive_token = _get_drive_token(uid)
    from app.routers.drive import _parse_folder_id, _get_folder_name
    folder_id   = _parse_folder_id(body.folder_url)
    folder_name = _get_folder_name(drive_token, folder_id)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET portal_drive_folder_id=%s, portal_drive_folder_name=%s WHERE portal_id=%s",
            [folder_id, folder_name, portal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"folder_id": folder_id, "folder_name": folder_name}


@router.get("/portals/room/{portal_id}/content")
def get_room_content(portal_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT portal_id, description, is_password_protected,
                      (password_hash IS NOT NULL) AS has_portal_password
               FROM project_portals WHERE portal_id=%s""",
            [portal_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Portal not found")
        contacts = _get_portal_contacts(cur, portal_id)
        updates  = _get_portal_updates(cur, portal_id)
    finally:
        conn.close()
    return {
        "description":          row["description"],
        "is_password_protected": row["is_password_protected"],
        "has_portal_password":  row["has_portal_password"],
        "contacts":             contacts,
        "updates":              updates,
    }


@router.patch("/portals/room/{portal_id}/content")
def set_room_content(portal_id: str, body: PortalContentBody, request: Request):
    _require_user(request)
    sets, vals = [], []
    if body.description is not None:
        sets.append("description=%s"); vals.append(body.description)
    if body.is_password_protected is not None:
        sets.append("is_password_protected=%s"); vals.append(body.is_password_protected)
    if body.password is not None:
        if body.password.strip():
            sets.append("password_hash=%s"); vals.append(_hash_password(body.password))
        else:
            sets.append("password_hash=NULL")
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update")
    vals.append(portal_id)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE project_portals SET {', '.join(sets)} WHERE portal_id=%s", vals)
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.get("/portals/room/{portal_id}/files")
def list_room_files(portal_id: str, request: Request):
    """List files in the portal's Drive folder with their descriptions."""
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT portal_drive_folder_id, created_by FROM project_portals WHERE portal_id=%s",
            [portal_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Portal not found")
        descs = _get_file_descriptions(cur, portal_id)
    finally:
        conn.close()
    if not row["portal_drive_folder_id"]:
        return {"files": []}
    drive_token = _get_drive_token(row["created_by"])
    files = _list_folder_live(drive_token, row["portal_drive_folder_id"])
    for f in files:
        f["description"] = descs.get(f["file_id"])
    return {"files": files}


class FileDescBody(BaseModel):
    description: str


@router.put("/portals/room/{portal_id}/files/{file_id}/description")
def set_file_description(portal_id: str, file_id: str, body: FileDescBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        if body.description.strip():
            cur.execute(
                """INSERT INTO portal_file_descriptions (portal_id, file_id, description, updated_at)
                   VALUES (%s, %s, %s, NOW())
                   ON CONFLICT (portal_id, file_id)
                   DO UPDATE SET description=EXCLUDED.description, updated_at=NOW()""",
                [portal_id, file_id, body.description.strip()],
            )
        else:
            cur.execute(
                "DELETE FROM portal_file_descriptions WHERE portal_id=%s AND file_id=%s",
                [portal_id, file_id],
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.post("/portals/room/{portal_id}/contacts")
def add_room_contact(portal_id: str, body: ContactBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO portal_contacts (portal_id, name, title, email, phone) VALUES (%s,%s,%s,%s,%s) RETURNING id, name, title, email, phone",
            [portal_id, body.name, body.title, body.email, body.phone],
        )
        row = _row_dict(cur.fetchone())
        conn.commit()
    finally:
        conn.close()
    return row


@router.patch("/portals/room/{portal_id}/contacts/{cid}")
def edit_room_contact(portal_id: str, cid: int, body: ContactPatchBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        updates, values = [], []
        if body.name  is not None: updates.append("name=%s");  values.append(body.name)
        if body.title is not None: updates.append("title=%s"); values.append(body.title)
        if body.email is not None: updates.append("email=%s"); values.append(body.email)
        if body.phone is not None: updates.append("phone=%s"); values.append(body.phone)
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        values.extend([cid, portal_id])
        cur.execute(
            f"UPDATE portal_contacts SET {', '.join(updates)} WHERE id=%s AND portal_id=%s RETURNING id, name, title, email, phone",
            values,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")
        result = _row_dict(row)
        conn.commit()
    finally:
        conn.close()
    return result


@router.delete("/portals/room/{portal_id}/contacts/{cid}")
def delete_room_contact(portal_id: str, cid: int, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM portal_contacts WHERE id=%s AND portal_id=%s", [cid, portal_id])
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.post("/portals/room/{portal_id}/updates")
def post_room_update(portal_id: str, body: UpdateBody, request: Request):
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO portal_updates (portal_id, title, body, created_by) VALUES (%s,%s,%s,%s) RETURNING id, title, body, created_at",
            [portal_id, body.title, body.body, uid],
        )
        row = _row_dict(cur.fetchone())
        conn.commit()
    finally:
        conn.close()
    return row


@router.delete("/portals/room/{portal_id}/updates/{uid}")
def delete_room_update(portal_id: str, uid: int, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM portal_updates WHERE id=%s AND portal_id=%s", [uid, portal_id])
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


class ViewerBody(BaseModel):
    name: str
    email: Optional[str] = None
    firm: Optional[str] = None
    password: str


class ViewerPatchBody(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    firm: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/portals/room/{portal_id}/viewers")
def list_room_viewers(portal_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT viewer_id, name, email, firm, is_active, created_at FROM portal_viewers WHERE portal_id=%s ORDER BY created_at ASC",
            [portal_id],
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return rows


@router.post("/portals/room/{portal_id}/viewers")
def add_room_viewer(portal_id: str, body: ViewerBody, request: Request):
    _require_user(request)
    if not body.password.strip():
        raise HTTPException(status_code=400, detail="Password is required")
    pw_hash = _hash_password(body.password)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO portal_viewers (portal_id, name, email, firm, password_hash) VALUES (%s,%s,%s,%s,%s) RETURNING viewer_id, name, email, firm, is_active, created_at",
            [portal_id, body.name.strip(), body.email, body.firm, pw_hash],
        )
        row = _row_dict(cur.fetchone())
        conn.commit()
    finally:
        conn.close()
    return row


@router.patch("/portals/room/{portal_id}/viewers/{vid}")
def update_room_viewer(portal_id: str, vid: str, body: ViewerPatchBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        sets, vals = [], []
        if body.name      is not None: sets.append("name=%s");      vals.append(body.name.strip())
        if body.email     is not None: sets.append("email=%s");     vals.append(body.email or None)
        if body.firm      is not None: sets.append("firm=%s");      vals.append(body.firm or None)
        if body.is_active is not None: sets.append("is_active=%s"); vals.append(body.is_active)
        if body.password  is not None:
            if not body.password.strip():
                raise HTTPException(status_code=400, detail="Password cannot be empty")
            sets.append("password_hash=%s"); vals.append(_hash_password(body.password))
        if not sets:
            raise HTTPException(status_code=400, detail="Nothing to update")
        vals.extend([vid, portal_id])
        cur.execute(
            f"UPDATE portal_viewers SET {', '.join(sets)} WHERE viewer_id=%s AND portal_id=%s RETURNING viewer_id, name, email, firm, is_active, created_at",
            vals,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Viewer not found")
        result = _row_dict(row)
        conn.commit()
    finally:
        conn.close()
    return result


@router.delete("/portals/room/{portal_id}/viewers/{vid}")
def delete_room_viewer(portal_id: str, vid: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM portal_viewers WHERE viewer_id=%s AND portal_id=%s", [vid, portal_id])
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.get("/portals/room/{portal_id}/activity")
def get_room_activity(portal_id: str, request: Request, limit: int = 200):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT log_id, viewer_id, viewer_name, event_type,
                      file_id, file_name, section, ip_address, created_at
               FROM portal_access_log
               WHERE portal_id=%s
               ORDER BY created_at DESC LIMIT %s""",
            [portal_id, min(limit, 500)],
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return rows


@router.delete("/portals/room/{portal_id}")
def delete_standalone_portal(portal_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET is_active=false WHERE portal_id=%s",
            [portal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.delete("/projects/{project_id}/portal")
def revoke_portal(project_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE project_portals SET is_active=false WHERE project_id=%s AND is_active=true",
            [project_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── Viewer (investor) management ──────────────────────────────────────────────

@router.get("/projects/{project_id}/portal/viewers")
def list_portal_viewers(project_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            """SELECT viewer_id, name, email, firm, is_active, created_at
               FROM portal_viewers
               WHERE portal_id = %s
               ORDER BY created_at ASC""",
            [portal_id],
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return rows


@router.post("/projects/{project_id}/portal/viewers")
def add_portal_viewer(project_id: str, body: ViewerBody, request: Request):
    _require_user(request)
    if not body.password.strip():
        raise HTTPException(status_code=400, detail="Password is required")
    pw_hash = _hash_password(body.password)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            """INSERT INTO portal_viewers (portal_id, name, email, firm, password_hash)
               VALUES (%s, %s, %s, %s, %s)
               RETURNING viewer_id, name, email, firm, is_active, created_at""",
            [portal_id, body.name.strip(), body.email, body.firm, pw_hash],
        )
        row = _row_dict(cur.fetchone())
        conn.commit()
    finally:
        conn.close()
    return row


@router.patch("/projects/{project_id}/portal/viewers/{vid}")
def update_portal_viewer(project_id: str, vid: str, body: ViewerPatchBody, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        sets  = []
        vals  = []
        if body.name is not None:
            sets.append("name=%s"); vals.append(body.name.strip())
        if body.email is not None:
            sets.append("email=%s"); vals.append(body.email or None)
        if body.firm is not None:
            sets.append("firm=%s"); vals.append(body.firm or None)
        if body.is_active is not None:
            sets.append("is_active=%s"); vals.append(body.is_active)
        if body.password is not None:
            if not body.password.strip():
                raise HTTPException(status_code=400, detail="Password cannot be empty")
            sets.append("password_hash=%s"); vals.append(_hash_password(body.password))
        if not sets:
            raise HTTPException(status_code=400, detail="Nothing to update")
        vals.extend([vid, portal_id])
        cur.execute(
            f"""UPDATE portal_viewers SET {', '.join(sets)}
                WHERE viewer_id=%s AND portal_id=%s
                RETURNING viewer_id, name, email, firm, is_active, created_at""",
            vals,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Viewer not found")
        result = _row_dict(row)
        conn.commit()
    finally:
        conn.close()
    return result


@router.delete("/projects/{project_id}/portal/viewers/{vid}")
def delete_portal_viewer(project_id: str, vid: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            "DELETE FROM portal_viewers WHERE viewer_id=%s AND portal_id=%s",
            [vid, portal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── Activity log ──────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/portal/activity")
def get_portal_activity(project_id: str, request: Request, limit: int = 200):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        portal_id = _get_active_portal_id(cur, project_id)
        cur.execute(
            """SELECT log_id, viewer_id, viewer_name, event_type,
                      file_id, file_name, section, ip_address, created_at
               FROM portal_access_log
               WHERE portal_id = %s
               ORDER BY created_at DESC
               LIMIT %s""",
            [portal_id, min(limit, 500)],
        )
        rows = [_row_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return rows
