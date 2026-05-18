"""
chemicals.py — Lab chemical & supply procurement registry endpoints.

GET    /chemicals                — list all items
POST   /chemicals                — add a new item
GET    /chemicals/{id}           — get one item
PATCH  /chemicals/{id}           — update an item
DELETE /chemicals/{id}           — soft-delete (archive) an item
PATCH  /chemicals/{id}/restore   — restore an archived item
"""
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/chemicals", tags=["chemicals"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


class ChemicalCreate(BaseModel):
    item_name: str
    cas_number: Optional[str] = None
    catalog_number: Optional[str] = None
    manufacturer: Optional[str] = None
    supplier: Optional[str] = None
    item_type: Optional[str] = None
    comments: Optional[str] = None
    grant_id: Optional[str] = None
    requested_by: Optional[str] = None
    quote_id: Optional[str] = None
    purchase_order_number: Optional[str] = None
    requisition_number: Optional[str] = None
    confirmation_number: Optional[str] = None
    tracking_number: Optional[str] = None
    invoice_number: Optional[str] = None
    status: str = "requested"
    pack_size: Optional[str] = None
    quantity: int = 1
    currency: str = "USD"
    price: Optional[float] = None
    tax: Optional[float] = None
    total: Optional[float] = None
    url: Optional[str] = None
    shipping: Optional[float] = None
    date_requested: Optional[str] = None
    date_approved: Optional[str] = None
    date_ordered: Optional[str] = None
    date_cancelled: Optional[str] = None
    date_received: Optional[str] = None
    approved_by: Optional[str] = None
    ordered_by: Optional[str] = None
    cancelled_by: Optional[str] = None
    received_by: Optional[str] = None
    approved_message: Optional[str] = None
    ordered_message: Optional[str] = None
    cancelled_message: Optional[str] = None
    received_message: Optional[str] = None


class ChemicalPatch(BaseModel):
    item_name: Optional[str] = None
    cas_number: Optional[str] = None
    catalog_number: Optional[str] = None
    manufacturer: Optional[str] = None
    supplier: Optional[str] = None
    item_type: Optional[str] = None
    comments: Optional[str] = None
    grant_id: Optional[str] = None
    requested_by: Optional[str] = None
    quote_id: Optional[str] = None
    purchase_order_number: Optional[str] = None
    requisition_number: Optional[str] = None
    confirmation_number: Optional[str] = None
    tracking_number: Optional[str] = None
    invoice_number: Optional[str] = None
    status: Optional[str] = None
    pack_size: Optional[str] = None
    quantity: Optional[int] = None
    currency: Optional[str] = None
    price: Optional[float] = None
    tax: Optional[float] = None
    total: Optional[float] = None
    url: Optional[str] = None
    shipping: Optional[float] = None
    date_requested: Optional[str] = None
    date_approved: Optional[str] = None
    date_ordered: Optional[str] = None
    date_cancelled: Optional[str] = None
    date_received: Optional[str] = None
    approved_by: Optional[str] = None
    ordered_by: Optional[str] = None
    cancelled_by: Optional[str] = None
    received_by: Optional[str] = None
    approved_message: Optional[str] = None
    ordered_message: Optional[str] = None
    cancelled_message: Optional[str] = None
    received_message: Optional[str] = None


@router.get("")
def list_chemicals(
    item_type: Optional[str] = None,
    status: Optional[str] = None,
    include_archived: bool = False,
    search: Optional[str] = Query(None),
):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        filters = []
        params: list = []
        if not include_archived:
            filters.append("COALESCE(archived, false) = false")
        if item_type:
            filters.append("item_type = %s")
            params.append(item_type)
        if status:
            filters.append("status = %s")
            params.append(status)
        if search:
            filters.append("(item_name ILIKE %s OR supplier ILIKE %s OR cas_number ILIKE %s OR catalog_number ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%", f"%{search}%"])
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        cur.execute(
            f"""
            SELECT chemical_id, item_name, cas_number, catalog_number,
                   manufacturer, supplier, item_type, comments, grant_id,
                   requested_by, quote_id, purchase_order_number, requisition_number,
                   confirmation_number, tracking_number, invoice_number,
                   status, pack_size, quantity, currency, price, tax, total,
                   url, shipping,
                   date_requested, date_approved, date_ordered,
                   date_cancelled, date_received,
                   approved_by, ordered_by, cancelled_by, received_by,
                   approved_message, ordered_message, cancelled_message, received_message,
                   archived, archived_at, created_at
            FROM lab_chemicals {where}
            ORDER BY COALESCE(archived, false), date_requested DESC NULLS LAST, item_name
            """,
            params,
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.post("", status_code=201)
def create_chemical(body: ChemicalCreate):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO lab_chemicals (
                item_name, cas_number, catalog_number, manufacturer, supplier,
                item_type, comments, grant_id, requested_by, quote_id,
                purchase_order_number, requisition_number, confirmation_number,
                tracking_number, invoice_number, status, pack_size, quantity,
                currency, price, tax, total, url, shipping,
                date_requested, date_approved, date_ordered, date_cancelled, date_received,
                approved_by, ordered_by, cancelled_by, received_by,
                approved_message, ordered_message, cancelled_message, received_message
            ) VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
            )
            RETURNING *
            """,
            (
                body.item_name, body.cas_number, body.catalog_number,
                body.manufacturer, body.supplier, body.item_type,
                body.comments, body.grant_id, body.requested_by, body.quote_id,
                body.purchase_order_number, body.requisition_number,
                body.confirmation_number, body.tracking_number, body.invoice_number,
                body.status, body.pack_size, body.quantity,
                body.currency, body.price, body.tax, body.total,
                body.url, body.shipping,
                body.date_requested, body.date_approved, body.date_ordered,
                body.date_cancelled, body.date_received,
                body.approved_by, body.ordered_by, body.cancelled_by, body.received_by,
                body.approved_message, body.ordered_message,
                body.cancelled_message, body.received_message,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.get("/{chemical_id}")
def get_chemical(chemical_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM lab_chemicals WHERE chemical_id = %s", (chemical_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Chemical not found")
        return dict(row)
    finally:
        conn.close()


@router.patch("/{chemical_id}")
def update_chemical(chemical_id: str, body: ChemicalPatch):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        fields = body.model_dump(exclude_none=True)
        if not fields:
            raise HTTPException(status_code=422, detail="No fields to update")
        updates = [f"{col} = %s" for col in fields]
        params = list(fields.values()) + [chemical_id]
        cur.execute(
            f"UPDATE lab_chemicals SET {', '.join(updates)} WHERE chemical_id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Chemical not found")
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.delete("/{chemical_id}")
def archive_chemical(chemical_id: str):
    """Soft-delete: mark item as archived."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE lab_chemicals
            SET archived = true, archived_at = NOW()
            WHERE chemical_id = %s
            RETURNING chemical_id
            """,
            (chemical_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Chemical not found")
        conn.commit()
        return {"status": "archived", "chemical_id": chemical_id}
    finally:
        conn.close()


@router.patch("/{chemical_id}/restore")
def restore_chemical(chemical_id: str):
    """Restore an archived item."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE lab_chemicals
            SET archived = false, archived_at = NULL
            WHERE chemical_id = %s
            RETURNING chemical_id
            """,
            (chemical_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Chemical not found")
        conn.commit()
        return {"status": "restored", "chemical_id": chemical_id}
    finally:
        conn.close()
