"""
cap_table.py — Carta-style cap table endpoints.

Rounds:
  GET    /cap-table/rounds                         list all rounds
  POST   /cap-table/rounds                         create round
  PATCH  /cap-table/rounds/{round_id}              update fields
  DELETE /cap-table/rounds/{round_id}              delete round

Holders:
  GET    /cap-table/holders                        list all holders
  POST   /cap-table/holders                        create holder
  PATCH  /cap-table/holders/{holder_id}            update fields
  DELETE /cap-table/holders/{holder_id}            delete holder

Securities:
  GET    /cap-table/securities                     list (optionally filtered by holder/round)
  POST   /cap-table/securities                     create security
  PATCH  /cap-table/securities/{security_id}       update fields
  DELETE /cap-table/securities/{security_id}       delete security

Documents:
  GET    /cap-table/documents                      list (optionally filtered)
  POST   /cap-table/documents                      create document
  PATCH  /cap-table/documents/{document_id}        update fields
  DELETE /cap-table/documents/{document_id}        delete document
"""

import logging
import os
import uuid
from pathlib import Path
from typing import Any, Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

UPLOAD_DIR = Path("/app/uploads/cap-table")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cap-table", tags=["cap-table"])


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _require_user(request: Request) -> str:
    uid = request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return uid


# ─────────────────────────────────────────────────────────────────────────────
# Rounds
# ─────────────────────────────────────────────────────────────────────────────

ROUND_UPDATABLE = {
    "name", "round_type", "status", "close_date", "pre_money_val",
    "amount_raised", "share_price", "new_shares_issued", "lead_investor",
    "safe_cap", "discount_pct", "interest_rate_pct", "maturity_date",
    "mfn", "pro_rata_rights", "board_seat", "notes", "sort_order",
}


class RoundCreate(BaseModel):
    name: str
    round_type: str = "safe"
    status: str = "open"
    close_date: Optional[str] = None
    pre_money_val: Optional[float] = None
    amount_raised: Optional[float] = None
    share_price: Optional[float] = None
    new_shares_issued: Optional[int] = None
    lead_investor: Optional[str] = None
    safe_cap: Optional[float] = None
    discount_pct: Optional[float] = None
    interest_rate_pct: Optional[float] = None
    maturity_date: Optional[str] = None
    mfn: bool = False
    pro_rata_rights: bool = False
    board_seat: bool = False
    notes: Optional[str] = None
    sort_order: int = 0


@router.get("/rounds")
def list_rounds(request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT r.*,
                    COUNT(DISTINCT s.security_id) AS security_count,
                    COUNT(DISTINCT d.document_id) AS document_count,
                    COALESCE(SUM(s.investment_amount), 0) AS total_invested
                FROM cap_table_rounds r
                LEFT JOIN cap_table_securities s ON s.round_id = r.round_id
                LEFT JOIN cap_table_documents  d ON d.round_id = r.round_id
                GROUP BY r.round_id
                ORDER BY r.sort_order ASC, r.close_date ASC NULLS LAST, r.created_at ASC
            """)
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


@router.post("/rounds")
def create_round(body: RoundCreate, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cap_table_rounds
                    (name, round_type, status, close_date, pre_money_val, amount_raised,
                     share_price, new_shares_issued, lead_investor, safe_cap, discount_pct,
                     interest_rate_pct, maturity_date, mfn, pro_rata_rights, board_seat,
                     notes, sort_order)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (
                body.name, body.round_type, body.status,
                body.close_date or None, body.pre_money_val, body.amount_raised,
                body.share_price, body.new_shares_issued, body.lead_investor,
                body.safe_cap, body.discount_pct, body.interest_rate_pct,
                body.maturity_date or None, body.mfn, body.pro_rata_rights, body.board_seat,
                body.notes, body.sort_order,
            ))
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.patch("/rounds/{round_id}")
def update_round(round_id: str, body: dict[str, Any], request: Request):
    _require_user(request)
    fields = {k: v for k, v in body.items() if k in ROUND_UPDATABLE}
    if not fields:
        raise HTTPException(status_code=400, detail="No updatable fields")
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            set_clause = ", ".join(f"{k} = %s" for k in fields)
            set_clause += ", updated_at = NOW()"
            cur.execute(
                f"UPDATE cap_table_rounds SET {set_clause} WHERE round_id = %s RETURNING *",
                [*fields.values(), round_id],
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Round not found")
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.delete("/rounds/{round_id}")
def delete_round(round_id: str, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cap_table_rounds WHERE round_id = %s", (round_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Round not found")
            conn.commit()
            return {"deleted": round_id}
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Holders
# ─────────────────────────────────────────────────────────────────────────────

HOLDER_UPDATABLE = {
    "name", "holder_type", "email", "entity_name", "notes", "sort_order",
}


class HolderCreate(BaseModel):
    name: str
    holder_type: str = "investor"
    email: Optional[str] = None
    entity_name: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int = 0


@router.get("/holders")
def list_holders(request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT h.*,
                    COALESCE(s.security_count, 0)  AS security_count,
                    COALESCE(d.document_count, 0)  AS document_count,
                    COALESCE(s.total_shares, 0)    AS total_shares,
                    COALESCE(s.total_invested, 0)  AS total_invested
                FROM cap_table_holders h
                LEFT JOIN (
                    SELECT holder_id,
                        COUNT(*)                    AS security_count,
                        COALESCE(SUM(shares), 0)    AS total_shares,
                        COALESCE(SUM(investment_amount), 0) AS total_invested
                    FROM cap_table_securities
                    GROUP BY holder_id
                ) s ON s.holder_id = h.holder_id
                LEFT JOIN (
                    SELECT holder_id, COUNT(*) AS document_count
                    FROM cap_table_documents
                    WHERE holder_id IS NOT NULL
                    GROUP BY holder_id
                ) d ON d.holder_id = h.holder_id
                ORDER BY
                    CASE h.holder_type
                        WHEN 'founder'     THEN 0
                        WHEN 'employee'    THEN 1
                        WHEN 'advisor'     THEN 2
                        WHEN 'investor'    THEN 3
                        WHEN 'option_pool' THEN 4
                        ELSE 5
                    END,
                    h.sort_order ASC, h.name ASC
            """)
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


@router.post("/holders")
def create_holder(body: HolderCreate, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cap_table_holders (name, holder_type, email, entity_name, notes, sort_order)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (body.name, body.holder_type, body.email, body.entity_name, body.notes, body.sort_order))
            conn.commit()
            row = dict(cur.fetchone())
            row["security_count"] = 0
            row["document_count"] = 0
            row["total_shares"] = 0
            row["total_invested"] = 0
            return row
    finally:
        conn.close()


@router.patch("/holders/{holder_id}")
def update_holder(holder_id: str, body: dict[str, Any], request: Request):
    _require_user(request)
    fields = {k: v for k, v in body.items() if k in HOLDER_UPDATABLE}
    if not fields:
        raise HTTPException(status_code=400, detail="No updatable fields")
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            set_clause = ", ".join(f"{k} = %s" for k in fields)
            set_clause += ", updated_at = NOW()"
            cur.execute(
                f"UPDATE cap_table_holders SET {set_clause} WHERE holder_id = %s RETURNING *",
                [*fields.values(), holder_id],
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Holder not found")
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.delete("/holders/{holder_id}")
def delete_holder(holder_id: str, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cap_table_holders WHERE holder_id = %s", (holder_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Holder not found")
            conn.commit()
            return {"deleted": holder_id}
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Securities
# ─────────────────────────────────────────────────────────────────────────────

SECURITY_UPDATABLE = {
    "holder_id", "round_id", "security_type", "share_class", "shares",
    "investment_amount", "price_per_share", "grant_date", "vesting_schedule",
    "cliff_months", "fully_vested_date", "safe_cap", "discount_pct", "notes",
}


class SecurityCreate(BaseModel):
    holder_id: str
    round_id: Optional[str] = None
    security_type: str = "common"
    share_class: Optional[str] = None
    shares: Optional[int] = None
    investment_amount: Optional[float] = None
    price_per_share: Optional[float] = None
    grant_date: Optional[str] = None
    vesting_schedule: Optional[str] = None
    cliff_months: Optional[int] = None
    fully_vested_date: Optional[str] = None
    safe_cap: Optional[float] = None
    discount_pct: Optional[float] = None
    notes: Optional[str] = None


@router.get("/securities")
def list_securities(
    request: Request,
    holder_id: Optional[str] = Query(None),
    round_id: Optional[str] = Query(None),
):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            filters: list[str] = []
            params: list = []
            if holder_id:
                filters.append("s.holder_id = %s")
                params.append(holder_id)
            if round_id:
                filters.append("s.round_id = %s")
                params.append(round_id)
            where = ("WHERE " + " AND ".join(filters)) if filters else ""
            cur.execute(f"""
                SELECT s.*,
                    h.name      AS holder_name,
                    h.holder_type,
                    r.name      AS round_name,
                    r.round_type
                FROM cap_table_securities s
                JOIN  cap_table_holders h ON h.holder_id = s.holder_id
                LEFT JOIN cap_table_rounds  r ON r.round_id  = s.round_id
                {where}
                ORDER BY h.name ASC, s.created_at ASC
            """, params)
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


@router.post("/securities")
def create_security(body: SecurityCreate, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cap_table_securities
                    (holder_id, round_id, security_type, share_class, shares, investment_amount,
                     price_per_share, grant_date, vesting_schedule, cliff_months, fully_vested_date,
                     safe_cap, discount_pct, notes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (
                body.holder_id, body.round_id or None, body.security_type, body.share_class,
                body.shares, body.investment_amount, body.price_per_share,
                body.grant_date or None, body.vesting_schedule, body.cliff_months,
                body.fully_vested_date or None, body.safe_cap, body.discount_pct, body.notes,
            ))
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.patch("/securities/{security_id}")
def update_security(security_id: str, body: dict[str, Any], request: Request):
    _require_user(request)
    fields = {k: v for k, v in body.items() if k in SECURITY_UPDATABLE}
    if not fields:
        raise HTTPException(status_code=400, detail="No updatable fields")
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            set_clause = ", ".join(f"{k} = %s" for k in fields)
            set_clause += ", updated_at = NOW()"
            cur.execute(
                f"UPDATE cap_table_securities SET {set_clause} WHERE security_id = %s RETURNING *",
                [*fields.values(), security_id],
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Security not found")
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.delete("/securities/{security_id}")
def delete_security(security_id: str, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cap_table_securities WHERE security_id = %s", (security_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Security not found")
            conn.commit()
            return {"deleted": security_id}
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Documents
# ─────────────────────────────────────────────────────────────────────────────

DOCUMENT_UPDATABLE = {
    "holder_id", "round_id", "doc_type", "name", "url",
    "drive_file_id", "signed_date", "notes", "stored_name", "mime_type", "file_size",
}


class DocumentCreate(BaseModel):
    holder_id: Optional[str] = None
    round_id: Optional[str] = None
    doc_type: str = "safe"
    name: str
    url: Optional[str] = None
    drive_file_id: Optional[str] = None
    signed_date: Optional[str] = None
    notes: Optional[str] = None


@router.get("/documents")
def list_documents(
    request: Request,
    holder_id: Optional[str] = Query(None),
    round_id: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            filters: list[str] = []
            params: list = []
            if holder_id:
                filters.append("d.holder_id = %s")
                params.append(holder_id)
            if round_id:
                filters.append("d.round_id = %s")
                params.append(round_id)
            if doc_type:
                filters.append("d.doc_type = %s")
                params.append(doc_type)
            where = ("WHERE " + " AND ".join(filters)) if filters else ""
            cur.execute(f"""
                SELECT d.*,
                    h.name AS holder_name,
                    r.name AS round_name
                FROM cap_table_documents d
                LEFT JOIN cap_table_holders h ON h.holder_id = d.holder_id
                LEFT JOIN cap_table_rounds  r ON r.round_id  = d.round_id
                {where}
                ORDER BY d.signed_date DESC NULLS LAST, d.created_at DESC
            """, params)
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


@router.post("/documents/{document_id}/upload")
async def upload_document_file(document_id: str, request: Request, file: UploadFile = File(...)):
    _require_user(request)
    ext = Path(file.filename or "").suffix.lower()
    stored_name = f"{uuid.uuid4()}{ext}"
    dest = UPLOAD_DIR / stored_name
    content = await file.read()
    dest.write_bytes(content)

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """UPDATE cap_table_documents
                   SET stored_name = %s, mime_type = %s, file_size = %s
                   WHERE document_id = %s RETURNING *""",
                [stored_name, file.content_type, len(content), document_id],
            )
            if cur.rowcount == 0:
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=404, detail="Document not found")
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.get("/documents/{document_id}/file")
def download_document_file(document_id: str, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT stored_name, mime_type, name FROM cap_table_documents WHERE document_id = %s",
                [document_id],
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row or not row["stored_name"]:
        raise HTTPException(status_code=404, detail="No file attached")

    path = UPLOAD_DIR / row["stored_name"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(path),
        media_type=row["mime_type"] or "application/octet-stream",
        filename=row["name"] + Path(row["stored_name"]).suffix,
    )


@router.post("/documents")
def create_document(body: DocumentCreate, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cap_table_documents
                    (holder_id, round_id, doc_type, name, url, drive_file_id, signed_date, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                body.holder_id or None, body.round_id or None, body.doc_type,
                body.name, body.url, body.drive_file_id,
                body.signed_date or None, body.notes,
            ))
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.patch("/documents/{document_id}")
def update_document(document_id: str, body: dict[str, Any], request: Request):
    _require_user(request)
    fields = {k: v for k, v in body.items() if k in DOCUMENT_UPDATABLE}
    if not fields:
        raise HTTPException(status_code=400, detail="No updatable fields")
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            set_clause = ", ".join(f"{k} = %s" for k in fields)
            cur.execute(
                f"UPDATE cap_table_documents SET {set_clause} WHERE document_id = %s RETURNING *",
                [*fields.values(), document_id],
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Document not found")
            conn.commit()
            return dict(cur.fetchone())
    finally:
        conn.close()


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, request: Request):
    _require_user(request)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cap_table_documents WHERE document_id = %s", (document_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Document not found")
            conn.commit()
            return {"deleted": document_id}
    finally:
        conn.close()
