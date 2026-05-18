"""
equipment.py — Lab equipment registry.

GET    /equipment          — list items
POST   /equipment          — add item
GET    /equipment/{id}     — get one
PATCH  /equipment/{id}     — update
DELETE /equipment/{id}     — soft-delete
PATCH  /equipment/{id}/restore — restore
"""
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/equipment", tags=["equipment"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


class EquipmentCreate(BaseModel):
    name: str
    model: Optional[str] = None
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    manufacturer: Optional[str] = None
    supplier: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    status: str = "operational"
    date_acquired: Optional[str] = None
    warranty_expiry: Optional[str] = None
    last_service_date: Optional[str] = None
    next_service_date: Optional[str] = None
    purchase_price: Optional[float] = None
    est_value: Optional[float] = None
    currency: str = "USD"
    condition: Optional[str] = None
    price_ref_url: Optional[str] = None
    notes: Optional[str] = None
    manual_url: Optional[str] = None


class EquipmentPatch(BaseModel):
    name: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    manufacturer: Optional[str] = None
    supplier: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    date_acquired: Optional[str] = None
    warranty_expiry: Optional[str] = None
    last_service_date: Optional[str] = None
    next_service_date: Optional[str] = None
    purchase_price: Optional[float] = None
    est_value: Optional[float] = None
    currency: Optional[str] = None
    condition: Optional[str] = None
    price_ref_url: Optional[str] = None
    notes: Optional[str] = None
    manual_url: Optional[str] = None


@router.get("/meta/categories")
def list_categories():
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM equipment_categories ORDER BY name")
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


@router.post("/meta/categories", status_code=201)
def add_category(body: dict):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name required")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO equipment_categories (name) VALUES (%s) ON CONFLICT DO NOTHING", (name,))
        conn.commit()
        return {"name": name}
    finally:
        conn.close()


@router.delete("/meta/categories/{name}")
def delete_category(name: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM equipment_categories WHERE name = %s", (name,))
        conn.commit()
        return {"deleted": name}
    finally:
        conn.close()


@router.get("/meta/statuses")
def list_statuses():
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT name, color FROM equipment_statuses ORDER BY name")
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.post("/meta/statuses", status_code=201)
def add_status(body: dict):
    name  = (body.get("name") or "").strip()
    color = (body.get("color") or "gray").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name required")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO equipment_statuses (name, color) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (name, color),
        )
        conn.commit()
        return {"name": name, "color": color}
    finally:
        conn.close()


@router.delete("/meta/statuses/{name}")
def delete_status(name: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM equipment_statuses WHERE name = %s", (name,))
        conn.commit()
        return {"deleted": name}
    finally:
        conn.close()


@router.get("")
def list_equipment(
    category: Optional[str] = None,
    status: Optional[str] = None,
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
        if status:
            filters.append("status = %s")
            params.append(status)
        if search:
            filters.append("(name ILIKE %s OR model ILIKE %s OR serial_number ILIKE %s OR manufacturer ILIKE %s)")
            params.extend([f"%{search}%"] * 4)
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        cur.execute(
            f"SELECT * FROM lab_equipment {where} ORDER BY COALESCE(archived,false), name",
            params,
        )
        rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            for k in ("date_acquired", "warranty_expiry", "last_service_date",
                      "next_service_date", "created_at", "archived_at"):
                if r.get(k): r[k] = str(r[k])
        return rows
    finally:
        conn.close()


@router.post("", status_code=201)
def create_equipment(body: EquipmentCreate):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO lab_equipment
                (name, model, serial_number, asset_tag, manufacturer, supplier,
                 category, location, status, date_acquired, warranty_expiry,
                 last_service_date, next_service_date, purchase_price,
                 est_value, currency, condition, price_ref_url, notes, manual_url)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (body.name, body.model, body.serial_number, body.asset_tag,
             body.manufacturer, body.supplier, body.category, body.location,
             body.status, body.date_acquired, body.warranty_expiry,
             body.last_service_date, body.next_service_date, body.purchase_price,
             body.est_value, body.currency, body.condition, body.price_ref_url,
             body.notes, body.manual_url),
        )
        row = dict(cur.fetchone())
        conn.commit()
        for k in ("date_acquired", "warranty_expiry", "last_service_date",
                  "next_service_date", "created_at", "archived_at"):
            if row.get(k): row[k] = str(row[k])
        return row
    finally:
        conn.close()


@router.get("/{equipment_id}")
def get_equipment(equipment_id: str):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM lab_equipment WHERE equipment_id = %s", (equipment_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Equipment not found")
        return dict(row)
    finally:
        conn.close()


@router.patch("/{equipment_id}")
def update_equipment(equipment_id: str, body: EquipmentPatch):
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        fields = body.model_dump(exclude_none=True)
        if not fields:
            raise HTTPException(status_code=422, detail="No fields to update")
        updates = [f"{col} = %s" for col in fields]
        params = list(fields.values()) + [equipment_id]
        cur.execute(
            f"UPDATE lab_equipment SET {', '.join(updates)} WHERE equipment_id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Equipment not found")
        conn.commit()
        return dict(row)
    finally:
        conn.close()


@router.delete("/{equipment_id}")
def archive_equipment(equipment_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE lab_equipment SET archived=true, archived_at=NOW() WHERE equipment_id=%s RETURNING equipment_id",
            (equipment_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Equipment not found")
        conn.commit()
        return {"status": "archived", "equipment_id": equipment_id}
    finally:
        conn.close()


@router.patch("/{equipment_id}/restore")
def restore_equipment(equipment_id: str):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE lab_equipment SET archived=false, archived_at=NULL WHERE equipment_id=%s RETURNING equipment_id",
            (equipment_id,),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Equipment not found")
        conn.commit()
        return {"status": "restored", "equipment_id": equipment_id}
    finally:
        conn.close()
