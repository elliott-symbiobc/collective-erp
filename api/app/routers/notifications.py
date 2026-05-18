"""
notifications.py — In-app notification inbox for task/project assignments.

GET    /notifications                   — list notifications for current user
POST   /notifications/{id}/respond      — approve or deny an assignment
PATCH  /notifications/{id}/read         — mark notification as read
GET    /notifications/preferences       — get current user's notification prefs
PATCH  /notifications/preferences       — update notify_email
"""
import logging
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


class RespondBody(BaseModel):
    action: str  # 'approved' | 'denied'


class PreferencesBody(BaseModel):
    notify_email: Optional[bool] = None


class SendNotificationBody(BaseModel):
    recipient_ids: list[str]
    title: str
    message: Optional[str] = None


def _fmt(row: dict) -> dict:
    d = dict(row)
    for f in ("notification_id", "recipient_id", "sender_id", "entity_id"):
        if d.get(f):
            d[f] = str(d[f])
    for ts in ("created_at", "read_at"):
        if d.get(ts) and hasattr(d[ts], "isoformat"):
            d[ts] = d[ts].isoformat()
    return d


@router.get("")
def list_notifications(
    request: Request,
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        where = "WHERE n.recipient_id = %s::uuid"
        params = [user["user_id"]]
        if unread_only:
            where += " AND n.status = 'pending'"

        cur.execute(
            f"""
            SELECT n.*,
                   s.name  AS sender_name,
                   s.email AS sender_email
            FROM task_notifications n
            LEFT JOIN users s ON s.user_id = n.sender_id
            {where}
            ORDER BY
                CASE WHEN n.status = 'pending' THEN 0 ELSE 1 END,
                n.created_at DESC
            LIMIT %s
            """,
            params + [limit],
        )
        rows = [_fmt(r) for r in cur.fetchall()]

        # Count unread for badge
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM task_notifications WHERE recipient_id = %s::uuid AND status = 'pending'",
            (user["user_id"],),
        )
        unread_count = cur.fetchone()["cnt"]

        return {"notifications": rows, "unread_count": int(unread_count)}
    finally:
        conn.close()


@router.post("/{notification_id}/respond")
def respond_notification(notification_id: str, body: RespondBody, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if body.action not in ("approved", "denied"):
        raise HTTPException(status_code=422, detail="action must be 'approved' or 'denied'")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM task_notifications WHERE notification_id = %s::uuid AND recipient_id = %s::uuid",
            (notification_id, user["user_id"]),
        )
        notif = cur.fetchone()
        if not notif:
            raise HTTPException(status_code=404, detail="Notification not found")
        if notif["status"] not in ("pending",):
            raise HTTPException(status_code=409, detail="Notification already responded to")

        cur.execute(
            "UPDATE task_notifications SET status = %s, read_at = now() WHERE notification_id = %s::uuid RETURNING *",
            (body.action, notification_id),
        )
        row = _fmt(cur.fetchone())

        # If denied, unassign the task/project from this user
        if body.action == "denied":
            if notif["entity_type"] == "task":
                cur.execute(
                    "UPDATE tasks SET assigned_to = NULL, updated_at = now() WHERE task_id = %s::uuid AND assigned_to = %s::uuid",
                    (str(notif["entity_id"]), user["user_id"]),
                )
            elif notif["entity_type"] == "project":
                cur.execute(
                    "UPDATE projects SET assigned_to = NULL, updated_at = now() WHERE project_id = %s::uuid AND assigned_to = %s::uuid",
                    (str(notif["entity_id"]), user["user_id"]),
                )

        conn.commit()
        return row
    finally:
        conn.close()


@router.patch("/{notification_id}/read")
def mark_read(notification_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            UPDATE task_notifications
            SET status = CASE WHEN status = 'pending' THEN 'read' ELSE status END,
                read_at = COALESCE(read_at, now())
            WHERE notification_id = %s::uuid AND recipient_id = %s::uuid
            RETURNING *
            """,
            (notification_id, user["user_id"]),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notification not found")
        conn.commit()
        return _fmt(row)
    finally:
        conn.close()


@router.delete("/{notification_id}", status_code=204)
def delete_notification(notification_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM task_notifications WHERE notification_id = %s::uuid AND recipient_id = %s::uuid",
            (notification_id, user["user_id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        conn.commit()
    finally:
        conn.close()


@router.get("/preferences")
def get_preferences(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT notify_email FROM users WHERE user_id = %s::uuid",
            (user["user_id"],),
        )
        row = cur.fetchone()
        if not row:
            return {"notify_email": False}
        return dict(row)
    finally:
        conn.close()


@router.post("/send", status_code=201)
def send_notification(body: SendNotificationBody, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Title cannot be empty")
    if not body.recipient_ids:
        raise HTTPException(status_code=422, detail="At least one recipient required")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        sent = []
        for rid in body.recipient_ids:
            if rid == user["user_id"]:
                continue  # don't notify yourself
            try:
                cur.execute(
                    """
                    INSERT INTO task_notifications
                        (recipient_id, sender_id, notification_type, entity_type, title, message)
                    VALUES (%s::uuid, %s::uuid, 'general', 'general', %s, %s)
                    RETURNING notification_id::text
                    """,
                    (rid, user["user_id"], body.title.strip(), body.message),
                )
                row = cur.fetchone()
                if row:
                    sent.append(row["notification_id"])
            except Exception as e:
                logger.warning("Failed to send notification to %s: %s", rid, e)
        conn.commit()
        return {"sent": len(sent), "notification_ids": sent}
    finally:
        conn.close()


@router.patch("/preferences")
def update_preferences(body: PreferencesBody, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    sets = ["updated_at = now()"]
    params = []

    if body.notify_email is not None:
        sets.append("notify_email = %s"); params.append(body.notify_email)

    if len(sets) == 1:
        raise HTTPException(status_code=422, detail="No fields to update")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        params.append(user["user_id"])
        cur.execute(
            f"UPDATE users SET {', '.join(sets)} WHERE user_id = %s::uuid RETURNING notify_email",
            params,
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row) if row else {}
    finally:
        conn.close()


def create_notification(
    conn,
    recipient_id: str,
    sender_id: str,
    notification_type: str,
    entity_type: str,
    entity_id: str,
    title: str,
    message: Optional[str] = None,
):
    """Helper called from tasks/projects when assignments are made."""
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO task_notifications
                (recipient_id, sender_id, notification_type, entity_type, entity_id, title, message)
            VALUES (%s::uuid, %s::uuid, %s, %s, %s::uuid, %s, %s)
            """,
            (recipient_id, sender_id, notification_type, entity_type, entity_id, title, message),
        )
    except Exception as e:
        logger.warning("Failed to create notification: %s", e)
