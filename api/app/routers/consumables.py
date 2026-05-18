"""
consumables.py — Lab consumables inventory.

GET    /consumables          — list items
POST   /consumables          — add item
GET    /consumables/{id}     — get one
PATCH  /consumables/{id}     — update
DELETE /consumables/{id}     — soft-delete
PATCH  /consumables/{id}/restore — restore
"""
import base64
import logging
import os
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from typing import Optional

import httpx
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def _send_low_stock_email(user_id: str, item: dict) -> None:
    """Send a 'Buy Again' notification email for a low-stock consumable."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT email FROM users WHERE user_id = %s", (user_id,))
        user = cur.fetchone()
        if not user:
            return
        cur.execute(
            "SELECT access_token, refresh_token, token_expiry FROM google_oauth_tokens WHERE user_id = %s",
            (user_id,),
        )
        token_row = cur.fetchone()
        if not token_row:
            return
    finally:
        conn.close()

    expiry = token_row["token_expiry"]
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    access_token = token_row["access_token"]
    if datetime.now(timezone.utc) >= expiry - timedelta(minutes=2):
        r = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
                "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
                "refresh_token": token_row["refresh_token"],
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        if r.status_code == 200:
            access_token = r.json().get("access_token", access_token)

    name = item.get("name", "Unknown item")
    qty = item.get("stock_quantity", 0)
    unit = item.get("unit", "each")
    reorder = item.get("reorder_level")
    catalog = item.get("catalog_number") or ""
    supplier = item.get("supplier") or ""
    url = item.get("url") or ""

    lines = [
        f"Low stock alert — {name} needs to be reordered.",
        "",
        f"Current stock: {qty} {unit}",
        f"Reorder level: {reorder} {unit}",
    ]
    if catalog:
        lines.append(f"Catalog #: {catalog}")
    if supplier:
        lines.append(f"Supplier: {supplier}")
    if url:
        lines.append(f"Order link: {url}")

    msg = MIMEText("\n".join(lines), "plain", "utf-8")
    msg["To"] = user["email"]
    msg["Subject"] = f"Buy Again: {name} is running low"
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    try:
        resp = httpx.post(
            f"{GMAIL_BASE}/messages/send",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json={"raw": raw},
            timeout=20,
        )
        if resp.status_code not in (200, 201):
            logger.warning("Low-stock email send failed: %s", resp.text)
    except Exception as exc:
        logger.warning("Low-stock email exception: %s", exc)

router = APIRouter(prefix="/consumables", tags=["consumables"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


class ConsumableCreate(BaseModel):
    name: str
    catalog_number: Optional[str] = None
    manufacturer: Optional[str] = None
    supplier: Optional[str] = None
    category: Optional[str] = None
    stock_quantity: float = 0
    unit: str = "each"
    reorder_level: Optional[float] = None
    location: Optional[str] = None
    expiry_date: Optional[str] = None
    price_per_unit: Optional[float] = None
    currency: str = "USD"
    url: Optional[str] = None
    notes: Optional[str] = None


class ConsumablePatch(BaseModel):
    name: Optional[str] = None
    catalog_number: Optional[str] = None
    manufacturer: Optional[str] = None
    supplier: Optional[str] = None
    category: Optional[str] = None
    stock_quantity: Optional[float] = None
    unit: Optional[str] = None
    reorder_level: Optional[float] = None
    location: Optional[str] = None
    expiry_date: Optional[str] = None
    price_per_unit: Optional[float] = None
    currency: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
def list_consumables(
    category: Optional[str] = None,
    include_archived: bool = False,
    search: Optional[str] = Query(None),
):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        filters, params = [], []
        if not include_archived:
            filters.append("COALESCE(archived, false) = false")
        if category:
            filters.append("category = %s")
            params.append(category)
        if search:
            filters.append("(name ILIKE %s OR catalog_number ILIKE %s OR supplier ILIKE %s OR manufacturer ILIKE %s)")
            params.extend([f"%{search}%"] * 4)
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        cur.execute(
            f"SELECT * FROM lab_consumables {where} ORDER BY COALESCE(archived,false), name",
            params,
        )
        rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            for k in ("expiry_date", "created_at", "archived_at"):
                if r.get(k): r[k] = str(r[k])
        return rows
    finally:
        conn.close()


@router.post("", status_code=201)
def create_consumable(body: ConsumableCreate):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO lab_consumables
                (name, catalog_number, manufacturer, supplier, category,
                 stock_quantity, unit, reorder_level, location, expiry_date,
                 price_per_unit, currency, url, notes)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (body.name, body.catalog_number, body.manufacturer, body.supplier,
             body.category, body.stock_quantity, body.unit, body.reorder_level,
             body.location, body.expiry_date, body.price_per_unit, body.currency,
             body.url, body.notes),
        )
        row = dict(cur.fetchone())
        conn.commit()
        for k in ("expiry_date", "created_at", "archived_at"):
            if row.get(k): row[k] = str(row[k])
        return row
    finally:
        conn.close()


@router.get("/{consumable_id}")
def get_consumable(consumable_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM lab_consumables WHERE consumable_id = %s", (consumable_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Consumable not found")
        return dict(row)
    finally:
        conn.close()


@router.patch("/{consumable_id}")
def update_consumable(consumable_id: str, body: ConsumablePatch, request: Request):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        fields = body.model_dump(exclude_none=True)
        if not fields:
            raise HTTPException(status_code=422, detail="No fields to update")
        updates = [f"{col} = %s" for col in fields]
        params = list(fields.values()) + [consumable_id]
        cur.execute(
            f"UPDATE lab_consumables SET {', '.join(updates)} WHERE consumable_id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Consumable not found")
        conn.commit()
        result = dict(row)
        # Trigger buy-again email if stock just hit or dropped below reorder level
        if (
            "stock_quantity" in fields
            and result.get("reorder_level") is not None
            and result.get("stock_quantity") is not None
            and result["stock_quantity"] <= result["reorder_level"]
        ):
            user_id = request.headers.get("X-User-Id")
            if user_id:
                try:
                    _send_low_stock_email(user_id, result)
                except Exception as exc:
                    logger.warning("Could not send low-stock email: %s", exc)
        return result
    finally:
        conn.close()


@router.delete("/{consumable_id}")
def archive_consumable(consumable_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE lab_consumables SET archived=true, archived_at=NOW() WHERE consumable_id=%s RETURNING consumable_id",
            (consumable_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Consumable not found")
        conn.commit()
        return {"status": "archived", "consumable_id": consumable_id}
    finally:
        conn.close()


@router.patch("/{consumable_id}/restore")
def restore_consumable(consumable_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE lab_consumables SET archived=false, archived_at=NULL WHERE consumable_id=%s RETURNING consumable_id",
            (consumable_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Consumable not found")
        conn.commit()
        return {"status": "restored", "consumable_id": consumable_id}
    finally:
        conn.close()
