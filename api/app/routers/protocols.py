"""
protocols.py — Protocol Bank endpoints.

GET  /protocols              — list protocols with filters
GET  /protocols/{id}         — single protocol
PATCH /protocols/{id}        — update protocol fields
PATCH /protocols/{id}/status — update status (draft→approved, approved→archived)
POST /protocols              — create manual protocol
POST /protocols/upload       — upload PDF and parse into protocol
"""
import io
import json
import logging
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/protocols", tags=["protocols"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


class ProtocolStatusPatch(BaseModel):
    status: str  # 'draft' | 'approved' | 'archived'
    approved_by: Optional[str] = None
    notes: Optional[str] = None


class ProtocolPatch(BaseModel):
    title: Optional[str] = None
    protocol_type: Optional[str] = None
    author: Optional[str] = None
    is_internal: Optional[bool] = None
    organism: Optional[str] = None
    substrate: Optional[str] = None
    vessel_type: Optional[str] = None
    scale: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list] = None
    content_markdown: Optional[str] = None
    content_json: Optional[dict] = None
    created_at: Optional[str] = None
    approved_at: Optional[str] = None
    # Versioning
    is_major: Optional[bool] = False
    change_summary: Optional[str] = None
    changed_by: Optional[str] = None  # user_id UUID string


class ProtocolCreate(BaseModel):
    protocol_type: str
    title: str
    author: Optional[str] = None
    is_internal: bool = False
    content_markdown: Optional[str] = None
    content_json: Optional[dict] = None
    organism: Optional[str] = None
    substrate: Optional[str] = None
    vessel_type: Optional[str] = None
    scale: Optional[str] = None
    source_type: str = "manual"
    notes: Optional[str] = None
    tags: Optional[list] = None
    source_paper_doi: Optional[str] = None
    source_queue_id: Optional[str] = None


@router.get("")
def list_protocols(
    protocol_type: Optional[str] = None,
    status: Optional[str] = None,
    organism: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        filters = []
        params: list = []

        if protocol_type:
            filters.append("protocol_type = %s")
            params.append(protocol_type)
        if status:
            filters.append("status = %s")
            params.append(status)
        if organism:
            filters.append("organism ILIKE %s")
            params.append(f"%{organism}%")
        if search:
            filters.append("(title ILIKE %s OR organism ILIKE %s OR substrate ILIKE %s)")
            params += [f"%{search}%", f"%{search}%", f"%{search}%"]

        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        params += [limit, offset]

        cur.execute(
            f"""
            SELECT protocol_id, protocol_type, title, version, status,
                   source_type, source_queue_id, source_paper_doi,
                   organism, substrate, vessel_type, scale,
                   author, is_internal,
                   created_at, created_by, approved_by, approved_at,
                   notes, tags
            FROM protocols
            {where}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            params,
        )
        items = [dict(r) for r in cur.fetchall()]

        # Total count
        count_params = params[:-2]
        cur.execute(f"SELECT COUNT(*) FROM protocols {where}", count_params)
        total = cur.fetchone()["count"]

        return {"items": items, "total": total}
    finally:
        conn.close()


@router.get("/{protocol_id}/revisions")
def list_protocol_revisions(protocol_id: str):
    """Return edit history for a protocol, newest first."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT pr.revision_id, pr.protocol_id, pr.revised_at,
                   pr.title, pr.protocol_type, pr.author, pr.organism,
                   pr.substrate, pr.vessel_type, pr.scale, pr.notes, pr.tags,
                   pr.content_markdown, pr.is_internal,
                   pr.version_label, pr.is_major, pr.change_summary,
                   u.full_name AS changed_by_name
            FROM protocol_revisions pr
            LEFT JOIN users u ON u.user_id = pr.changed_by
            WHERE pr.protocol_id = %s
            ORDER BY pr.revised_at DESC
            """,
            (protocol_id,),
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if d.get("revised_at"):
                d["revised_at"] = d["revised_at"].isoformat()
            rows.append(d)
        return rows
    finally:
        conn.close()


@router.get("/{protocol_id}/revisions/{revision_id}")
def get_protocol_revision(protocol_id: str, revision_id: str):
    """Fetch a single revision snapshot."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT pr.*, u.full_name AS changed_by_name
            FROM protocol_revisions pr
            LEFT JOIN users u ON u.user_id = pr.changed_by
            WHERE pr.protocol_id = %s AND pr.revision_id = %s
            """,
            (protocol_id, revision_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Revision not found")
        d = dict(row)
        if d.get("revised_at"):
            d["revised_at"] = d["revised_at"].isoformat()
        return d
    finally:
        conn.close()


@router.get("/{protocol_id}")
def get_protocol(protocol_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM protocols WHERE protocol_id = %s", (protocol_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Protocol not found")
        return dict(row)
    finally:
        conn.close()


@router.patch("/{protocol_id}/status")
def update_protocol_status(protocol_id: str, body: ProtocolStatusPatch):
    valid_statuses = ("draft", "approved", "archived")
    if body.status not in valid_statuses:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {valid_statuses}")

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        updates = ["status = %s"]
        params: list = [body.status]

        if body.status == "approved":
            updates.append("approved_at = NOW()")
            if body.approved_by:
                updates.append("approved_by = %s")
                params.append(body.approved_by)
        if body.notes is not None:
            updates.append("notes = %s")
            params.append(body.notes)

        params.append(protocol_id)
        cur.execute(
            f"UPDATE protocols SET {', '.join(updates)} WHERE protocol_id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Protocol not found")
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.patch("/{protocol_id}")
def update_protocol(protocol_id: str, body: ProtocolPatch):
    """Update editable protocol fields (title, content, metadata)."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM protocols WHERE protocol_id = %s", (protocol_id,))
        current = cur.fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Protocol not found")

        sets: list[str] = []
        params: list = []

        for field in ["title", "protocol_type", "author", "organism", "substrate", "vessel_type", "scale", "notes"]:
            val = getattr(body, field, None)
            if val is not None:
                sets.append(f"{field} = %s")
                params.append(val)

        if body.is_internal is not None:
            sets.append("is_internal = %s")
            params.append(body.is_internal)
        if body.tags is not None:
            sets.append("tags = %s")
            params.append(body.tags)
        if body.content_markdown is not None:
            sets.append("content_markdown = %s")
            params.append(body.content_markdown)
        if body.content_json is not None:
            sets.append("content_json = %s::jsonb")
            params.append(json.dumps(body.content_json))
        if body.created_at is not None:
            sets.append("created_at = %s::timestamptz")
            params.append(body.created_at)
        if body.approved_at is not None:
            sets.append("approved_at = %s::timestamptz")
            params.append(body.approved_at)

        if not sets:
            raise HTTPException(status_code=422, detail="No fields to update")

        # ── Compute new version ─────────────────────────────────────────────
        cur.execute(
            "SELECT COALESCE(version_major,1) AS vm, COALESCE(version_minor,0) AS vn FROM protocols WHERE protocol_id = %s",
            (protocol_id,),
        )
        ver_row = cur.fetchone()
        cur_major = int(ver_row["vm"] or 1)
        cur_minor = int(ver_row["vn"] or 0)

        is_major_bump = bool(body.is_major)
        if is_major_bump:
            new_major, new_minor = cur_major + 1, 0
        else:
            new_major, new_minor = cur_major, cur_minor + 1

        new_version_label = f"{new_major}.{new_minor}"
        # Store snapshot with the OLD version label before changes
        old_version_label = f"{cur_major}.{cur_minor}"

        # Snapshot current state before applying changes
        changed_by_val = body.changed_by or None
        cur.execute(
            """
            INSERT INTO protocol_revisions
                (protocol_id, title, protocol_type, author, organism,
                 substrate, vessel_type, scale, notes, tags,
                 content_markdown, is_internal,
                 version_label, is_major, change_summary, changed_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::uuid)
            """,
            (
                protocol_id,
                current["title"], current["protocol_type"], current["author"],
                current["organism"], current["substrate"], current["vessel_type"],
                current["scale"], current["notes"], current["tags"],
                current["content_markdown"], current["is_internal"],
                old_version_label, is_major_bump,
                body.change_summary, changed_by_val,
            ),
        )

        # Bump version on the protocol itself
        sets.extend(["version_major = %s", "version_minor = %s", "version = %s"])
        params.extend([new_major, new_minor, new_version_label])

        params.append(protocol_id)
        cur.execute(
            f"UPDATE protocols SET {', '.join(sets)} WHERE protocol_id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row)
    finally:
        conn.close()


_PARSE_PROMPT = """\
Extract the laboratory protocol from the PDF text below and return a single JSON object.

JSON schema (output ONLY the JSON object, nothing else):
{{
  "title": "<concise protocol title>",
  "protocol_type": "<one of: fermentation_method | medium_preparation | downstream_processing | genome_edit_sop | analytical_assay | strain_maintenance | substrate_preparation | other>",
  "organism": "<organism name or null>",
  "substrate": "<substrate / medium name or null>",
  "vessel_type": "<e.g. shake_flask, stirred_tank, or null>",
  "scale": "<e.g. lab, pilot, or null>",
  "tags": ["<keyword>", "..."],
  "content_markdown": "<full protocol as Markdown: # title, ## sections, numbered steps, tables. Preserve all quantities.>"
}}

PDF text:
---
{text}
---"""


@router.post("/upload", status_code=201)
async def upload_protocol_pdf(file: UploadFile = File(...)):
    """Parse a PDF and create a protocol entry using Claude."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are accepted")

    # ── Extract text from PDF ─────────────────────────────────────────────
    try:
        from pypdf import PdfReader
        data = await file.read()
        reader = PdfReader(io.BytesIO(data))
        pages = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages.append(t)
        pdf_text = "\n\n".join(pages).strip()
    except Exception as exc:
        logger.error("PDF extraction failed: %s", exc)
        raise HTTPException(status_code=422, detail=f"Could not read PDF: {exc}")

    if not pdf_text:
        raise HTTPException(status_code=422, detail="No extractable text found in this PDF. It may be a scanned image.")

    # Truncate to ~60k chars to stay within context limits
    if len(pdf_text) > 60_000:
        pdf_text = pdf_text[:60_000] + "\n\n[... truncated ...]"

    # ── Call Claude to parse into structured protocol ─────────────────────
    import re as _re
    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": _PARSE_PROMPT.format(text=pdf_text)}],
        )
        raw = response.content[0].text if response.content else ""
    except Exception as exc:
        logger.error("Claude API call failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Claude API call failed: {exc}")

    # Extract JSON object robustly — find outermost { ... }
    try:
        # Strip markdown fences if present
        raw = raw.strip()
        fence_match = _re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
        if fence_match:
            raw = fence_match.group(1).strip()

        # Find first { and last } to handle any preamble/postamble
        start = raw.find("{")
        end   = raw.rfind("}")
        if start == -1 or end == -1 or end <= start:
            logger.error("No JSON object found in Claude response. Raw (first 500): %s", raw[:500])
            raise HTTPException(status_code=502, detail="Claude did not return a JSON object. Response preview: " + raw[:200])
        json_str = raw[start:end + 1]
        parsed = json.loads(json_str)
    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        logger.error("JSON parse error: %s | raw fragment: %s", exc, json_str[:300] if "json_str" in dir() else raw[:300])
        raise HTTPException(status_code=502, detail=f"Could not parse Claude response as JSON: {exc}")
    except Exception as exc:
        logger.error("Unexpected parse error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Unexpected error parsing response: {exc}")

    # ── Save to protocols table ───────────────────────────────────────────
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO protocols (
                protocol_type, title, source_type,
                content_markdown, organism, substrate,
                vessel_type, scale, tags
            ) VALUES (%s,%s,'imported',%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                parsed.get("protocol_type", "other"),
                parsed.get("title", file.filename),
                parsed.get("content_markdown"),
                parsed.get("organism"),
                parsed.get("substrate"),
                parsed.get("vessel_type"),
                parsed.get("scale"),
                parsed.get("tags") or [],
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.delete("/{protocol_id}", status_code=204)
def delete_protocol(protocol_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        # Cascade-delete revisions first (no FK cascade defined), then protocol
        cur.execute("DELETE FROM protocol_revisions WHERE protocol_id = %s", (protocol_id,))
        cur.execute("DELETE FROM protocols WHERE protocol_id = %s RETURNING protocol_id", (protocol_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Protocol not found")
        conn.commit()
    finally:
        conn.close()


@router.post("", status_code=201)
def create_protocol(body: ProtocolCreate):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO protocols (
                protocol_type, title, source_type,
                author, is_internal,
                content_markdown, content_json,
                organism, substrate, vessel_type, scale,
                notes, tags,
                source_paper_doi, source_queue_id
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                body.protocol_type, body.title, body.source_type,
                body.author, body.is_internal,
                body.content_markdown, json.dumps(body.content_json) if body.content_json else None,
                body.organism, body.substrate, body.vessel_type, body.scale,
                body.notes, body.tags,
                body.source_paper_doi, body.source_queue_id,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row)
    finally:
        conn.close()
