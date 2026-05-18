"""
jobs.py — Manual job trigger endpoints.

POST /jobs/literature-sweep
POST /jobs/compound-scan
POST /jobs/regulatory-scan
POST /jobs/retrain
POST /jobs/annotate/{strain_id}
POST /jobs/tea/{substrate_id}
POST /jobs/eu-refresh
GET  /jobs/status
"""
import os
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


class CompoundScanBody(BaseModel):
    strain_id: Optional[str] = None


class RegulatoryScanBody(BaseModel):
    opportunity_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Trigger endpoints
# ---------------------------------------------------------------------------

@router.post("/literature-sweep")
def trigger_literature_sweep():
    """Queue a literature sweep task."""
    from app.worker import celery_app
    task = celery_app.send_task("app.worker.run_agent_task")
    return {
        "status": "queued",
        "task_id": task.id,
        "message": "Literature sweep started. Check queue in 2-5 minutes.",
    }


@router.post("/compound-scan")
def trigger_compound_scan(body: CompoundScanBody = CompoundScanBody()):
    """Queue compound discovery scan for one or all annotated strains."""
    from app.worker import celery_app
    if body.strain_id:
        task = celery_app.send_task(
            "app.worker.run_strain_discovery_task",
            args=[body.strain_id],
        )
        return {"status": "queued", "strains_queued": 1, "task_id": task.id}

    # All strains that have cazyme features
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT s.strain_id FROM strains s
            JOIN strain_cazyme_features cf ON cf.strain_id = s.strain_id
            WHERE (s.archived IS NULL OR s.archived = false)
            """
        )
        strain_ids = [str(r[0]) for r in cur.fetchall()]
    finally:
        conn.close()

    for sid in strain_ids:
        celery_app.send_task("app.worker.run_strain_discovery_task", args=[sid])

    return {"status": "queued", "strains_queued": len(strain_ids)}


@router.post("/regulatory-scan")
def trigger_regulatory_scan(body: RegulatoryScanBody = RegulatoryScanBody()):
    """Queue regulatory analysis for one or all approved opportunities without regulatory data."""
    from app.worker import celery_app
    if body.opportunity_id:
        task = celery_app.send_task(
            "app.worker.on_opportunity_approved_task",
            args=[body.opportunity_id],
        )
        return {"status": "queued", "opportunities_queued": 1, "task_id": task.id}

    # All approved opportunities without regulatory data
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT o.opportunity_id FROM strain_compound_opportunities o
            LEFT JOIN compound_regulatory_status r ON r.opportunity_id = o.opportunity_id
            WHERE o.review_status = 'approved' AND r.opportunity_id IS NULL
            """
        )
        opp_ids = [str(r[0]) for r in cur.fetchall()]
    finally:
        conn.close()

    for oid in opp_ids:
        celery_app.send_task("app.worker.on_opportunity_approved_task", args=[oid])

    return {"status": "queued", "opportunities_queued": len(opp_ids)}


@router.post("/retrain")
def trigger_retrain():
    """Force model retrain bypassing the min_rows threshold."""
    from app.worker import celery_app
    task = celery_app.send_task(
        "app.worker.run_retrain_task",
        kwargs={"min_rows": 0},
    )
    return {
        "status": "queued",
        "task_id": task.id,
        "message": "Retraining will run immediately. Check model page for results.",
    }


@router.post("/annotate/{strain_id}")
def trigger_annotation(strain_id: str):
    """Queue CAZyme annotation for a specific strain."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT ncbi_accession FROM strains WHERE strain_id = %s", (strain_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Strain not found")
        accession = row[0]
        if not accession:
            raise HTTPException(status_code=422, detail="Strain has no NCBI accession set")
    finally:
        conn.close()

    from app.worker import celery_app
    task = celery_app.send_task(
        "app.worker.run_strain_annotation_task",
        args=[strain_id, accession],
    )
    return {
        "status": "queued",
        "strain_id": strain_id,
        "task_id": task.id,
        "message": "Annotation pipeline started. Takes 15-30 minutes. Check strain page for results.",
    }


@router.post("/tea/{substrate_id}")
def trigger_tea(substrate_id: str):
    """Re-run TEA for a substrate."""
    from app.worker import celery_app
    task = celery_app.send_task(
        "app.worker.run_tea_task",
        args=[substrate_id],
    )
    return {"status": "queued", "substrate_id": substrate_id, "task_id": task.id}


@router.post("/eu-refresh")
def trigger_eu_refresh():
    """Refresh EU Novel Food catalogue."""
    from app.worker import celery_app
    task = celery_app.send_task("app.worker.run_eu_catalogue_refresh")
    return {
        "status": "queued",
        "task_id": task.id,
        "message": "EU Novel Food catalogue refresh started.",
    }


# ---------------------------------------------------------------------------
# Status endpoint
# ---------------------------------------------------------------------------

@router.get("/status")
def get_job_status():
    """Return active Celery tasks and last-run timestamps."""
    from app.worker import celery_app

    # Inspect active/scheduled tasks
    try:
        inspect = celery_app.control.inspect(timeout=2)
        active_raw = inspect.active() or {}
        reserved_raw = inspect.reserved() or {}

        active_tasks = []
        for worker, tasks in active_raw.items():
            for t in tasks:
                active_tasks.append({
                    "task_id": t.get("id"),
                    "name": t.get("name"),
                    "args": t.get("args"),
                    "worker": worker,
                })

        scheduled_tasks = []
        for worker, tasks in reserved_raw.items():
            for t in tasks:
                scheduled_tasks.append({
                    "task_id": t.get("id"),
                    "name": t.get("name"),
                    "worker": worker,
                })
    except Exception:
        active_tasks = []
        scheduled_tasks = []

    # Last-run timestamps from DB
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Last retrain
        cur.execute("SELECT MAX(trained_at) AS ts FROM model_training_log")
        row = cur.fetchone()
        last_retrain = str(row["ts"]) if row and row["ts"] else None

        # Last annotation (most recent cazyme features row)
        cur.execute(
            "SELECT MAX(created_at) AS ts FROM strain_cazyme_features"
        )
        row = cur.fetchone()
        last_annotation = str(row["ts"]) if row and row["ts"] else None

        # Unannotated strains count
        cur.execute(
            """
            SELECT COUNT(*) AS cnt FROM strains s
            WHERE (s.archived IS NULL OR s.archived = false)
            AND s.ncbi_accession IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM strain_cazyme_features cf WHERE cf.strain_id = s.strain_id
            )
            """
        )
        row = cur.fetchone()
        unannotated_count = int(row["cnt"]) if row else 0

        # Current run count for training warning
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM fermentation_runs WHERE off_target_flag = FALSE"
        )
        row = cur.fetchone()
        n_runs = int(row["cnt"]) if row else 0

    finally:
        conn.close()

    return {
        "active_tasks": active_tasks,
        "scheduled_tasks": scheduled_tasks,
        "last_retrain": last_retrain,
        "last_annotation": last_annotation,
        "last_lit_sweep": None,       # no persistent timestamp yet
        "last_compound_scan": None,
        "unannotated_strains": unannotated_count,
        "n_training_runs": n_runs,
    }
