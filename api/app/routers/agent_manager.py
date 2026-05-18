"""
Agent Manager router — admin-only.

Endpoints:
  GET    /agent-manager/agents              List all agents (registry + DB overrides)
  PATCH  /agent-manager/agents/{agent_id}  Save config override to DB
  DELETE /agent-manager/agents/{agent_id}/override  Reset agent to code defaults
  GET    /agent-manager/jobs               List all Celery Beat jobs + DB overrides
  PATCH  /agent-manager/jobs/{job_name}    Update job enabled/schedule
  POST   /agent-manager/jobs/{job_name}/trigger  Run job immediately
  GET    /agent-manager/usage              Recent api_usage_log rows
  GET    /agent-manager/usage/summary      Aggregated cost by operation/model
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.routers.auth import require_admin
from app.core.agent_config import AGENT_REGISTRY, _ensure_tables, get_agent_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent-manager", tags=["agent-manager"])

# Celery beat schedule (canonical list — must stay in sync with worker.py)
BEAT_SCHEDULE: dict[str, dict] = {
    "nightly-retrain": {
        "task": "app.worker.run_retrain_task",
        "description": "Nightly XGBoost + MAPIE model retrain",
        "module": "ML Model",
        "cron_hour": "2", "cron_minute": "0", "cron_day_of_week": "*",
    },
    "weekly-literature-agent": {
        "task": "app.worker.run_agent_task",
        "description": "Weekly literature pipeline — PubMed/PMC/OpenAlex fetch + extraction",
        "module": "Literature",
        "cron_hour": "3", "cron_minute": "0", "cron_day_of_week": "1",
    },
    "weekly-eu-catalogue-refresh": {
        "task": "app.worker.run_eu_catalogue_refresh",
        "description": "Weekly EU Novel Food catalogue refresh",
        "module": "Regulatory",
        "cron_hour": "4", "cron_minute": "0", "cron_day_of_week": "1",
    },
    "daily-plaid-sync": {
        "task": "app.worker.sync_plaid_actuals",
        "description": "Daily Plaid bank data sync for FP&A actuals",
        "module": "FP&A",
        "cron_hour": "7", "cron_minute": "0", "cron_day_of_week": "*",
    },
    "daily-qbo-sync": {
        "task": "app.worker.sync_qbo_actuals",
        "description": "Daily QuickBooks Online P&L sync for projected vs actual",
        "module": "FP&A",
        "cron_hour": "7", "cron_minute": "15", "cron_day_of_week": "*",
    },
    "contacts-gmail-sync": {
        "task": "app.worker.sync_gmail_contacts_all_users",
        "description": "Full Gmail contact interaction sync (all users)",
        "module": "Contacts",
        "cron_hour": "3", "cron_minute": "0", "cron_day_of_week": "*",
    },
    "contacts-gmail-incremental": {
        "task": "app.worker.sync_gmail_incremental_all_users",
        "description": "Incremental Gmail sync via History API (all users, hourly)",
        "module": "Contacts",
        "cron_hour": "*", "cron_minute": "0", "cron_day_of_week": "*",
    },
    "contacts-calendar-sync": {
        "task": "app.worker.sync_calendar_contacts_all_users",
        "description": "Hourly Google Calendar contact sync (all users)",
        "module": "Contacts",
        "cron_hour": "*", "cron_minute": "30", "cron_day_of_week": "*",
    },
    "contacts-summaries": {
        "task": "app.worker.refresh_contact_summaries_task",
        "description": "Nightly AI relationship summary refresh for contacts",
        "module": "Contacts",
        "cron_hour": "1", "cron_minute": "0", "cron_day_of_week": "*",
    },
    "contacts-relationship-inference": {
        "task": "app.worker.infer_relationships_task",
        "description": "Nightly contact relationship inference from email co-occurrence",
        "module": "Contacts",
        "cron_hour": "2", "cron_minute": "30", "cron_day_of_week": "*",
    },
    "task-due-reminders": {
        "task": "app.worker.send_task_due_reminders",
        "description": "Daily overdue task reminder notifications",
        "module": "Tasks",
        "cron_hour": "8", "cron_minute": "30", "cron_day_of_week": "*",
    },
    "planner-daily": {
        "task": "app.worker.generate_daily_plans_all_users",
        "description": "06:00 CST daily AI plan generation for all users",
        "module": "Planner",
        "cron_hour": "12", "cron_minute": "0", "cron_day_of_week": "*",
    },
    "planner-weekly": {
        "task": "app.worker.generate_weekly_plans_all_users",
        "description": "06:00 CST Monday weekly AI plan generation for all users",
        "module": "Planner",
        "cron_hour": "12", "cron_minute": "0", "cron_day_of_week": "1",
    },
    "planner-rollover": {
        "task": "app.worker.rollover_incomplete_blocks",
        "description": "17:30 CST daily — mark unfinished draft blocks as skipped",
        "module": "Planner",
        "cron_hour": "23", "cron_minute": "30", "cron_day_of_week": "*",
    },
}


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _cron_display(hour: str, minute: str, dow: str) -> str:
    """Return a human-readable cron description."""
    if hour == "*" and minute == "0":
        return "Every hour at :00"
    if hour == "*" and minute == "30":
        return "Every hour at :30"
    days = {"1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat", "0": "Sun"}
    day_label = f"on {days.get(dow, 'day ' + dow)}" if dow != "*" else "daily"
    return f"{day_label} at {hour.zfill(2)}:{minute.zfill(2)} UTC"


# ── Agent endpoints ───────────────────────────────────────────────────────────

@router.get("/agents")
def list_agents(request: Request):
    require_admin(request)
    _ensure_tables()
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT agent_id, model, max_tokens, temperature, top_p, top_k, "
            "system_prompt_override, notes, updated_at "
            "FROM agent_config_overrides"
        )
        overrides = {row["agent_id"]: dict(row) for row in cur.fetchall()}
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("list_agents: DB read failed: %s", exc)
        overrides = {}

    result = []
    for agent_id, defaults in AGENT_REGISTRY.items():
        ov = overrides.get(agent_id, {})
        entry = {
            "agent_id": agent_id,
            "display_name": defaults["display_name"],
            "description": defaults["description"],
            "module": defaults["module"],
            "pages": defaults["pages"],
            "file": defaults["file"],
            "wired": defaults.get("wired", False),
            # static metadata
            "context_sources": defaults.get("context_sources", []),
            "tools": defaults.get("tools", []),
            "default_system_prompt": defaults.get("default_system_prompt", ""),
            # effective values
            "model": ov.get("model") or defaults["model"],
            "max_tokens": ov.get("max_tokens") or defaults["max_tokens"],
            "temperature": ov.get("temperature") if ov.get("temperature") is not None else defaults.get("temperature"),
            "top_p": ov.get("top_p") if ov.get("top_p") is not None else defaults.get("top_p"),
            "top_k": ov.get("top_k") if ov.get("top_k") is not None else defaults.get("top_k"),
            "system_prompt_override": ov.get("system_prompt_override"),
            "notes": ov.get("notes"),
            # defaults (for reset reference)
            "default_model": defaults["model"],
            "default_max_tokens": defaults["max_tokens"],
            "default_temperature": defaults.get("temperature"),
            "default_top_p": defaults.get("top_p"),
            "default_top_k": defaults.get("top_k"),
            # whether any override exists
            "has_override": bool(ov),
            "updated_at": str(ov["updated_at"]) if ov.get("updated_at") else None,
        }
        result.append(entry)

    return sorted(result, key=lambda x: (x["module"], x["display_name"]))


class AgentOverride(BaseModel):
    model: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    system_prompt_override: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/agents/{agent_id}")
def update_agent(agent_id: str, body: AgentOverride, request: Request):
    require_admin(request)
    if agent_id not in AGENT_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_id}")
    _ensure_tables()
    try:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO agent_config_overrides
                (agent_id, model, max_tokens, temperature, top_p, top_k,
                 system_prompt_override, notes, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (agent_id) DO UPDATE SET
                model                  = EXCLUDED.model,
                max_tokens             = EXCLUDED.max_tokens,
                temperature            = EXCLUDED.temperature,
                top_p                  = EXCLUDED.top_p,
                top_k                  = EXCLUDED.top_k,
                system_prompt_override = EXCLUDED.system_prompt_override,
                notes                  = EXCLUDED.notes,
                updated_at             = now()
            """,
            (
                agent_id,
                body.model or None,
                body.max_tokens or None,
                body.temperature,
                body.top_p,
                body.top_k,
                body.system_prompt_override or None,
                body.notes or None,
            ),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        logger.exception("update_agent failed for %s", agent_id)
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "ok", "agent_id": agent_id}


@router.get("/agents/{agent_id}/effective-prompt")
def get_effective_prompt(agent_id: str):
    """Return the base prompt, any stored override, and the effective (resolved) prompt."""
    cfg = get_agent_config(agent_id)
    base_prompt: str | None = None

    # Load the actual runtime prompt from the agent module for known agents
    _PROMPT_ATTRS = {
        "paper_extraction": ("app.agents.extraction_agent", "EXTRACTION_PROMPT"),
        "paper_summarizer": ("app.agents.paper_summary_agent", "SUMMARY_PROMPT"),
        "tea_agent":        ("app.agents.tea_agent", None),
        "literature_agent": ("app.agents.literature_agent", None),
    }
    if agent_id in _PROMPT_ATTRS:
        mod_path, attr = _PROMPT_ATTRS[agent_id]
        try:
            import importlib
            mod = importlib.import_module(mod_path)
            if attr:
                base_prompt = getattr(mod, attr, None)
        except Exception:
            pass

    if base_prompt is None:
        base_prompt = cfg.get("default_system_prompt")

    override = cfg.get("system_prompt_override")
    return {
        "agent_id": agent_id,
        "display_name": AGENT_REGISTRY.get(agent_id, {}).get("display_name", agent_id),
        "model": cfg.get("model"),
        "max_tokens": cfg.get("max_tokens"),
        "temperature": cfg.get("temperature"),
        "top_p": cfg.get("top_p"),
        "top_k": cfg.get("top_k"),
        "base_prompt": base_prompt,
        "override": override,
        "effective_prompt": override or base_prompt,
        "override_active": override is not None,
    }


@router.delete("/agents/{agent_id}/override")
def reset_agent(agent_id: str, request: Request):
    require_admin(request)
    _ensure_tables()
    try:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM agent_config_overrides WHERE agent_id = %s", (agent_id,))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "reset", "agent_id": agent_id}


# ── Job endpoints ─────────────────────────────────────────────────────────────

@router.get("/jobs")
def list_jobs(request: Request):
    require_admin(request)
    _ensure_tables()
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT job_name, enabled, cron_minute, cron_hour, cron_day_of_week, notes, updated_at "
            "FROM celery_job_overrides"
        )
        overrides = {row["job_name"]: dict(row) for row in cur.fetchall()}
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("list_jobs: DB read failed: %s", exc)
        overrides = {}

    result = []
    for job_name, defaults in BEAT_SCHEDULE.items():
        ov = overrides.get(job_name, {})
        eff_hour = ov.get("cron_hour") or defaults["cron_hour"]
        eff_min = ov.get("cron_minute") or defaults["cron_minute"]
        eff_dow = ov.get("cron_day_of_week") or defaults["cron_day_of_week"]
        entry = {
            "job_name": job_name,
            "task": defaults["task"],
            "description": defaults["description"],
            "module": defaults["module"],
            "enabled": ov["enabled"] if "enabled" in ov else True,
            "cron_hour": eff_hour,
            "cron_minute": eff_min,
            "cron_day_of_week": eff_dow,
            "schedule_display": _cron_display(eff_hour, eff_min, eff_dow),
            "default_cron_hour": defaults["cron_hour"],
            "default_cron_minute": defaults["cron_minute"],
            "default_cron_day_of_week": defaults["cron_day_of_week"],
            "notes": ov.get("notes"),
            "has_override": bool(ov),
            "updated_at": str(ov["updated_at"]) if ov.get("updated_at") else None,
        }
        result.append(entry)

    return sorted(result, key=lambda x: (x["module"], x["job_name"]))


class JobOverride(BaseModel):
    enabled: Optional[bool] = None
    cron_hour: Optional[str] = None
    cron_minute: Optional[str] = None
    cron_day_of_week: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/jobs/{job_name}")
def update_job(job_name: str, body: JobOverride, request: Request):
    require_admin(request)
    if job_name not in BEAT_SCHEDULE:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_name}")
    _ensure_tables()
    try:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO celery_job_overrides
                (job_name, enabled, cron_minute, cron_hour, cron_day_of_week, notes, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (job_name) DO UPDATE SET
                enabled          = COALESCE(EXCLUDED.enabled, celery_job_overrides.enabled),
                cron_minute      = EXCLUDED.cron_minute,
                cron_hour        = EXCLUDED.cron_hour,
                cron_day_of_week = EXCLUDED.cron_day_of_week,
                notes            = EXCLUDED.notes,
                updated_at       = now()
            """,
            (
                job_name,
                body.enabled if body.enabled is not None else True,
                body.cron_minute or None,
                body.cron_hour or None,
                body.cron_day_of_week or None,
                body.notes or None,
            ),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        logger.exception("update_job failed for %s", job_name)
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "ok", "job_name": job_name}


@router.post("/jobs/{job_name}/trigger")
def trigger_job(job_name: str, request: Request):
    require_admin(request)
    if job_name not in BEAT_SCHEDULE:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_name}")
    task_name = BEAT_SCHEDULE[job_name]["task"]
    try:
        from app.worker import celery_app
        result = celery_app.send_task(task_name)
        return {"status": "queued", "job_name": job_name, "task_id": result.id}
    except Exception as exc:
        logger.exception("trigger_job failed for %s", job_name)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Usage endpoints ───────────────────────────────────────────────────────────

@router.get("/usage")
def get_usage(request: Request, limit: int = 100, offset: int = 0):
    require_admin(request)
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, service, operation, model, input_tokens, output_tokens,
                   audio_seconds, cost_usd, created_at
            FROM api_usage_log
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT COUNT(*) FROM api_usage_log")
        total = cur.fetchone()[0]
        cur.close()
        conn.close()
        return {"total": total, "rows": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/usage/summary")
def get_usage_summary(request: Request):
    require_admin(request)
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # By operation
        cur.execute("""
            SELECT operation, model,
                   COUNT(*)         AS calls,
                   SUM(input_tokens)  AS total_input_tokens,
                   SUM(output_tokens) AS total_output_tokens,
                   SUM(cost_usd)      AS total_cost_usd
            FROM api_usage_log
            WHERE service = 'anthropic'
            GROUP BY operation, model
            ORDER BY total_cost_usd DESC NULLS LAST
            LIMIT 50
        """)
        by_operation = [dict(r) for r in cur.fetchall()]

        # Totals
        cur.execute("""
            SELECT
                COUNT(*)           AS total_calls,
                SUM(input_tokens)  AS total_input_tokens,
                SUM(output_tokens) AS total_output_tokens,
                SUM(cost_usd)      AS total_cost_usd,
                SUM(CASE WHEN created_at >= now() - interval '24 hours' THEN cost_usd ELSE 0 END) AS cost_24h,
                SUM(CASE WHEN created_at >= now() - interval '7 days'  THEN cost_usd ELSE 0 END) AS cost_7d,
                SUM(CASE WHEN created_at >= now() - interval '30 days' THEN cost_usd ELSE 0 END) AS cost_30d
            FROM api_usage_log
            WHERE service = 'anthropic'
        """)
        totals = dict(cur.fetchone())

        cur.close()
        conn.close()
        return {"totals": totals, "by_operation": by_operation}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
