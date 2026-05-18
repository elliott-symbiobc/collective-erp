"""
discovery_task.py — Celery task entry points for compound discovery agents.
"""
import asyncio
import logging
import os

import psycopg2

logger = logging.getLogger(__name__)


def run_strain_discovery(strain_id: str) -> dict:
    """Mode 1: Enzymatic Potential Mining — scan a strain's CAZyme arsenal
    for biosynthetic potential across candidate compound classes."""
    from app.agents.compound_discovery_agent import scan_strain_biosynthetic_potential

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        opportunities = asyncio.run(scan_strain_biosynthetic_potential(strain_id, conn))
        logger.info(
            "Strain discovery complete for %s: %d opportunities", strain_id, len(opportunities)
        )
        return {
            "status": "success",
            "strain_id": strain_id,
            "n_opportunities": len(opportunities),
        }
    except Exception as exc:
        logger.exception("run_strain_discovery failed for strain %s", strain_id)
        return {"status": "error", "strain_id": strain_id, "error": str(exc)}
    finally:
        conn.close()


def run_discovery(substrate_id: str) -> dict:
    """Alias used by run_discovery_task in worker.py."""
    return run_substrate_discovery(substrate_id)


def run_substrate_discovery(substrate_id: str) -> dict:
    """Mode 2: Substrate Dark Chemistry — screen a substrate for novel
    biochemical pathways and identify which strains could exploit them."""
    from app.agents.compound_discovery_agent import scan_substrate_dark_chemistry

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        opportunities = asyncio.run(scan_substrate_dark_chemistry(substrate_id, conn))
        logger.info(
            "Substrate discovery complete for %s: %d opportunities",
            substrate_id,
            len(opportunities),
        )
        return {
            "status": "success",
            "substrate_id": substrate_id,
            "n_opportunities": len(opportunities),
        }
    except Exception as exc:
        logger.exception("run_substrate_discovery failed for substrate %s", substrate_id)
        return {"status": "error", "substrate_id": substrate_id, "error": str(exc)}
    finally:
        conn.close()
