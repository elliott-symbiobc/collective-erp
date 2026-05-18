"""
crm.py — CRM pipeline endpoints.

GET    /crm/deals               — list all deals grouped by stage
GET    /crm/deals/{id}          — single deal
POST   /crm/deals               — create deal
PATCH  /crm/deals/{id}          — update deal (incl. stage move)
DELETE /crm/deals/{id}          — archive deal
"""

import logging
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/crm", tags=["crm"])

STAGES = ["New", "Qualified", "Initial Testing", "Proposition", "Won", "Inactive", "No Response"]


def _conn():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return conn


def _require_user(request: Request) -> str:
    uid = request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return uid


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/deals")
def list_deals(request: Request, stage: Optional[str] = None):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        if stage:
            cur.execute(
                "SELECT * FROM crm_deals WHERE archived=false AND stage=%s ORDER BY created_at",
                [stage],
            )
        else:
            cur.execute(
                "SELECT * FROM crm_deals WHERE archived=false ORDER BY created_at",
            )
        rows = cur.fetchall()
    finally:
        conn.close()

    deals = []
    for r in rows:
        d = dict(r)
        for k, v in d.items():
            if hasattr(v, 'isoformat'):
                d[k] = v.isoformat()
        deals.append(d)

    by_stage = {s: [] for s in STAGES}
    for d in deals:
        s = d.get("stage", "New")
        if s not in by_stage:
            by_stage[s] = []
        by_stage[s].append(d)

    return {"deals": deals, "by_stage": by_stage, "stages": STAGES}


# ── Single ────────────────────────────────────────────────────────────────────

@router.get("/deals/{deal_id}")
def get_deal(deal_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM crm_deals WHERE deal_id=%s AND archived=false", [deal_id])
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404)
    d = dict(row)
    for k, v in d.items():
        if hasattr(v, 'isoformat'):
            d[k] = v.isoformat()
    return d


# ── Create ────────────────────────────────────────────────────────────────────

class DealCreate(BaseModel):
    title: str
    company: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    stage: str = "New"
    probability: Optional[float] = None
    expected_revenue: Optional[float] = None
    description: Optional[str] = None
    deadline: Optional[str] = None


@router.post("/deals")
def create_deal(body: DealCreate, request: Request):
    uid = _require_user(request)
    if body.stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {body.stage}")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO crm_deals
                (title, company, contact_name, email, phone, stage,
                 probability, expected_revenue, description, deadline, created_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            [body.title, body.company, body.contact_name, body.email, body.phone,
             body.stage, body.probability, body.expected_revenue,
             body.description, body.deadline or None, uid],
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    d = dict(row)
    for k, v in d.items():
        if hasattr(v, 'isoformat'):
            d[k] = v.isoformat()
    return d


# ── Update ────────────────────────────────────────────────────────────────────

class DealUpdate(BaseModel):
    title: Optional[str] = None
    company: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    stage: Optional[str] = None
    probability: Optional[float] = None
    expected_revenue: Optional[float] = None
    description: Optional[str] = None
    deadline: Optional[str] = None


@router.patch("/deals/{deal_id}")
def update_deal(deal_id: str, body: DealUpdate, request: Request):
    _require_user(request)
    if body.stage and body.stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {body.stage}")

    fields, values = [], []
    for f in ["title", "company", "contact_name", "email", "phone", "stage",
              "probability", "expected_revenue", "description", "deadline"]:
        v = getattr(body, f)
        if v is not None:
            fields.append(f"{f} = %s")
            values.append(v)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    fields.append("updated_at = now()")
    values.append(deal_id)

    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE crm_deals SET {', '.join(fields)} WHERE deal_id=%s AND archived=false RETURNING *",
            values,
        )
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404)
    d = dict(row)
    for k, v in d.items():
        if hasattr(v, 'isoformat'):
            d[k] = v.isoformat()

    # Auto-create project when deal moves to Qualified
    if body.stage == "Qualified":
        try:
            create_project_from_deal(deal_id, request)
        except Exception:
            pass  # Non-blocking — don't fail the stage update

    return d


# ── Delete (archive) ──────────────────────────────────────────────────────────

@router.delete("/deals/{deal_id}")
def delete_deal(deal_id: str, request: Request):
    _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE crm_deals SET archived=true, updated_at=now() WHERE deal_id=%s",
            [deal_id],
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── Auto-create project from CRM deal ─────────────────────────────────────────

@router.post("/deals/{deal_id}/create-project")
def create_project_from_deal(deal_id: str, request: Request):
    """When a CRM deal reaches Qualified stage, auto-create a Portfolio project linked to it."""
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM crm_deals WHERE deal_id=%s AND archived=false", [deal_id])
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        deal = dict(deal)

        # Check if project already exists for this deal
        cur.execute("SELECT project_id FROM projects WHERE crm_deal_id=%s", [deal_id])
        existing = cur.fetchone()
        if existing:
            return {"project_id": str(existing[0]), "already_existed": True}

        # Resolve contact_id from deal email if available
        contact_id = None
        if deal.get("email"):
            cur.execute("SELECT contact_id FROM contacts WHERE email=%s LIMIT 1", [deal["email"]])
            c = cur.fetchone()
            if c:
                contact_id = str(c[0])

        # Create project
        cur.execute("""
            INSERT INTO projects
                (name, description, project_type, stage, status,
                 contact_id, probability, expected_revenue,
                 date_deadline, tags, crm_deal_id, assigned_to)
            VALUES (%s,%s,'portfolio','Qualified','active',%s,%s,%s,%s,%s,%s,%s)
            RETURNING project_id
        """, [
            deal.get("title") or deal.get("company") or "New Portfolio Project",
            deal.get("description"),
            contact_id,
            deal.get("probability"),
            deal.get("expected_revenue"),
            deal.get("deadline"),
            [],
            deal_id,
            uid,
        ])
        row = cur.fetchone()
        project_id = str(row[0])

        # Link contact into project_contacts if found
        if contact_id:
            cur.execute("""
                INSERT INTO project_contacts (project_id, contact_id, role, is_primary)
                VALUES (%s,%s,'primary',true)
                ON CONFLICT DO NOTHING
            """, [project_id, contact_id])

        # Find the default portfolio template and apply it
        cur.execute(
            "SELECT template_id FROM project_templates WHERE project_type='portfolio' AND is_default=true LIMIT 1"
        )
        tmpl = cur.fetchone()

        conn.commit()

        # Apply template milestones (non-blocking — errors don't fail the creation)
        if tmpl:
            try:
                import requests as _req
                _req.post(
                    f"http://localhost:8000/api/projects/{project_id}/milestones/from-template",
                    json={"template_id": str(tmpl[0]), "include_tasks": True},
                    headers={"X-User-Id": uid},
                    timeout=10,
                )
            except Exception:
                pass  # Template apply is best-effort

        return {"project_id": project_id, "already_existed": False}
    finally:
        conn.close()


# ── Auto-create when deal stage moves to Qualified ────────────────────────────

@router.post("/deals/{deal_id}/stage-qualified")
def deal_qualified_hook(deal_id: str, request: Request):
    """Move deal to Qualified and auto-create project."""
    uid = _require_user(request)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE crm_deals SET stage='Qualified', updated_at=now() WHERE deal_id=%s AND archived=false RETURNING deal_id",
            [deal_id],
        )
        row = cur.fetchone()
        conn.commit()
        if not row:
            raise HTTPException(status_code=404)
    finally:
        conn.close()
    return create_project_from_deal(deal_id, request)