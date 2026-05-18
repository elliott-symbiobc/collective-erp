"""
agent_task.py — Celery task entry point for the weekly literature agent.
"""
import asyncio
import logging
import os

import psycopg2

logger = logging.getLogger(__name__)


def run_agent_pipeline() -> dict:
    """Run the weekly literature sweep synchronously (called from Celery worker).

    Returns:
        {"status": "success"|"error", "new_queue_items": int}
    """
    from app.agents.literature_agent import run_weekly_sweep

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        count = asyncio.run(run_weekly_sweep(conn))
        logger.info("Agent pipeline complete: %d new queue items", count)
        return {"status": "success", "new_queue_items": count}
    except Exception as exc:
        logger.exception("Agent pipeline failed: %s", exc)
        conn.rollback()
        return {"status": "error", "error": str(exc), "new_queue_items": 0}
    finally:
        conn.close()
