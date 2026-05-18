"""
calendar.py — Google Calendar CRUD endpoints.

GET    /calendar/events              — list events in a date range
POST   /calendar/events              — create a new event
PATCH  /calendar/events/{event_id}   — update an existing event
DELETE /calendar/events/{event_id}   — delete an event
"""
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calendar", tags=["calendar"])

GCAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


# ── Models ─────────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start: str          # ISO 8601 datetime OR date (all-day)
    end: str            # ISO 8601 datetime OR date (all-day)
    timezone: str = "UTC"
    all_day: bool = False
    attendee_emails: Optional[list[str]] = []


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    timezone: Optional[str] = None
    all_day: Optional[bool] = None
    attendee_emails: Optional[list[str]] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _token(user_id: str) -> str:
    from app.routers.contacts import _get_user_google_token
    return _get_user_google_token(user_id)


def _fmt_event(ev: dict) -> dict:
    start = ev.get("start", {})
    end = ev.get("end", {})
    return {
        "id":          ev.get("id"),
        "title":       ev.get("summary", "Untitled"),
        "description": ev.get("description", ""),
        "start":       start.get("dateTime") or start.get("date"),
        "end":         end.get("dateTime") or end.get("date"),
        "all_day":     "date" in start and "dateTime" not in start,
        "timezone":    start.get("timeZone") or end.get("timeZone") or "UTC",
        "attendees":   [
            {"email": a.get("email"), "name": a.get("displayName", "")}
            for a in ev.get("attendees", [])
        ],
        "html_link":   ev.get("htmlLink"),
        "status":      ev.get("status"),
        "color_id":    ev.get("colorId"),
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/events")
def list_events(
    request: Request,
    time_min: Optional[str] = Query(None, description="ISO 8601 start of range"),
    time_max: Optional[str] = Query(None, description="ISO 8601 end of range"),
    max_results: int = Query(250, ge=1, le=2500),
):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        token = _token(user["user_id"])
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=400, detail="google_not_connected")
        raise

    now = datetime.now(timezone.utc)
    t_min = time_min or (now - timedelta(days=1)).isoformat()
    t_max = time_max or (now + timedelta(days=60)).isoformat()

    resp = httpx.get(
        GCAL_BASE,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "timeMin": t_min,
            "timeMax": t_max,
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": max_results,
        },
        timeout=15,
    )
    if resp.status_code != 200:
        logger.error("Google Calendar list error: %s", resp.text)
        raise HTTPException(status_code=502, detail="Calendar API error")

    items = resp.json().get("items", [])
    return {"events": [_fmt_event(ev) for ev in items]}


@router.post("/events", status_code=201)
def create_event(body: EventCreate, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        token = _token(user["user_id"])
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=400, detail="google_not_connected")
        raise

    if body.all_day:
        start_obj = {"date": body.start[:10]}
        end_obj   = {"date": body.end[:10]}
    else:
        start_obj = {"dateTime": body.start, "timeZone": body.timezone}
        end_obj   = {"dateTime": body.end,   "timeZone": body.timezone}

    attendees = [{"email": e} for e in (body.attendee_emails or []) if e]

    payload = {
        "summary":     body.title,
        "description": body.description or "",
        "start":       start_obj,
        "end":         end_obj,
        "attendees":   attendees,
        "reminders":   {"useDefault": True},
    }

    resp = httpx.post(
        GCAL_BASE + "?sendUpdates=all",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    if resp.status_code not in (200, 201):
        logger.error("Google Calendar create error: %s", resp.text)
        raise HTTPException(status_code=502, detail="Calendar API error")

    return _fmt_event(resp.json())


@router.patch("/events/{event_id}")
def update_event(event_id: str, body: EventUpdate, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        token = _token(user["user_id"])
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=400, detail="google_not_connected")
        raise

    # Fetch existing event first
    get_resp = httpx.get(
        f"{GCAL_BASE}/{event_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if get_resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Event not found")
    if get_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Calendar API error")

    existing = get_resp.json()
    patch: dict = {}

    if body.title is not None:
        patch["summary"] = body.title
    if body.description is not None:
        patch["description"] = body.description

    all_day = body.all_day
    tz = body.timezone or existing.get("start", {}).get("timeZone", "UTC")

    if body.start is not None or body.end is not None or body.all_day is not None:
        if all_day is None:
            existing_start = existing.get("start", {})
            all_day = "date" in existing_start and "dateTime" not in existing_start

        start_val = body.start or (existing.get("start", {}).get("dateTime") or existing.get("start", {}).get("date"))
        end_val   = body.end   or (existing.get("end",   {}).get("dateTime") or existing.get("end",   {}).get("date"))

        if all_day:
            patch["start"] = {"date": start_val[:10]}
            patch["end"]   = {"date": end_val[:10]}
        else:
            patch["start"] = {"dateTime": start_val, "timeZone": tz}
            patch["end"]   = {"dateTime": end_val,   "timeZone": tz}

    if body.attendee_emails is not None:
        patch["attendees"] = [{"email": e} for e in body.attendee_emails if e]

    resp = httpx.patch(
        f"{GCAL_BASE}/{event_id}?sendUpdates=all",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=patch,
        timeout=15,
    )
    if resp.status_code != 200:
        logger.error("Google Calendar patch error: %s", resp.text)
        raise HTTPException(status_code=502, detail="Calendar API error")

    return _fmt_event(resp.json())


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        token = _token(user["user_id"])
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=400, detail="google_not_connected")
        raise

    resp = httpx.delete(
        f"{GCAL_BASE}/{event_id}?sendUpdates=all",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Event not found")
    if resp.status_code not in (200, 204, 410):
        logger.error("Google Calendar delete error: %s %s", resp.status_code, resp.text)
        raise HTTPException(status_code=502, detail="Calendar API error")