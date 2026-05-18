"""
messaging.py — Internal team messaging with channels, DMs, and announcements.

GET    /messaging/channels                    — list channels for current user
POST   /messaging/channels                    — create group/DM channel
GET    /messaging/channels/{id}               — channel detail + members
PATCH  /messaging/channels/{id}               — rename / update channel
POST   /messaging/channels/{id}/members       — add member(s)
DELETE /messaging/channels/{id}/members/{uid} — remove member
GET    /messaging/channels/{id}/messages      — paginated messages
POST   /messaging/channels/{id}/messages      — send message
DELETE /messaging/messages/{msg_id}           — delete message (sender only)
GET    /messaging/unread                       — unread count per channel
PATCH  /messaging/channels/{id}/read          — mark channel as read

Portal-facing (uses portal session token instead of user auth):
POST   /messaging/portal/{portal_token}/send  — portal viewer sends message to team
GET    /messaging/portal/{portal_token}/messages — portal viewer reads thread
"""
import logging
import os
from typing import List, Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/messaging", tags=["messaging"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _fmt_msg(row: dict) -> dict:
    d = dict(row)
    for f in ("message_id", "channel_id", "sender_id"):
        if d.get(f):
            d[f] = str(d[f])
    if d.get("created_at") and hasattr(d["created_at"], "isoformat"):
        d["created_at"] = d["created_at"].isoformat()
    return d


def _fmt_channel(row: dict) -> dict:
    d = dict(row)
    for f in ("channel_id", "created_by", "messaging_channel_id"):
        if d.get(f):
            d[f] = str(d[f])
    for ts in ("created_at", "updated_at", "last_read_at"):
        if d.get(ts) and hasattr(d[ts], "isoformat"):
            d[ts] = d[ts].isoformat()
    return d


# ── Input models ──────────────────────────────────────────────────────────────

class CreateChannelBody(BaseModel):
    name: Optional[str] = None
    channel_type: str = "group"       # group | direct | announcement
    member_ids: List[str] = []


class SendMessageBody(BaseModel):
    body: str
    is_announcement: bool = False


class AddMembersBody(BaseModel):
    user_ids: List[str]


class PatchChannelBody(BaseModel):
    name: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _assert_member(cur, channel_id: str, user_id: str):
    cur.execute(
        "SELECT 1 FROM channel_members WHERE channel_id=%s::uuid AND user_id=%s::uuid",
        (channel_id, user_id),
    )
    if not cur.fetchone():
        raise HTTPException(status_code=403, detail="Not a member of this channel")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/users")
def list_messageable_users(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT user_id::text, name, email
            FROM users
            WHERE COALESCE(is_active, true) = true
            ORDER BY name
            """
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.get("/channels")
def list_channels(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT c.*,
                   cm.last_read_at,
                   (SELECT COUNT(*) FROM channel_messages m
                    WHERE m.channel_id = c.channel_id
                    AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
                   ) AS unread_count,
                   (SELECT m2.body FROM channel_messages m2
                    WHERE m2.channel_id = c.channel_id
                    ORDER BY m2.created_at DESC LIMIT 1
                   ) AS last_message,
                   (SELECT m2.created_at FROM channel_messages m2
                    WHERE m2.channel_id = c.channel_id
                    ORDER BY m2.created_at DESC LIMIT 1
                   ) AS last_message_at,
                   ARRAY(
                     SELECT u.name FROM users u
                     JOIN channel_members cm2 ON cm2.user_id = u.user_id
                     WHERE cm2.channel_id = c.channel_id
                     AND u.user_id != %s::uuid
                     LIMIT 3
                   ) AS other_member_names
            FROM message_channels c
            JOIN channel_members cm ON cm.channel_id = c.channel_id AND cm.user_id = %s::uuid
            ORDER BY COALESCE(
              (SELECT m3.created_at FROM channel_messages m3 WHERE m3.channel_id=c.channel_id ORDER BY m3.created_at DESC LIMIT 1),
              c.created_at
            ) DESC
            """,
            (user["user_id"], user["user_id"]),
        )
        return [_fmt_channel(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.post("/channels", status_code=201)
def create_channel(body: CreateChannelBody, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if body.channel_type not in ("group", "direct", "announcement"):
        raise HTTPException(status_code=422, detail="Invalid channel_type")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # For DMs: check if a direct channel already exists between these two users
        if body.channel_type == "direct" and len(body.member_ids) == 1:
            other_id = body.member_ids[0]
            cur.execute(
                """
                SELECT c.channel_id FROM message_channels c
                WHERE c.channel_type = 'direct'
                AND EXISTS (SELECT 1 FROM channel_members cm1 WHERE cm1.channel_id=c.channel_id AND cm1.user_id=%s::uuid)
                AND EXISTS (SELECT 1 FROM channel_members cm2 WHERE cm2.channel_id=c.channel_id AND cm2.user_id=%s::uuid)
                LIMIT 1
                """,
                (user["user_id"], other_id),
            )
            existing = cur.fetchone()
            if existing:
                return {"channel_id": str(existing["channel_id"]), "existing": True}

        cur.execute(
            "INSERT INTO message_channels (name, channel_type, created_by) VALUES (%s, %s, %s::uuid) RETURNING *",
            (body.name, body.channel_type, user["user_id"]),
        )
        channel = _fmt_channel(cur.fetchone())
        channel_id = channel["channel_id"]

        # Add creator + members
        all_members = list({user["user_id"]} | set(body.member_ids))
        for uid in all_members:
            try:
                cur.execute(
                    "INSERT INTO channel_members (channel_id, user_id) VALUES (%s::uuid, %s::uuid) ON CONFLICT DO NOTHING",
                    (channel_id, uid),
                )
            except Exception:
                pass

        conn.commit()
        return channel
    finally:
        conn.close()


@router.get("/channels/{channel_id}")
def get_channel(channel_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _assert_member(cur, channel_id, user["user_id"])

        cur.execute("SELECT * FROM message_channels WHERE channel_id=%s::uuid", (channel_id,))
        channel = cur.fetchone()
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        cur.execute(
            """
            SELECT u.user_id::text, u.name, u.email, cm.joined_at, cm.last_read_at
            FROM channel_members cm
            JOIN users u ON u.user_id = cm.user_id
            WHERE cm.channel_id = %s::uuid
            ORDER BY cm.joined_at
            """,
            (channel_id,),
        )
        members = [dict(r) for r in cur.fetchall()]
        result = _fmt_channel(channel)
        result["members"] = members
        return result
    finally:
        conn.close()


@router.patch("/channels/{channel_id}")
def patch_channel(channel_id: str, body: PatchChannelBody, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _assert_member(cur, channel_id, user["user_id"])

        cur.execute(
            "UPDATE message_channels SET name=%s, updated_at=now() WHERE channel_id=%s::uuid RETURNING *",
            (body.name, channel_id),
        )
        row = cur.fetchone()
        conn.commit()
        return _fmt_channel(row) if row else {}
    finally:
        conn.close()


@router.post("/channels/{channel_id}/members", status_code=201)
def add_members(channel_id: str, body: AddMembersBody, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _assert_member(cur, channel_id, user["user_id"])

        added = []
        for uid in body.user_ids:
            cur.execute(
                "INSERT INTO channel_members (channel_id, user_id) VALUES (%s::uuid, %s::uuid) ON CONFLICT DO NOTHING RETURNING user_id::text",
                (channel_id, uid),
            )
            row = cur.fetchone()
            if row:
                added.append(row["user_id"])

        conn.commit()
        return {"added": added}
    finally:
        conn.close()


@router.delete("/channels/{channel_id}/members/{uid}", status_code=204)
def remove_member(channel_id: str, uid: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if uid != user["user_id"]:
        _conn_check = _conn()
        try:
            cur = _conn_check.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                "SELECT created_by::text FROM message_channels WHERE channel_id=%s::uuid",
                (channel_id,),
            )
            ch = cur.fetchone()
            if not ch or ch["created_by"] != user["user_id"]:
                raise HTTPException(status_code=403, detail="Only the channel creator can remove others")
        finally:
            _conn_check.close()

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM channel_members WHERE channel_id=%s::uuid AND user_id=%s::uuid",
            (channel_id, uid),
        )
        conn.commit()
    finally:
        conn.close()


@router.delete("/channels/{channel_id}", status_code=204)
def delete_channel(channel_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Any member can leave (removes themselves); only creator can fully delete
        cur.execute(
            "SELECT created_by::text FROM message_channels WHERE channel_id=%s::uuid",
            (channel_id,),
        )
        ch = cur.fetchone()
        if not ch:
            raise HTTPException(status_code=404, detail="Channel not found")

        _assert_member(cur, channel_id, user["user_id"])

        if ch["created_by"] == user["user_id"]:
            # Creator deletes the whole channel
            cur.execute("DELETE FROM channel_messages WHERE channel_id=%s::uuid", (channel_id,))
            cur.execute("DELETE FROM channel_members WHERE channel_id=%s::uuid", (channel_id,))
            cur.execute("DELETE FROM message_channels WHERE channel_id=%s::uuid", (channel_id,))
        else:
            # Non-creator just leaves
            cur.execute(
                "DELETE FROM channel_members WHERE channel_id=%s::uuid AND user_id=%s::uuid",
                (channel_id, user["user_id"]),
            )
        conn.commit()
    finally:
        conn.close()


@router.get("/channels/{channel_id}/messages")
def list_messages(
    channel_id: str,
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None),
):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _assert_member(cur, channel_id, user["user_id"])

        params: list = [channel_id]
        where = "WHERE m.channel_id = %s::uuid"
        if before:
            where += " AND m.created_at < %s::timestamptz"
            params.append(before)

        cur.execute(
            f"""
            SELECT m.*, u.name AS sender_display_name
            FROM channel_messages m
            LEFT JOIN users u ON u.user_id = m.sender_id
            {where}
            ORDER BY m.created_at DESC
            LIMIT %s
            """,
            params + [limit],
        )
        msgs = [_fmt_msg(r) for r in cur.fetchall()]
        return list(reversed(msgs))
    finally:
        conn.close()


@router.post("/channels/{channel_id}/messages", status_code=201)
def send_message(channel_id: str, body: SendMessageBody, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not body.body.strip():
        raise HTTPException(status_code=422, detail="Message body cannot be empty")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _assert_member(cur, channel_id, user["user_id"])

        cur.execute(
            """
            INSERT INTO channel_messages (channel_id, sender_id, sender_name, body, is_announcement)
            VALUES (%s::uuid, %s::uuid, %s, %s, %s)
            RETURNING *
            """,
            (channel_id, user["user_id"], user.get("name"), body.body.strip(), body.is_announcement),
        )
        msg = _fmt_msg(cur.fetchone())

        # Update channel updated_at
        cur.execute(
            "UPDATE message_channels SET updated_at=now() WHERE channel_id=%s::uuid",
            (channel_id,),
        )
        conn.commit()
        return msg
    finally:
        conn.close()


@router.delete("/messages/{message_id}", status_code=204)
def delete_message(message_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT sender_id::text FROM channel_messages WHERE message_id=%s::uuid",
            (message_id,),
        )
        msg = cur.fetchone()
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found")
        if msg["sender_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Cannot delete others' messages")

        cur.execute("DELETE FROM channel_messages WHERE message_id=%s::uuid", (message_id,))
        conn.commit()
    finally:
        conn.close()


@router.get("/unread")
def unread_counts(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT c.channel_id::text,
                   COUNT(m.message_id) AS unread
            FROM message_channels c
            JOIN channel_members cm ON cm.channel_id = c.channel_id AND cm.user_id = %s::uuid
            LEFT JOIN channel_messages m ON m.channel_id = c.channel_id
              AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
              AND (m.sender_id IS NULL OR m.sender_id != %s::uuid)
            GROUP BY c.channel_id
            """,
            (user["user_id"], user["user_id"]),
        )
        counts = {r["channel_id"]: int(r["unread"]) for r in cur.fetchall()}
        total = sum(counts.values())
        return {"channels": counts, "total": total}
    finally:
        conn.close()


@router.patch("/channels/{channel_id}/read", status_code=204)
def mark_read(channel_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE channel_members SET last_read_at = now()
            WHERE channel_id = %s::uuid AND user_id = %s::uuid
            """,
            (channel_id, user["user_id"]),
        )
        conn.commit()
    finally:
        conn.close()


# ── Portal-facing endpoints (no user auth — uses portal session token) ─────────

def _get_portal_session(cur, token: str) -> dict:
    cur.execute(
        """
        SELECT ps.session_token, ps.portal_id, ps.viewer_id,
               pp.project_id, pp.messaging_enabled, pp.messaging_channel_id,
               pv.name AS viewer_name, pv.email AS viewer_email
        FROM portal_sessions ps
        JOIN project_portals pp ON pp.portal_id = ps.portal_id
        LEFT JOIN portal_viewers pv ON pv.viewer_id = ps.viewer_id
        WHERE ps.session_token = %s
          AND (ps.expires_at IS NULL OR ps.expires_at > now())
          AND pp.is_active = true
        """,
        (token,),
    )
    return cur.fetchone()


@router.post("/portal/{portal_token}/send", status_code=201)
def portal_send_message(portal_token: str, body: SendMessageBody, request: Request):
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="Message body cannot be empty")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        session = _get_portal_session(cur, portal_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        if not session["messaging_enabled"]:
            raise HTTPException(status_code=403, detail="Messaging is not enabled for this portal")

        channel_id = session["messaging_channel_id"]
        if not channel_id:
            # Auto-create a channel for this portal if one doesn't exist yet
            cur.execute(
                """
                INSERT INTO message_channels (name, channel_type, created_by)
                VALUES (%s, 'group', NULL)
                RETURNING channel_id
                """,
                (f"Portal: {session['project_id']}",),
            )
            channel_id = str(cur.fetchone()["channel_id"])
            cur.execute(
                "UPDATE project_portals SET messaging_channel_id=%s::uuid WHERE portal_id=%s::uuid",
                (channel_id, session["portal_id"]),
            )

        sender_name = session.get("viewer_name") or session.get("viewer_email") or "Portal visitor"
        cur.execute(
            """
            INSERT INTO channel_messages
                (channel_id, sender_id, sender_name, body, portal_token)
            VALUES (%s::uuid, NULL, %s, %s, %s)
            RETURNING *
            """,
            (channel_id, sender_name, body.body.strip(), portal_token),
        )
        msg = _fmt_msg(cur.fetchone())
        cur.execute(
            "UPDATE message_channels SET updated_at=now() WHERE channel_id=%s::uuid",
            (channel_id,),
        )
        conn.commit()
        return msg
    finally:
        conn.close()


@router.get("/portal/{portal_token}/messages")
def portal_list_messages(
    portal_token: str,
    request: Request,
    limit: int = Query(50, ge=1, le=100),
):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        session = _get_portal_session(cur, portal_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        if not session["messaging_enabled"]:
            raise HTTPException(status_code=403, detail="Messaging is not enabled for this portal")

        channel_id = session["messaging_channel_id"]
        if not channel_id:
            return {"messages": [], "enabled": True}

        cur.execute(
            """
            SELECT m.*, u.name AS sender_display_name
            FROM channel_messages m
            LEFT JOIN users u ON u.user_id = m.sender_id
            WHERE m.channel_id = %s::uuid
            ORDER BY m.created_at DESC
            LIMIT %s
            """,
            (channel_id, limit),
        )
        msgs = [_fmt_msg(r) for r in cur.fetchall()]
        return {"messages": list(reversed(msgs)), "enabled": True}
    finally:
        conn.close()
