import logging
import os

import psycopg2

logger = logging.getLogger(__name__)


def run_lca(substrate_id, bst_system, product_stream, substrate, output_name, conn):
    """Run LCA for a substrate given a live bioSTEAM system.

    Called from tea_task.py after TEA completes when a bst_system is available.
    Returns a result dict; never raises — errors are caught and returned as status='error'.
    """
    try:
        from app.agents.lca_agent import run_lca_for_substrate

        results = run_lca_for_substrate(
            substrate_id=substrate_id,
            bst_system=bst_system,
            product_stream=product_stream,
            substrate=substrate,
            output_name=output_name,
            conn=conn,
        )
        return {"status": "success", "n_methods": len(results), "results": results}
    except Exception as e:
        logger.error(f"LCA task failed for substrate {substrate_id}: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


def run_lca_standalone(substrate_id, output_name=None):
    """Standalone LCA entry point — rebuilds bst.System from DB and runs LCA.

    Opens its own DB connection. Fetches the substrate, loads TEA configs for
    each previously-computed output, rebuilds the bioSTEAM flowsheet, then runs
    the full LCA pipeline. LCA failure on any single output is caught and logged
    without aborting remaining outputs.
    """
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        from app.agents.tea_agent import (
            build_biosteam_system,
            get_or_create_config,
            get_titer_yield_assumptions,
            _get_dsp_sequence,
        )
        from app.agents.lca_agent import apply_lca_cfs, compute_lca_impacts, _persist_lca_results, _persist_lca_workbook

        # ── Fetch substrate ────────────────────────────────────────────────
        cur = conn.cursor()
        cur.execute(
            """
            SELECT substrate_id, name, cluster_id,
                   pct_starch, pct_cellulose, pct_hemicellulose, pct_pectin,
                   pct_lignin, pct_protein, pct_lipid,
                   total_phenolics_mgkg, tannin_load_mgkg,
                   cn_ratio, water_activity, ph_native
            FROM substrates WHERE substrate_id = %s
            """,
            (substrate_id,),
        )
        row = cur.fetchone()
        if not row:
            logger.error("Substrate %s not found", substrate_id)
            return {"status": "error", "error": "Substrate not found"}

        cols = [
            "substrate_id", "name", "cluster_id",
            "pct_starch", "pct_cellulose", "pct_hemicellulose", "pct_pectin",
            "pct_lignin", "pct_protein", "pct_lipid",
            "total_phenolics_mgkg", "tannin_load_mgkg",
            "cn_ratio", "water_activity", "ph_native",
        ]
        substrate = dict(zip(cols, row))
        cur.close()

        # ── Resolve outputs to process ────────────────────────────────────
        if output_name:
            outputs = [output_name]
        else:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT DISTINCT candidate_output FROM substrate_tea_results
                WHERE substrate_id = %s
                ORDER BY candidate_output
                """,
                (substrate_id,),
            )
            outputs = [r[0] for r in cur.fetchall()]
            cur.close()

        if not outputs:
            logger.warning("No TEA outputs found for substrate %s — run TEA first", substrate_id)
            return {"status": "error", "error": "No TEA results found; run TEA before LCA"}

        # ── Run LCA per output ────────────────────────────────────────────
        all_results = {}
        for out in outputs:
            try:
                config = get_or_create_config(substrate_id, out, conn)
                assumptions = get_titer_yield_assumptions(substrate_id, out, conn)
                effective_config = {}
                effective_config.update(assumptions)
                if config:
                    effective_config.update(config)

                dsp_steps = _get_dsp_sequence(out, conn)
                bst_system, product_stream = build_biosteam_system(
                    substrate, out, effective_config, dsp_steps=dsp_steps, conn=conn
                )
                if bst_system is None:
                    logger.warning("Could not rebuild bst.System for %s — skipping LCA", out)
                    continue

                impact_keys = apply_lca_cfs(bst_system, conn)
                if not impact_keys:
                    logger.warning("No LCA impact keys configured — skipping")
                    break

                results = compute_lca_impacts(bst_system, product_stream, impact_keys)
                if results:
                    _persist_lca_results(substrate_id, out, results, conn)
                    _persist_lca_workbook(substrate_id, out, results, conn)
                    all_results[out] = results
                    logger.info("LCA complete for %s / %s: %s", substrate_id, out, list(results.keys()))

            except Exception as exc:
                logger.error("LCA standalone failed for output %s: %s", out, exc, exc_info=True)

        return {
            "status": "success",
            "substrate_id": substrate_id,
            "n_outputs": len(all_results),
            "outputs": list(all_results.keys()),
        }

    except Exception as e:
        logger.error("LCA standalone failed for substrate %s: %s", substrate_id, e, exc_info=True)
        return {"status": "error", "error": str(e)}
    finally:
        conn.close()
