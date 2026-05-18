"""
notes.py — Meeting / session notes with live transcription and AI analysis.

GET    /notes                       — list notes (own)
POST   /notes                       — create note
GET    /notes/recent                — recent notes for FAB
GET    /notes/calendar-events       — upcoming calendar events (via Google OAuth)
GET    /notes/{id}                  — get note detail + contacts
PATCH  /notes/{id}                  — update note fields
DELETE /notes/{id}                  — soft-delete
POST   /notes/{id}/contacts         — add contact link
DELETE /notes/{id}/contacts/{cid}   — remove contact link
POST   /notes/{id}/analyze          — (re)trigger AI analysis
WS     /notes/ws/{id}/transcribe    — streaming transcription relay (Deepgram)
"""
import asyncio
import json
import logging
import os
import time
from typing import Optional

import psycopg2
import psycopg2.extras
import uuid as _uuid
from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.routers.auth import get_current_user
from app.agents.usage_logger import log_deepgram_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _redisconn():
    import redis as redis_lib
    return redis_lib.from_url(os.environ["REDIS_URL"])


# ── Pydantic models ────────────────────────────────────────────────────────────

class NoteCreate(BaseModel):
    title: str = "Untitled Note"
    body: Optional[str] = None
    calendar_event_id: Optional[str] = None
    calendar_event_title: Optional[str] = None
    calendar_event_time: Optional[str] = None


class NotePatch(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    calendar_event_id: Optional[str] = None
    calendar_event_title: Optional[str] = None
    calendar_event_time: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _serialize(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, __builtins__.__class__) or str(type(v)) == "<class 'uuid.UUID'>":
            out[k] = str(v)
        else:
            out[k] = v
    return out


def _fmt(row: dict) -> dict:
    d = dict(row)
    for ts_field in ("created_at", "updated_at", "calendar_event_time"):
        if d.get(ts_field) and hasattr(d[ts_field], "isoformat"):
            d[ts_field] = d[ts_field].isoformat()
    for uuid_field in ("note_id", "user_id"):
        if d.get(uuid_field):
            d[uuid_field] = str(d[uuid_field])
    return d


# ── CRUD ───────────────────────────────────────────────────────────────────────

@router.get("")
def list_notes(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        params: list = [user["user_id"]]
        filters = ["n.user_id = %s::uuid", "n.is_deleted = false"]
        if search.strip():
            filters.append("(n.title ILIKE %s OR n.raw_transcript ILIKE %s OR n.ai_summary ILIKE %s)")
            like = f"%{search.strip()}%"
            params.extend([like, like, like])
        where = " AND ".join(filters)
        params.extend([limit, offset])
        cur.execute(
            f"""
            SELECT n.note_id, n.user_id, n.title, n.body,
                   n.ai_summary, n.ai_status,
                   n.action_items, n.decisions, n.follow_ups,
                   n.calendar_event_id, n.calendar_event_title, n.calendar_event_time,
                   n.created_at, n.updated_at,
                   COALESCE(
                       json_agg(
                           json_build_object('contact_id', c.contact_id, 'name', c.name,
                                            'organization', c.organization, 'source', nc.source)
                       ) FILTER (WHERE c.contact_id IS NOT NULL),
                       '[]'
                   ) AS contacts
            FROM notes n
            LEFT JOIN note_contacts nc ON nc.note_id = n.note_id
            LEFT JOIN contacts c ON c.contact_id = nc.contact_id
            WHERE {where}
            GROUP BY n.note_id
            ORDER BY n.created_at DESC
            LIMIT %s OFFSET %s
            """,
            params,
        )
        rows = [_fmt(r) for r in cur.fetchall()]
        cur.execute(f"SELECT COUNT(*) FROM notes n WHERE {where}", params[:-2])
        total = cur.fetchone()["count"]
        return {"notes": rows, "total": total}
    finally:
        conn.close()


@router.get("/recent")
def recent_notes(request: Request, limit: int = Query(5, ge=1, le=20)):
    user = get_current_user(request)
    if not user:
        return []
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT note_id, title, ai_status, calendar_event_title,
                   created_at, updated_at
            FROM notes
            WHERE user_id = %s::uuid AND is_deleted = false
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (user["user_id"], limit),
        )
        return [_fmt(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.get("/calendar-events")
def get_calendar_events(request: Request):
    """Return today's and upcoming calendar events using the user's Google OAuth token."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    from app.routers.contacts import _get_user_google_token
    try:
        token = _get_user_google_token(user["user_id"])
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=400, detail="google_not_connected")
        raise

    import httpx
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=7)).isoformat()

    resp = httpx.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        headers={"Authorization": f"Bearer {token}"},
        params={
            "timeMin": time_min,
            "timeMax": time_max,
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": 20,
        },
        timeout=10,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Calendar API error")

    events = resp.json().get("items", [])
    result = []
    for ev in events:
        start = ev.get("start", {})
        result.append({
            "id":      ev.get("id"),
            "title":   ev.get("summary", "Untitled event"),
            "time":    start.get("dateTime") or start.get("date"),
            "attendees": [
                a.get("email") for a in ev.get("attendees", [])
                if a.get("email") and not a.get("self")
            ],
        })
    return result


@router.post("", status_code=201)
def create_note(body: NoteCreate, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO notes (user_id, title, body,
                               calendar_event_id, calendar_event_title, calendar_event_time)
            VALUES (%s::uuid, %s, %s, %s, %s, %s::timestamptz)
            RETURNING *
            """,
            (
                user["user_id"], body.title, body.body,
                body.calendar_event_id, body.calendar_event_title,
                body.calendar_event_time or None,
            ),
        )
        note = _fmt(cur.fetchone())
        conn.commit()

        # If calendar event provided, try to auto-link attendee contacts
        if body.calendar_event_id:
            _auto_link_attendees(cur, conn, note["note_id"], body.calendar_event_id, user)

        note["contacts"] = []
        try:
            from app.worker import embed_content_task
            embed_content_task.delay("notes", note["note_id"], user["user_id"])
        except Exception:
            pass
        return note
    finally:
        conn.close()


def _auto_link_attendees(cur, conn, note_id: str, event_id: str, user: dict):
    """Match calendar event attendees to contacts and link them to the note."""
    try:
        from app.routers.contacts import _get_user_google_token
        import httpx
        token = _get_user_google_token(user["user_id"])
        resp = httpx.get(
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        if resp.status_code != 200:
            return
        event = resp.json()
        emails = [
            a.get("email") for a in event.get("attendees", [])
            if a.get("email") and not a.get("self")
        ]
        for email in emails:
            cur.execute(
                "SELECT contact_id FROM contacts WHERE email = %s LIMIT 1",
                (email,),
            )
            row = cur.fetchone()
            if row:
                try:
                    cur.execute(
                        "INSERT INTO note_contacts (note_id, contact_id, source) VALUES (%s::uuid, %s::uuid, 'attendee') ON CONFLICT DO NOTHING",
                        (note_id, str(row["contact_id"])),
                    )
                    conn.commit()
                except Exception:
                    conn.rollback()
    except Exception as e:
        logger.warning("_auto_link_attendees failed: %s", e)


@router.get("/{note_id}")
def get_note(note_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT n.*,
                   COALESCE(
                       json_agg(
                           json_build_object('contact_id', c.contact_id, 'name', c.name,
                                            'organization', c.organization, 'source', nc.source,
                                            'email', c.email)
                       ) FILTER (WHERE c.contact_id IS NOT NULL),
                       '[]'
                   ) AS contacts
            FROM notes n
            LEFT JOIN note_contacts nc ON nc.note_id = n.note_id
            LEFT JOIN contacts c ON c.contact_id = nc.contact_id
            WHERE n.note_id = %s::uuid AND n.is_deleted = false
            GROUP BY n.note_id
            """,
            (note_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note not found")
        note = _fmt(row)
        if str(note.get("user_id")) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Access denied")
        return note
    finally:
        conn.close()


@router.patch("/{note_id}")
def update_note(note_id: str, body: NotePatch, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT user_id FROM notes WHERE note_id = %s::uuid AND is_deleted = false",
            (note_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note not found")
        if str(row["user_id"]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")

        sets: list[str] = ["updated_at = now()"]
        params: list = []
        for field in ("title", "body"):
            val = getattr(body, field)
            if val is not None:
                sets.append(f"{field} = %s"); params.append(val)
        if body.calendar_event_id is not None:
            sets.append("calendar_event_id = %s"); params.append(body.calendar_event_id or None)
        if body.calendar_event_title is not None:
            sets.append("calendar_event_title = %s"); params.append(body.calendar_event_title or None)
        if body.calendar_event_time is not None:
            sets.append("calendar_event_time = %s::timestamptz"); params.append(body.calendar_event_time or None)

        params.append(note_id)
        cur.execute(
            f"UPDATE notes SET {', '.join(sets)} WHERE note_id = %s::uuid RETURNING *",
            params,
        )
        conn.commit()
        updated = _fmt(cur.fetchone())
        try:
            from app.worker import embed_content_task
            embed_content_task.delay("notes", note_id, user["user_id"])
        except Exception:
            pass
        return updated
    finally:
        conn.close()


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id FROM notes WHERE note_id = %s::uuid AND is_deleted = false",
            (note_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note not found")
        if str(row[0]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")
        cur.execute(
            "UPDATE notes SET is_deleted = true, updated_at = now() WHERE note_id = %s::uuid",
            (note_id,),
        )
        conn.commit()
    finally:
        conn.close()


# ── Contact linking ────────────────────────────────────────────────────────────

@router.post("/{note_id}/contacts", status_code=201)
def add_note_contact(note_id: str, body: dict, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    contact_id = body.get("contact_id")
    if not contact_id:
        raise HTTPException(status_code=422, detail="contact_id required")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO note_contacts (note_id, contact_id, source)
            VALUES (%s::uuid, %s::uuid, 'manual')
            ON CONFLICT (note_id, contact_id) DO NOTHING
            """,
            (note_id, contact_id),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/{note_id}/contacts/{contact_id}", status_code=204)
def remove_note_contact(note_id: str, contact_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM note_contacts WHERE note_id = %s::uuid AND contact_id = %s::uuid",
            (note_id, contact_id),
        )
        conn.commit()
    finally:
        conn.close()


# ── AI analysis (re)trigger ────────────────────────────────────────────────────

@router.post("/{note_id}/analyze")
def trigger_analyze(note_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, raw_transcript FROM notes WHERE note_id = %s::uuid AND is_deleted = false",
            (note_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note not found")
        if str(row[0]) != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorised")
        if not row[1]:
            raise HTTPException(status_code=422, detail="No transcript to analyze")
        cur.execute(
            "UPDATE notes SET ai_status = 'processing', updated_at = now() WHERE note_id = %s::uuid",
            (note_id,),
        )
        conn.commit()
    finally:
        conn.close()

    from app.worker import analyze_note_task
    analyze_note_task.delay(note_id)
    return {"ok": True, "status": "processing"}


# ── WebSocket ticket (short-lived auth token for WS upgrade) ──────────────────

@router.post("/{note_id}/ws-ticket")
def get_ws_ticket(note_id: str, request: Request):
    """Issue a 60-second one-time ticket for WebSocket auth.

    Called by the frontend before opening the WS connection.  The ticket is
    stored in Redis with user info so the WS handler can look it up without
    relying on cookies (which carry NextAuth JWE that Python can't easily
    decode).
    """
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Verify note ownership
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id FROM notes WHERE note_id = %s::uuid AND is_deleted = false",
            (note_id,),
        )
        row = cur.fetchone()
        if not row or str(row[0]) != user["user_id"]:
            raise HTTPException(status_code=404, detail="Note not found")
    finally:
        conn.close()

    ticket = str(_uuid.uuid4())
    r = _redisconn()
    r.setex(
        f"ws_ticket:{ticket}",
        60,  # 60 second TTL
        json.dumps({"user_id": user["user_id"], "email": user["email"], "role": user["role"]}),
    )
    return {"ticket": ticket}


# ── WebSocket: streaming transcription relay ────────────────────────────────────

@router.websocket("/ws/{note_id}/transcribe")
async def transcribe_stream(websocket: WebSocket, note_id: str, ticket: str = ""):
    """
    Relay audio from the browser to Deepgram's streaming API and return
    live transcription results.  After the stream ends, persists the full
    transcript and enqueues AI analysis.

    Auth: caller must first POST /notes/{id}/ws-ticket to get a short-lived
    ticket and pass it as ?ticket=<uuid> in the WS URL.
    """
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
            logger.warning("ws ticket lookup failed: %s", e)

    if not user:
        await websocket.send_json({"type": "error", "error": "not_authenticated"})
        await websocket.close(code=4001)
        return

    api_key = os.environ.get("DEEPGRAM_API_KEY", "")
    if not api_key:
        await websocket.send_json({"type": "error", "error": "deepgram_not_configured"})
        await websocket.close(code=4002)
        return

    # Quick note existence check
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id FROM notes WHERE note_id = %s::uuid AND is_deleted = false",
            (note_id,),
        )
        row = cur.fetchone()
        if not row:
            await websocket.send_json({"type": "error", "error": "note_not_found"})
            await websocket.close(code=4003)
            return
    finally:
        conn.close()

    dg_url = (
        "wss://api.deepgram.com/v1/listen"
        "?model=nova-2"
        "&language=en"
        "&smart_format=true"
        "&interim_results=true"
        "&vad_events=true"
        "&endpointing=300"
        "&utterance_end_ms=1000"
    )

    transcript_parts: list[str] = []
    _stream_start: float = 0.0

    try:
        import websockets as ws_lib

        async with ws_lib.connect(
            dg_url,
            additional_headers={"Authorization": f"Token {api_key}"},
            max_size=10 * 1024 * 1024,
        ) as dg_ws:
            _stream_start = time.monotonic()

            async def forward_audio():
                """Receive audio chunks from browser and forward to Deepgram."""
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
                                # Signal Deepgram end-of-stream
                                await dg_ws.send(json.dumps({"type": "CloseStream"}))
                                break
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.warning("forward_audio error: %s", e)

            async def forward_transcript():
                """Receive Deepgram results and relay to browser."""
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
                                        "type":        "transcript",
                                        "transcript":  transcript,
                                        "is_final":    is_final,
                                        "speech_final": speech_final,
                                    })
                                except Exception:
                                    break

                        elif msg_type == "UtteranceEnd":
                            try:
                                await websocket.send_json({"type": "utterance_end"})
                            except Exception:
                                break

                        elif msg_type in ("Metadata", "SpeechStarted"):
                            pass  # ignore

                except Exception as e:
                    logger.warning("forward_transcript error: %s", e)

            await asyncio.gather(forward_audio(), forward_transcript())
            if _stream_start:
                log_deepgram_session(audio_seconds=time.monotonic() - _stream_start)

    except Exception as e:
        logger.error("transcribe_stream error for note %s: %s", note_id, e)
        try:
            await websocket.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass

    # Persist transcript and trigger AI analysis
    if transcript_parts:
        full_text = " ".join(transcript_parts)
        db = _conn()
        try:
            c = db.cursor()
            c.execute(
                "UPDATE notes SET raw_transcript = %s, ai_status = 'processing', updated_at = now() WHERE note_id = %s::uuid",
                (full_text, note_id),
            )
            c.execute(
                "INSERT INTO note_recordings (note_id, transcription_status) VALUES (%s::uuid, 'done')",
                (note_id,),
            )
            db.commit()
        except Exception as e:
            logger.error("Failed to persist transcript for note %s: %s", note_id, e)
        finally:
            db.close()

        from app.worker import analyze_note_task
        analyze_note_task.delay(note_id)

    try:
        await websocket.send_json({"type": "done", "parts": len(transcript_parts)})
    except Exception:
        pass
