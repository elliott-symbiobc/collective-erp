"""time_tracking.py — Employee time tracking

GET    /time-entries              — list entries (admin=all, user=own); ?date=YYYY-MM-DD&week=YYYY-MM-DD&user_id=
POST   /time-entries              — log a time entry
GET    /time-entries/summary      — hours per user per day (admin only)
PATCH  /time-entries/{entry_id}   — update entry
DELETE /time-entries/{entry_id}   — delete entry
GET    /time-entries/timer        — get active timer for current user
POST   /time-entries/timer/start  — start a live timer
POST   /time-entries/timer/stop   — stop timer and save as a time entry
DELETE /time-entries/timer        — discard active timer without saving
"""

import os
import logging
from datetime import date, timedelta
from typing import Optional
from uuid import UUID

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.routers.auth import get_current_user, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/time-entries", tags=["time-tracking"])


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def ensure_table() -> None:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS time_entries (
                    entry_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id          TEXT NOT NULL,
                    user_email       TEXT NOT NULL,
                    user_name        TEXT,
                    task_id          UUID,
                    task_title       TEXT,
                    entry_date       DATE NOT NULL,
                    start_time       TIME,
                    end_time         TIME,
                    duration_minutes INT  NOT NULL CHECK (duration_minutes > 0),
                    description      TEXT,
                    created_at       TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS time_entries_date_idx ON time_entries (entry_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS time_entries_user_idx ON time_entries (user_id)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS active_timers (
                    timer_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id    TEXT NOT NULL UNIQUE,
                    user_email TEXT NOT NULL,
                    user_name  TEXT,
                    task_id    UUID,
                    task_title TEXT,
                    description TEXT,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS active_timers_user_idx ON active_timers (user_id)")
        conn.commit()
    finally:
        conn.close()


class CreateEntryRequest(BaseModel):
    task_id: Optional[str] = None
    task_title: Optional[str] = None
    entry_date: str                  # YYYY-MM-DD
    start_time: Optional[str] = None # HH:MM
    end_time: Optional[str] = None   # HH:MM
    duration_minutes: int
    description: Optional[str] = None


class UpdateEntryRequest(BaseModel):
    task_id: Optional[str] = None
    task_title: Optional[str] = None
    entry_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    description: Optional[str] = None


def _row_to_dict(r) -> dict:
    return {
        "entry_id":         str(r["entry_id"]),
        "user_id":          r["user_id"],
        "user_email":       r["user_email"],
        "user_name":        r["user_name"],
        "task_id":          str(r["task_id"]) if r["task_id"] else None,
        "task_title":       r["task_title"],
        "entry_date":       r["entry_date"].isoformat() if r["entry_date"] else None,
        "start_time":       r["start_time"].strftime("%H:%M") if r["start_time"] else None,
        "end_time":         r["end_time"].strftime("%H:%M") if r["end_time"] else None,
        "duration_minutes": r["duration_minutes"],
        "description":      r["description"],
        "created_at":       r["created_at"].isoformat() if r["created_at"] else None,
    }


@router.get("/summary")
def get_summary(request: Request, week: Optional[str] = None):
    """Returns total minutes per user per day for a given week (Mon–Sun)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    is_admin = user.get("role") == "admin"

    if week:
        try:
            week_start = date.fromisoformat(week)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid week date")
    else:
        today = date.today()
        week_start = today - timedelta(days=today.weekday())

    week_end = week_start + timedelta(days=6)

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if is_admin:
                cur.execute("""
                    SELECT user_id, user_email, user_name, entry_date,
                           SUM(duration_minutes) AS total_minutes
                    FROM time_entries
                    WHERE entry_date BETWEEN %s AND %s
                    GROUP BY user_id, user_email, user_name, entry_date
                    ORDER BY user_name NULLS LAST, entry_date
                """, (week_start, week_end))
            else:
                cur.execute("""
                    SELECT user_id, user_email, user_name, entry_date,
                           SUM(duration_minutes) AS total_minutes
                    FROM time_entries
                    WHERE entry_date BETWEEN %s AND %s AND user_email = %s
                    GROUP BY user_id, user_email, user_name, entry_date
                    ORDER BY entry_date
                """, (week_start, week_end, user["email"]))
            rows = cur.fetchall()
    finally:
        conn.close()

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "rows": [
            {
                "user_id": r["user_id"],
                "user_email": r["user_email"],
                "user_name": r["user_name"],
                "entry_date": r["entry_date"].isoformat(),
                "total_minutes": int(r["total_minutes"]),
            }
            for r in rows
        ],
    }


class StartTimerRequest(BaseModel):
    task_id: Optional[str] = None
    task_title: Optional[str] = None
    description: Optional[str] = None


@router.get("/timer")
def get_active_timer(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM active_timers WHERE user_id = %s", (user["user_id"],))
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {
        "timer_id":    str(row["timer_id"]),
        "user_id":     row["user_id"],
        "user_email":  row["user_email"],
        "user_name":   row["user_name"],
        "task_id":     str(row["task_id"]) if row["task_id"] else None,
        "task_title":  row["task_title"],
        "description": row["description"],
        "started_at":  row["started_at"].isoformat(),
    }


@router.post("/timer/start")
def start_timer(body: StartTimerRequest, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    task_title = body.task_title
    if body.task_id and not task_title:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT title FROM tasks WHERE task_id = %s", (body.task_id,))
                row = cur.fetchone()
                if row:
                    task_title = row[0]
        finally:
            conn.close()

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO active_timers (user_id, user_email, user_name, task_id, task_title, description)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    task_id     = EXCLUDED.task_id,
                    task_title  = EXCLUDED.task_title,
                    description = EXCLUDED.description,
                    started_at  = NOW()
                RETURNING *
            """, (
                user["user_id"],
                user["email"],
                user.get("name"),
                body.task_id or None,
                task_title,
                body.description or None,
            ))
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    return {
        "timer_id":    str(row["timer_id"]),
        "user_id":     row["user_id"],
        "user_email":  row["user_email"],
        "user_name":   row["user_name"],
        "task_id":     str(row["task_id"]) if row["task_id"] else None,
        "task_title":  row["task_title"],
        "description": row["description"],
        "started_at":  row["started_at"].isoformat(),
    }


@router.post("/timer/stop")
def stop_timer(request: Request):
    import datetime as dt
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM active_timers WHERE user_id = %s", (user["user_id"],))
            timer = cur.fetchone()
            if not timer:
                raise HTTPException(status_code=404, detail="No active timer")

            now = dt.datetime.now(dt.timezone.utc)
            started = timer["started_at"]
            elapsed_seconds = (now - started).total_seconds()
            duration_minutes = max(1, int(elapsed_seconds / 60))

            entry_date = started.date()
            start_str = started.strftime("%H:%M")
            end_str = now.strftime("%H:%M")

            cur.execute("""
                INSERT INTO time_entries
                    (user_id, user_email, user_name, task_id, task_title,
                     entry_date, start_time, end_time, duration_minutes, description)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                user["user_id"],
                user["email"],
                user.get("name"),
                timer["task_id"],
                timer["task_title"],
                entry_date,
                start_str,
                end_str,
                duration_minutes,
                timer["description"],
            ))
            entry_row = cur.fetchone()
            cur.execute("DELETE FROM active_timers WHERE user_id = %s", (user["user_id"],))
        conn.commit()
    finally:
        conn.close()

    return _row_to_dict(entry_row)


@router.delete("/timer")
def discard_timer(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM active_timers WHERE user_id = %s", (user["user_id"],))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.get("")
def list_entries(
    request: Request,
    date: Optional[str] = None,
    week: Optional[str] = None,
    user_id: Optional[str] = None,
):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    is_admin = user.get("role") == "admin"

    filters = []
    params = []

    if date:
        filters.append("te.entry_date = %s")
        params.append(date)
    elif week:
        try:
            ws = date_obj = __import__("datetime").date.fromisoformat(week)
            we = ws + timedelta(days=6)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid week date")
        filters.append("te.entry_date BETWEEN %s AND %s")
        params.extend([ws, we])

    if is_admin and user_id:
        filters.append("te.user_id = %s")
        params.append(user_id)
    elif not is_admin:
        filters.append("te.user_email = %s")
        params.append(user["email"])

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                SELECT te.*, t.title AS live_task_title
                FROM time_entries te
                LEFT JOIN tasks t ON t.task_id = te.task_id
                {where}
                ORDER BY te.entry_date DESC, te.start_time NULLS LAST, te.created_at DESC
            """, params)
            rows = cur.fetchall()
    finally:
        conn.close()

    return [_row_to_dict(r) for r in rows]


@router.post("")
def create_entry(body: CreateEntryRequest, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if body.duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="duration_minutes must be positive")

    task_title = body.task_title
    if body.task_id and not task_title:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT title FROM tasks WHERE task_id = %s", (body.task_id,))
                row = cur.fetchone()
                if row:
                    task_title = row[0]
        finally:
            conn.close()

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO time_entries
                    (user_id, user_email, user_name, task_id, task_title,
                     entry_date, start_time, end_time, duration_minutes, description)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                user["user_id"],
                user["email"],
                user.get("name"),
                body.task_id or None,
                task_title,
                body.entry_date,
                body.start_time or None,
                body.end_time or None,
                body.duration_minutes,
                body.description or None,
            ))
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    return _row_to_dict(row)


@router.patch("/{entry_id}")
def update_entry(entry_id: str, body: UpdateEntryRequest, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    is_admin = user.get("role") == "admin"

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM time_entries WHERE entry_id = %s", (entry_id,))
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Entry not found")
            if not is_admin and existing["user_email"] != user["email"]:
                raise HTTPException(status_code=403, detail="Not your entry")

            updates = {}
            if body.task_id is not None:
                updates["task_id"] = body.task_id or None
            if body.task_title is not None:
                updates["task_title"] = body.task_title
            if body.entry_date is not None:
                updates["entry_date"] = body.entry_date
            if body.start_time is not None:
                updates["start_time"] = body.start_time or None
            if body.end_time is not None:
                updates["end_time"] = body.end_time or None
            if body.duration_minutes is not None:
                if body.duration_minutes <= 0:
                    raise HTTPException(status_code=400, detail="duration_minutes must be positive")
                updates["duration_minutes"] = body.duration_minutes
            if body.description is not None:
                updates["description"] = body.description or None

            if not updates:
                return _row_to_dict(existing)

            set_clause = ", ".join(f"{k} = %s" for k in updates)
            cur.execute(
                f"UPDATE time_entries SET {set_clause} WHERE entry_id = %s RETURNING *",
                [*updates.values(), entry_id],
            )
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    return _row_to_dict(row)


@router.delete("/{entry_id}")
def delete_entry(entry_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    is_admin = user.get("role") == "admin"

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT user_email FROM time_entries WHERE entry_id = %s", (entry_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Entry not found")
            if not is_admin and row[0] != user["email"]:
                raise HTTPException(status_code=403, detail="Not your entry")
            cur.execute("DELETE FROM time_entries WHERE entry_id = %s", (entry_id,))
        conn.commit()
    finally:
        conn.close()

    return {"ok": True}
