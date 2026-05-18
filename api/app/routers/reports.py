"""
reports.py — DOCX TEA report download + analytics.

GET /reports/files            — list available DOCX report files
GET /reports/files/{filename} — download a DOCX report
GET /reports/tasks/overview   — personal task completion, overdue, by priority/source
GET /reports/tasks/team       — admin: per-employee task stats
GET /reports/crm              — CRM deal pipeline and project metrics
GET /reports/time-analysis    — planned vs actual time by block type
GET /reports/completion       — daily and priority-based completion rates
GET /reports/velocity         — weekly block/task velocity
GET /reports/estimate-accuracy — AI estimate vs actual duration accuracy
GET /reports/summary          — quick weekly/monthly overview
"""
import os
from datetime import date, timedelta

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.routers.auth import get_current_user

router = APIRouter(prefix="/reports", tags=["reports"])
security = HTTPBearer(auto_error=False)

REPORTS_DIR = "/app/reports"


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    import jwt as pyjwt
    token = credentials.credentials
    secret = os.environ.get("JWT_SECRET", "changeme")
    try:
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        return payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# DOCX report file serving (existing TEA reports)
# ---------------------------------------------------------------------------

@router.get("/files")
def list_reports():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    files = sorted(
        f for f in os.listdir(REPORTS_DIR) if f.endswith(".docx")
    )
    return [{"filename": f} for f in files]


@router.get("/files/{filename}")
def download_report(filename: str):
    # Reject path traversal attempts
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files are served here")

    filepath = os.path.join(REPORTS_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Report not found")

    return FileResponse(
        path=filepath,
        filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


# ---------------------------------------------------------------------------
# AI Planner Analytics
# ---------------------------------------------------------------------------

@router.get("/summary")
def get_reports_summary(credentials: HTTPAuthorizationCredentials = Depends(security)):
    user_id = _verify_token(credentials)
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        today = date.today()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)

        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE dp.plan_date >= %s) AS blocks_this_week,
                COUNT(*) FILTER (WHERE pb.status = 'done' AND dp.plan_date >= %s) AS completed_this_week,
                COUNT(*) FILTER (WHERE dp.plan_date >= %s) AS blocks_this_month,
                COUNT(*) FILTER (WHERE pb.status = 'done' AND dp.plan_date >= %s) AS completed_this_month,
                COALESCE(SUM(pb.actual_minutes) FILTER (WHERE dp.plan_date >= %s), 0) AS actual_minutes_week,
                COALESCE(SUM(pb.estimated_minutes) FILTER (WHERE dp.plan_date >= %s), 0) AS planned_minutes_week
            FROM plan_blocks pb
            JOIN daily_plans dp ON dp.plan_id = pb.plan_id
            WHERE pb.user_id = %s
        """, (week_ago, week_ago, month_ago, month_ago, week_ago, week_ago, user_id))
        stats = cur.fetchone()

        cur.execute("""
            SELECT COALESCE(SUM(logged_minutes), 0) AS logged_this_week
            FROM time_logs
            WHERE user_id = %s AND log_date >= %s
        """, (user_id, week_ago))
        logged = cur.fetchone()

        return {
            "this_week": {
                "blocks": stats["blocks_this_week"],
                "completed": stats["completed_this_week"],
                "completion_pct": round(100 * stats["completed_this_week"] / stats["blocks_this_week"], 1)
                    if stats["blocks_this_week"] else 0,
                "planned_minutes": stats["planned_minutes_week"],
                "actual_minutes": stats["actual_minutes_week"],
                "logged_minutes": logged["logged_this_week"],
            },
            "this_month": {
                "blocks": stats["blocks_this_month"],
                "completed": stats["completed_this_month"],
                "completion_pct": round(100 * stats["completed_this_month"] / stats["blocks_this_month"], 1)
                    if stats["blocks_this_month"] else 0,
            },
        }
    finally:
        conn.close()


@router.get("/time-analysis")
def get_time_analysis(
    days: int = Query(30, ge=7, le=365),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user_id = _verify_token(credentials)
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        since = date.today() - timedelta(days=days)

        cur.execute("""
            SELECT
                block_type,
                COUNT(*) AS block_count,
                COALESCE(SUM(estimated_minutes), 0) AS planned_minutes,
                COALESCE(SUM(actual_minutes), 0) AS actual_minutes,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed_count
            FROM plan_blocks
            WHERE user_id = %s
              AND plan_id IN (SELECT plan_id FROM daily_plans WHERE plan_date >= %s AND user_id = %s)
            GROUP BY block_type
            ORDER BY planned_minutes DESC NULLS LAST
        """, (user_id, since, user_id))
        by_type = cur.fetchall()

        cur.execute("""
            SELECT log_date, SUM(logged_minutes) AS logged_minutes, COUNT(*) AS entries
            FROM time_logs
            WHERE user_id = %s AND log_date >= %s
            GROUP BY log_date ORDER BY log_date
        """, (user_id, since))
        daily_logged = cur.fetchall()

        cur.execute("""
            SELECT
                COALESCE(SUM(estimated_minutes), 0) AS total_planned,
                COALESCE(SUM(actual_minutes), 0) AS total_actual
            FROM plan_blocks
            WHERE user_id = %s
              AND plan_id IN (SELECT plan_id FROM daily_plans WHERE plan_date >= %s AND user_id = %s)
        """, (user_id, since, user_id))
        totals = cur.fetchone()

        cur.execute("""
            SELECT COALESCE(SUM(logged_minutes), 0) AS total_logged
            FROM time_logs WHERE user_id = %s AND log_date >= %s
        """, (user_id, since))
        logged_total = cur.fetchone()

        return {
            "period_days": days,
            "by_type": [dict(r) for r in by_type],
            "daily_logged": [
                {"date": str(r["log_date"]), "minutes": r["logged_minutes"], "entries": r["entries"]}
                for r in daily_logged
            ],
            "totals": {
                "planned_minutes": totals["total_planned"],
                "actual_minutes": totals["total_actual"],
                "logged_minutes": logged_total["total_logged"],
            },
        }
    finally:
        conn.close()


@router.get("/completion")
def get_completion_rate(
    days: int = Query(30, ge=7, le=365),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user_id = _verify_token(credentials)
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        since = date.today() - timedelta(days=days)

        cur.execute("""
            SELECT
                dp.plan_date,
                COUNT(pb.block_id) AS total_blocks,
                SUM(CASE WHEN pb.status = 'done' THEN 1 ELSE 0 END) AS completed_blocks,
                CASE WHEN COUNT(pb.block_id) > 0
                     THEN ROUND(100.0 * SUM(CASE WHEN pb.status = 'done' THEN 1 ELSE 0 END) / COUNT(pb.block_id), 1)
                     ELSE 0 END AS completion_pct
            FROM daily_plans dp
            LEFT JOIN plan_blocks pb ON pb.plan_id = dp.plan_id AND pb.user_id = dp.user_id
            WHERE dp.user_id = %s AND dp.plan_date >= %s
            GROUP BY dp.plan_date ORDER BY dp.plan_date
        """, (user_id, since))
        daily = cur.fetchall()

        cur.execute("""
            SELECT
                CASE
                    WHEN priority_score >= 90 THEN 'CRITICAL'
                    WHEN priority_score >= 70 THEN 'HIGH'
                    WHEN priority_score >= 50 THEN 'ELEVATED'
                    WHEN priority_score >= 30 THEN 'NORMAL'
                    ELSE 'LOW'
                END AS priority_bucket,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed,
                CASE WHEN COUNT(*) > 0
                     THEN ROUND(100.0 * SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) / COUNT(*), 1)
                     ELSE 0 END AS completion_pct
            FROM plan_blocks
            WHERE user_id = %s
              AND plan_id IN (SELECT plan_id FROM daily_plans WHERE plan_date >= %s AND user_id = %s)
            GROUP BY priority_bucket
        """, (user_id, since, user_id))
        by_priority = cur.fetchall()

        cur.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
            FROM plan_blocks
            WHERE user_id = %s
              AND plan_id IN (SELECT plan_id FROM daily_plans WHERE plan_date >= %s AND user_id = %s)
        """, (user_id, since, user_id))
        overall = cur.fetchone()

        return {
            "period_days": days,
            "daily": [
                {
                    "date": str(r["plan_date"]),
                    "total": r["total_blocks"],
                    "completed": r["completed_blocks"],
                    "pct": float(r["completion_pct"]),
                }
                for r in daily
            ],
            "by_priority": [dict(r) for r in by_priority],
            "overall": dict(overall),
        }
    finally:
        conn.close()


@router.get("/velocity")
def get_velocity(
    weeks: int = Query(12, ge=4, le=52),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user_id = _verify_token(credentials)
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        since = date.today() - timedelta(weeks=weeks)

        cur.execute("""
            SELECT
                DATE_TRUNC('week', dp.plan_date)::date AS week_start,
                COUNT(pb.block_id) AS total_blocks,
                SUM(CASE WHEN pb.status = 'done' THEN 1 ELSE 0 END) AS completed_blocks,
                COALESCE(SUM(CASE WHEN pb.status = 'done' THEN pb.actual_minutes END), 0) AS completed_minutes
            FROM daily_plans dp
            LEFT JOIN plan_blocks pb ON pb.plan_id = dp.plan_id AND pb.user_id = dp.user_id
            WHERE dp.user_id = %s AND dp.plan_date >= %s
            GROUP BY week_start ORDER BY week_start
        """, (user_id, since))
        weekly = cur.fetchall()

        cur.execute("""
            SELECT
                DATE_TRUNC('week', updated_at)::date AS week_start,
                COUNT(*) AS tasks_done
            FROM tasks
            WHERE user_id = %s AND status = 'done' AND updated_at >= %s
            GROUP BY week_start ORDER BY week_start
        """, (user_id, since))
        tasks_weekly = cur.fetchall()
        tasks_map = {str(r["week_start"]): r["tasks_done"] for r in tasks_weekly}

        return {
            "period_weeks": weeks,
            "weekly": [
                {
                    "week": str(r["week_start"]),
                    "total_blocks": r["total_blocks"],
                    "completed_blocks": r["completed_blocks"],
                    "completed_minutes": r["completed_minutes"],
                    "tasks_done": tasks_map.get(str(r["week_start"]), 0),
                }
                for r in weekly
            ],
        }
    finally:
        conn.close()


@router.get("/estimate-accuracy")
def get_estimate_accuracy(
    days: int = Query(30, ge=7, le=365),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user_id = _verify_token(credentials)
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        since = date.today() - timedelta(days=days)

        cur.execute("""
            SELECT
                pb.block_id, pb.title, pb.block_type,
                pb.estimated_minutes, pb.actual_minutes,
                pb.actual_minutes - pb.estimated_minutes AS delta_minutes,
                CASE WHEN pb.estimated_minutes > 0
                     THEN ROUND(100.0 * (pb.actual_minutes - pb.estimated_minutes) / pb.estimated_minutes, 1)
                     ELSE NULL END AS pct_error,
                dp.plan_date
            FROM plan_blocks pb
            JOIN daily_plans dp ON dp.plan_id = pb.plan_id
            WHERE pb.user_id = %s AND dp.plan_date >= %s
              AND pb.estimated_minutes IS NOT NULL
              AND pb.actual_minutes IS NOT NULL AND pb.actual_minutes > 0
            ORDER BY dp.plan_date DESC LIMIT 200
        """, (user_id, since))
        raw = cur.fetchall()

        cur.execute("""
            SELECT
                COUNT(*) AS sample_size,
                ROUND(AVG(actual_minutes - estimated_minutes), 1) AS avg_delta,
                ROUND(AVG(ABS(actual_minutes - estimated_minutes)), 1) AS avg_abs_error,
                ROUND(AVG(CASE WHEN estimated_minutes > 0
                          THEN 100.0 * ABS(actual_minutes - estimated_minutes) / estimated_minutes
                          ELSE NULL END), 1) AS avg_pct_error,
                SUM(CASE WHEN actual_minutes <= estimated_minutes * 1.1 THEN 1 ELSE 0 END) AS on_time_count
            FROM plan_blocks pb
            JOIN daily_plans dp ON dp.plan_id = pb.plan_id
            WHERE pb.user_id = %s AND dp.plan_date >= %s
              AND pb.estimated_minutes IS NOT NULL
              AND pb.actual_minutes IS NOT NULL AND pb.actual_minutes > 0
        """, (user_id, since))
        agg = cur.fetchone()

        cur.execute("""
            SELECT
                pb.block_type, COUNT(*) AS count,
                ROUND(AVG(actual_minutes - estimated_minutes), 1) AS avg_delta,
                ROUND(AVG(CASE WHEN estimated_minutes > 0
                          THEN 100.0 * ABS(actual_minutes - estimated_minutes) / estimated_minutes
                          ELSE NULL END), 1) AS avg_pct_error
            FROM plan_blocks pb
            JOIN daily_plans dp ON dp.plan_id = pb.plan_id
            WHERE pb.user_id = %s AND dp.plan_date >= %s
              AND pb.estimated_minutes IS NOT NULL
              AND pb.actual_minutes IS NOT NULL AND pb.actual_minutes > 0
            GROUP BY pb.block_type ORDER BY count DESC
        """, (user_id, since))
        by_type = cur.fetchall()

        return {
            "period_days": days,
            "aggregate": dict(agg),
            "by_type": [dict(r) for r in by_type],
            "samples": [
                {
                    "block_id": str(r["block_id"]),
                    "title": r["title"],
                    "type": r["block_type"],
                    "estimated": r["estimated_minutes"],
                    "actual": r["actual_minutes"],
                    "delta": r["delta_minutes"],
                    "pct_error": float(r["pct_error"]) if r["pct_error"] is not None else None,
                    "date": str(r["plan_date"]),
                }
                for r in raw
            ],
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Task analytics (new schema)
# ---------------------------------------------------------------------------

@router.get("/tasks/overview")
def get_tasks_overview(
    days: int = Query(30, ge=7, le=365),
    request: Request = None,
):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    uid = user["user_id"]
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        since = date.today() - timedelta(days=days)

        cur.execute("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'done') AS done,
                COUNT(*) FILTER (WHERE status = 'open') AS open,
                COUNT(*) FILTER (WHERE status = 'open' AND due_date < CURRENT_DATE) AS overdue
            FROM tasks
            WHERE user_id = %s::uuid OR assigned_to = %s::uuid
        """, (uid, uid))
        totals = dict(cur.fetchone())

        cur.execute("""
            SELECT
                COALESCE(priority, 'none') AS priority,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'done') AS done,
                COUNT(*) FILTER (WHERE status = 'open' AND due_date < CURRENT_DATE) AS overdue
            FROM tasks
            WHERE user_id = %s::uuid OR assigned_to = %s::uuid
            GROUP BY priority
            ORDER BY
                CASE COALESCE(priority,'none')
                    WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
        """, (uid, uid))
        by_priority = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT kanban_status, COUNT(*) AS count
            FROM tasks
            WHERE (user_id = %s::uuid OR assigned_to = %s::uuid) AND status = 'open'
            GROUP BY kanban_status
            ORDER BY
                CASE kanban_status
                    WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2
                    WHEN 'review' THEN 3 WHEN 'done' THEN 4 END
        """, (uid, uid))
        by_kanban = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT
                CASE
                    WHEN source_ref LIKE 'funding:%%' THEN 'Funding'
                    WHEN source_ref LIKE 'dilutive:%%' THEN 'Investor'
                    WHEN source = 'gmail' THEN 'Email Follow-up'
                    WHEN project_id IS NOT NULL THEN 'Project'
                    WHEN contact_id IS NOT NULL THEN 'Contact'
                    ELSE 'General'
                END AS category,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'done') AS done
            FROM tasks
            WHERE user_id = %s::uuid OR assigned_to = %s::uuid
            GROUP BY category
            ORDER BY total DESC
        """, (uid, uid))
        by_category = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT
                DATE_TRUNC('week', updated_at)::date AS week,
                COUNT(*) AS tasks_done
            FROM tasks
            WHERE (user_id = %s::uuid OR assigned_to = %s::uuid)
              AND status = 'done'
              AND updated_at >= %s
            GROUP BY week ORDER BY week
        """, (uid, uid, since))
        weekly_done = [{"week": str(r["week"]), "tasks_done": r["tasks_done"]}
                       for r in cur.fetchall()]

        return {
            "period_days": days,
            "totals": totals,
            "by_priority": by_priority,
            "by_kanban": by_kanban,
            "by_category": by_category,
            "weekly_done": weekly_done,
        }
    finally:
        conn.close()


@router.get("/tasks/team")
def get_tasks_team(request: Request = None):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("""
            SELECT
                u.user_id::text,
                COALESCE(u.full_name, u.name, u.email) AS name,
                u.email,
                u.role,
                COUNT(t.task_id) AS total,
                COUNT(t.task_id) FILTER (WHERE t.status = 'done') AS done,
                COUNT(t.task_id) FILTER (WHERE t.status = 'open') AS open,
                COUNT(t.task_id) FILTER (WHERE t.status = 'open' AND t.due_date < CURRENT_DATE) AS overdue,
                CASE WHEN COUNT(t.task_id) > 0
                     THEN ROUND(100.0 * COUNT(t.task_id) FILTER (WHERE t.status = 'done') / COUNT(t.task_id), 1)
                     ELSE 0 END AS completion_pct
            FROM users u
            LEFT JOIN tasks t ON t.user_id = u.user_id OR t.assigned_to = u.user_id
            WHERE COALESCE(u.is_active, true) = true
            GROUP BY u.user_id, u.full_name, u.name, u.email, u.role
            ORDER BY total DESC NULLS LAST
        """)
        members = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT
                u.user_id::text,
                COALESCE(t.priority, 'none') AS priority,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE t.status = 'done') AS done
            FROM users u
            JOIN tasks t ON t.user_id = u.user_id OR t.assigned_to = u.user_id
            WHERE COALESCE(u.is_active, true) = true
            GROUP BY u.user_id, priority
        """)
        priority_rows = [dict(r) for r in cur.fetchall()]

        return {"members": members, "priority_breakdown": priority_rows}
    finally:
        conn.close()


@router.get("/crm")
def get_crm_metrics(request: Request = None):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("""
            SELECT
                stage,
                COUNT(*) AS count,
                COALESCE(SUM(expected_revenue), 0) AS total_revenue,
                COALESCE(AVG(probability), 0) AS avg_probability,
                COALESCE(SUM(expected_revenue * COALESCE(probability,0) / 100), 0) AS weighted_revenue
            FROM crm_deals
            WHERE NOT COALESCE(archived, false)
            GROUP BY stage
            ORDER BY count DESC
        """)
        deals_by_stage = [
            {**dict(r), "total_revenue": float(r["total_revenue"]),
             "avg_probability": float(r["avg_probability"]),
             "weighted_revenue": float(r["weighted_revenue"])}
            for r in cur.fetchall()
        ]

        cur.execute("""
            SELECT
                COUNT(*) AS total_deals,
                COALESCE(SUM(expected_revenue), 0) AS total_pipeline,
                COALESCE(SUM(expected_revenue * COALESCE(probability,0) / 100), 0) AS weighted_pipeline
            FROM crm_deals
            WHERE NOT COALESCE(archived, false)
        """)
        row = cur.fetchone()
        pipeline = {
            "total_deals": row["total_deals"],
            "total_pipeline": float(row["total_pipeline"]),
            "weighted_pipeline": float(row["weighted_pipeline"]),
        }

        cur.execute("""
            SELECT
                COALESCE(section, 'other') AS section,
                COALESCE(stage, 'No Stage') AS stage,
                COUNT(*) AS count,
                COALESCE(SUM(expected_revenue), 0) AS total_revenue
            FROM projects
            WHERE COALESCE(status, 'active') = 'active'
            GROUP BY section, stage
            ORDER BY section, count DESC
        """)
        projects_by_stage = [
            {**dict(r), "total_revenue": float(r["total_revenue"])}
            for r in cur.fetchall()
        ]

        cur.execute("""
            SELECT
                p.name,
                COALESCE(p.section, 'other') AS section,
                COALESCE(p.stage, '—') AS stage,
                COUNT(t.task_id) FILTER (WHERE t.status = 'open') AS open_tasks,
                COUNT(t.task_id) FILTER (WHERE t.status = 'open' AND t.due_date < CURRENT_DATE) AS overdue_tasks
            FROM projects p
            LEFT JOIN tasks t ON t.project_id = p.project_id
            WHERE COALESCE(p.status, 'active') = 'active'
            GROUP BY p.project_id, p.name, p.section, p.stage
            HAVING COUNT(t.task_id) FILTER (WHERE t.status = 'open') > 0
            ORDER BY open_tasks DESC
            LIMIT 10
        """)
        project_tasks = [dict(r) for r in cur.fetchall()]

        return {
            "pipeline": pipeline,
            "deals_by_stage": deals_by_stage,
            "projects_by_stage": projects_by_stage,
            "project_tasks": project_tasks,
        }
    finally:
        conn.close()
