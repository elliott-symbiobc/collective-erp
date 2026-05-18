import logging
import os

import psycopg2

logger = logging.getLogger(__name__)


def run_tea(substrate_id: int, output_name: str | None = None, run_lca: bool = True) -> dict:
    """Celery task body: run TEA for a substrate, optionally for one output only.

    If run_lca=True (default), attempts a standalone LCA run after TEA completes.
    LCA failure is caught and logged but never blocks TEA results from being returned.
    """
    from app.agents.tea_agent import run_tea_for_substrate

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        results = run_tea_for_substrate(substrate_id, conn, output_name=output_name)
        logger.info("TEA complete for substrate %s: %d outputs evaluated", substrate_id, len(results))

        tea_result = {
            "status": "success",
            "substrate_id": substrate_id,
            "n_outputs": len(results),
            "results": [
                {
                    "candidate_output": r["candidate_output"],
                    "recommendation":   r["recommendation"],
                    "mpsp_usd_kg":      r["mpsp_usd_kg"],
                    "margin_headroom":  r["margin_headroom"],
                    "viability_rank":   r.get("viability_rank"),
                }
                for r in results
            ],
        }

        # Attempt LCA after TEA — failure must never block TEA results
        if run_lca:
            try:
                from app.tasks.lca_task import run_lca_standalone
                lca_result = run_lca_standalone(substrate_id, output_name=output_name)
                tea_result["lca"] = lca_result
                logger.info(
                    "LCA complete for substrate %s: status=%s",
                    substrate_id, lca_result.get("status"),
                )
            except Exception as lca_exc:
                logger.warning(
                    "LCA failed for substrate %s (TEA results unaffected): %s",
                    substrate_id, lca_exc,
                )
                tea_result["lca"] = {"status": "error", "error": str(lca_exc)}

        return tea_result
    except Exception as exc:
        logger.exception("run_tea failed for substrate %s", substrate_id)
        return {"status": "error", "substrate_id": substrate_id, "error": str(exc)}
    finally:
        conn.close()
