"""
regulatory_task.py — Celery task entry points for the regulatory agent.
"""
import asyncio
import logging
import os

import psycopg2

logger = logging.getLogger(__name__)


def run_regulatory_check(opportunity_id: str) -> dict:
    """Run regulatory pre-screen for a compound opportunity.

    Called by run_regulatory_task in worker.py (the compound_id arg is
    actually an opportunity_id UUID string despite the name in the worker).
    """
    from app.agents.regulatory_agent import regulatory_prescreen

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        result = asyncio.run(regulatory_prescreen(str(opportunity_id), conn))
        logger.info("Regulatory prescreen complete for opportunity %s", opportunity_id)
        return {"status": "success", "opportunity_id": str(opportunity_id), "result": result}
    except Exception as exc:
        logger.exception("run_regulatory_check failed for opportunity %s", opportunity_id)
        return {"status": "error", "opportunity_id": str(opportunity_id), "error": str(exc)}
    finally:
        conn.close()


def run_full_regulatory_analysis(opportunity_id: str) -> dict:
    """Run full regulatory analysis (US + EU + NPV adjustment) for a
    compound opportunity that has already been approved by a reviewer."""
    from app.agents.regulatory_agent import full_regulatory_analysis

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        result = asyncio.run(full_regulatory_analysis(str(opportunity_id), conn))
        logger.info("Full regulatory analysis complete for opportunity %s", opportunity_id)
        return {"status": "success", "opportunity_id": str(opportunity_id), "result": result}
    except Exception as exc:
        logger.exception(
            "run_full_regulatory_analysis failed for opportunity %s", opportunity_id
        )
        return {"status": "error", "opportunity_id": str(opportunity_id), "error": str(exc)}
    finally:
        conn.close()
