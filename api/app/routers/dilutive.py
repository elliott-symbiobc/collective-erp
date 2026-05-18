"""
dilutive.py — Dilutive (investor) funding tracker endpoints.

GET    /dilutive                     — list all investors (filterable)
POST   /dilutive                     — create investor record
PATCH  /dilutive/{investor_id}       — update fields
DELETE /dilutive/{investor_id}       — delete record
"""

import logging
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dilutive", tags=["dilutive"])

UPDATABLE = {
    "status", "name", "role", "firm", "firm_type", "intro_type",
    "intro_notes", "email", "notes", "office_phone", "cell_phone",
    "tags", "funding_type", "avg_check_size", "source_link",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_investors(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            filters: list[str] = []
            params: list = []

            if search:
                filters.append(
                    "(name ILIKE %s OR firm ILIKE %s OR notes ILIKE %s OR intro_notes ILIKE %s)"
                )
                s = f"%{search}%"
                params.extend([s, s, s, s])
            if status:
                statuses = [s.strip() for s in status.split(",") if s.strip()]
                filters.append("status = ANY(%s)")
                params.append(statuses)

            where = ("WHERE " + " AND ".join(filters)) if filters else ""

            cur.execute(f"""
                SELECT
                    investor_id, status, name, role, firm, firm_type,
                    intro_type, intro_notes, email, notes,
                    office_phone, cell_phone, tags, funding_type,
                    avg_check_size, source_link, created_at, updated_at
                FROM dilutive_investors
                {where}
                ORDER BY
                    CASE status
                        WHEN 'Need to Follow Up' THEN 0
                        WHEN 'In Progress'        THEN 1
                        WHEN 'Not Started'        THEN 2
                        WHEN 'Committed'          THEN 3
                        WHEN 'Passed'             THEN 4
                        ELSE 5
                    END,
                    firm ASC NULLS LAST,
                    name ASC NULLS LAST
            """, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_investor(body: dict):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO dilutive_investors
                    (status, name, role, firm, firm_type, intro_type,
                     intro_notes, email, notes, office_phone, cell_phone,
                     tags, funding_type, avg_check_size, source_link)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING investor_id
            """, (
                body.get("status", "Not Started"),
                body.get("name") or None,
                body.get("role") or None,
                body.get("firm") or None,
                body.get("firm_type") or None,
                body.get("intro_type") or None,
                body.get("intro_notes") or None,
                body.get("email") or None,
                body.get("notes") or None,
                body.get("office_phone") or None,
                body.get("cell_phone") or None,
                body.get("tags", []),
                body.get("funding_type") or None,
                body.get("avg_check_size") or None,
                body.get("source_link") or None,
            ))
            row = cur.fetchone()
            conn.commit()
            return {"investor_id": str(row["investor_id"])}
    finally:
        conn.close()


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch("/{investor_id}")
def update_investor(investor_id: str, body: dict):
    updates = {k: v for k, v in body.items() if k in UPDATABLE}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [investor_id]

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dilutive_investors SET {set_clause}, updated_at = NOW() WHERE investor_id = %s",
                values,
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Investor not found")
            conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{investor_id}", status_code=204)
def delete_investor(investor_id: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM dilutive_investors WHERE investor_id = %s",
                (investor_id,),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Investor not found")
            conn.commit()
    finally:
        conn.close()
