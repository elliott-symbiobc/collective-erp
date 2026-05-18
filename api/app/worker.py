import logging
import os
import subprocess
from datetime import timedelta

import psycopg2
from celery import Celery
from celery.schedules import crontab

logger = logging.getLogger(__name__)

celery_app = Celery(
    "symbio",
    broker=os.environ.get("REDIS_URL", "redis://redis:6379/0"),
    backend=os.environ.get("REDIS_URL", "redis://redis:6379/0"),
)
# Alias expected by `celery -A app.worker worker`
celery = celery_app

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    beat_schedule={
        "nightly-retrain": {
            "task": "app.worker.run_retrain_task",
            "schedule": crontab(hour=2, minute=0),
        },
        "weekly-literature-sweep": {
            "task": "app.worker.run_agent_task",
            "schedule": crontab(hour=2, minute=0, day_of_week=1),  # Monday 02:00 UTC
            "options": {"queue": "celery"},
        },
        "daily-plaid-sync": {
            "task": "app.worker.sync_plaid_actuals",
            "schedule": crontab(hour=7, minute=0),
        },
        "daily-qbo-sync": {
            "task": "app.worker.sync_qbo_actuals",
            "schedule": crontab(hour=7, minute=15),
        },
        # Contacts module
        "contacts-gmail-sync": {
            "task": "app.worker.sync_gmail_contacts_all_users",
            "schedule": crontab(hour=3, minute=0),  # full sync once daily at 03:00 UTC
        },
        "contacts-gmail-incremental": {
            "task": "app.worker.sync_gmail_incremental_all_users",
            "schedule": crontab(minute=0),          # incremental every hour
        },
        "contacts-calendar-sync": {
            "task": "app.worker.sync_calendar_contacts_all_users",
            "schedule": crontab(minute=30),          # every hour at :30
        },
"contacts-summaries": {
            "task": "app.worker.refresh_contact_summaries_task",
            "schedule": crontab(hour=1, minute=0),   # nightly at 01:00 UTC
        },
        "contacts-relationship-inference": {
            "task": "app.worker.infer_relationships_task",
            "schedule": crontab(hour=2, minute=30),  # nightly at 02:30 UTC
        },
        "contacts-google-contacts-inbound": {
            "task": "app.worker.sync_google_contacts_inbound_all_users",
            "schedule": crontab(hour=4, minute=0),   # nightly at 04:00 UTC
        },
        "task-due-reminders": {
            "task": "app.worker.send_task_due_reminders",
            "schedule": crontab(hour=8, minute=30),  # daily at 08:30 UTC
        },
        # AI Planner
        "planner-daily": {
            "task": "app.worker.generate_daily_plans_all_users",
            "schedule": crontab(hour=12, minute=0),   # 06:00 CST daily
        },
        "planner-weekly": {
            "task": "app.worker.generate_weekly_plans_all_users",
            "schedule": crontab(hour=12, minute=0, day_of_week=1),  # 06:00 CST Monday
        },
        "planner-rollover": {
            "task": "app.worker.rollover_incomplete_blocks",
            "schedule": crontab(hour=23, minute=30),  # 17:30 CST daily — carry forward unfinished blocks
        },
        # RAG: nightly incremental re-embed of recently updated content
        "rag-nightly-embed": {
            "task": "app.worker.nightly_embed_task",
            "schedule": crontab(hour=1, minute=30),  # 01:30 UTC
        },
        # BGC safety flag sweep (after nightly annotation window)
        "bgc-safety-flag-sweep": {
            "task": "app.worker.flag_bgc_safety_task",
            "schedule": crontab(hour=3, minute=30),  # 03:30 UTC nightly
        },
        # Granola: poll for new meeting notes every 5 minutes
        "granola-sync": {
            "task": "app.worker.sync_granola_notes_task",
            "schedule": timedelta(minutes=5),
        },
        "email-suggestions-scan": {
            "task": "app.worker.scan_email_suggestions_all_users",
            "schedule": crontab(hour=8, minute=0),  # daily at 08:00 UTC
        },
    },
)


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _check_model_staleness() -> None:
    """Warn at worker startup if the compatibility model is missing or stale (> 7 days)."""
    import pickle
    from datetime import datetime, timezone
    from pathlib import Path

    model_path = Path("/opt/symbio/models/compatibility_model.pkl")
    if not model_path.exists():
        logger.warning(
            "MODEL STALENESS: compatibility_model.pkl not found — "
            "run retrain task or seed_training_data.py before predictions will work."
        )
        return

    try:
        with open(model_path, "rb") as fh:
            model_data = pickle.load(fh)
        last_trained_str = model_data.get("last_trained")
        if last_trained_str:
            last_trained = datetime.fromisoformat(last_trained_str)
            age_days = (datetime.now(timezone.utc) - last_trained).days
            if age_days > 7:
                logger.warning(
                    "MODEL STALENESS: compatibility_model.pkl is %d days old "
                    "(trained %s). Consider retraining.",
                    age_days, last_trained_str,
                )
            else:
                logger.info(
                    "Model freshness OK: compatibility_model.pkl trained %s (%d days ago, source=%s)",
                    last_trained_str, age_days,
                    model_data.get("training_data_source", "unknown"),
                )
    except Exception as exc:
        logger.warning("MODEL STALENESS: could not read model pkl: %s", exc)


try:
    _check_model_staleness()
except Exception:
    pass  # never block worker startup


# ---------------------------------------------------------------------------
# Retrain task
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.run_retrain_task", bind=True, max_retries=2)
def run_retrain_task(self, min_rows: int = 30):
    """Nightly retrain: fetch training_pairs and retrain XGBoost+MAPIE if enough rows."""
    from app.ml.retrain import retrain_from_db
    from app.ml.config import get_params

    cfg = get_params()
    min_rows = int(cfg.get("min_rows", min_rows))
    logger.info("run_retrain_task started (min_rows=%d)", min_rows)
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY training_pairs")
        conn.commit()
        cur.close()
        logger.info("training_pairs refreshed")
        result = retrain_from_db(conn, min_rows=min_rows)
        logger.info("run_retrain_task result: %s", result)
        return result
    except Exception as exc:
        logger.exception("run_retrain_task failed")
        raise self.retry(exc=exc, countdown=300)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Clustering task
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.run_clustering_task", bind=True)
def run_clustering_task(self):
    """PCA + Ward hierarchical clustering on substrate composition features.

    Assigns cluster_id to each substrate row in the substrates table.
    Requires at least 2 substrates to cluster.
    """
    import numpy as np
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    from scipy.cluster.hierarchy import fcluster, linkage

    SUBSTRATE_COMP_COLS = [
        "pct_starch", "pct_cellulose", "pct_hemicellulose", "pct_pectin",
        "pct_lignin", "pct_protein", "pct_lipid",
        "total_phenolics_mgkg", "tannin_load_mgkg",
        "cn_ratio", "water_activity", "ph_native",
    ]
    N_CLUSTERS = 5

    logger.info("run_clustering_task started")
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cols_sql = ", ".join(SUBSTRATE_COMP_COLS)
        cur.execute(f"SELECT substrate_id, {cols_sql} FROM substrates")
        rows = cur.fetchall()

        if len(rows) < 2:
            logger.info("Clustering skipped: fewer than 2 substrates")
            cur.close()
            return {"status": "skipped", "reason": "fewer than 2 substrates"}

        ids = [r[0] for r in rows]
        X = np.array([[float(v or 0) for v in r[1:]] for r in rows])

        # Standardise → PCA (retain 95% variance, min 2 components)
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        n_components = min(len(SUBSTRATE_COMP_COLS), len(rows) - 1, 8)
        pca = PCA(n_components=n_components, random_state=42)
        X_pca = pca.fit_transform(X_scaled)

        # Ward hierarchical clustering
        n_clusters = min(N_CLUSTERS, len(rows))
        Z = linkage(X_pca, method="ward")
        labels = fcluster(Z, t=n_clusters, criterion="maxclust")

        # Write cluster_id back to substrates
        for sub_id, cluster_id in zip(ids, labels):
            cur.execute(
                "UPDATE substrates SET cluster_id = %s WHERE substrate_id = %s",
                (int(cluster_id), sub_id),
            )
        conn.commit()
        cur.close()

        logger.info("Clustering complete: %d substrates → %d clusters", len(rows), n_clusters)
        return {"status": "success", "n_substrates": len(rows), "n_clusters": n_clusters}

    except Exception as exc:
        logger.exception("run_clustering_task failed")
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Strain annotation task
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.run_strain_annotation_task", bind=True, max_retries=1)
def run_strain_annotation_task(self, strain_id: str, ncbi_accession: str):
    """Queue genome annotation for a strain.

    Sets annotation_status='queued' in the DB.
    The host-level annotation_queue_daemon.sh picks up queued strains
    and runs dbCAN2/MEROPS annotation (requires micromamba/bioinformatics
    tools that run on the host, not in Docker).
    """
    import psycopg2

    logger.info("run_strain_annotation_task: queuing strain=%s accession=%s", strain_id, ncbi_accession)
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE strains
            SET annotation_status = 'queued',
                ncbi_accession = COALESCE(ncbi_accession, %s)
            WHERE strain_id = %s
            """,
            (ncbi_accession, strain_id),
        )
        conn.commit()
        cur.close()
        conn.close()
        logger.info("Strain %s queued for annotation", strain_id)
        return {"status": "queued", "strain_id": strain_id, "ncbi_accession": ncbi_accession}
    except Exception as exc:
        logger.exception("run_strain_annotation_task failed to queue strain %s", strain_id)
        return {"status": "error", "error": str(exc)}


# ---------------------------------------------------------------------------
# Remaining task stubs (implemented in tasks/)
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.run_tea_task", bind=True, max_retries=2, time_limit=600)
def run_tea_task(self, substrate_id: int, output_name: str | None = None, force_discovery: bool = False):
    """Run multi-route TEA for all applicable routes on a substrate.

    Falls back to single-output TEA if output_name is specified (config-triggered reruns).
    force_discovery=True re-runs the substrate dark chemistry scan even if cached results exist.
    """
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        if output_name:
            from app.tasks.tea_task import run_tea
            conn.close()
            return run_tea(substrate_id, output_name=output_name)
        from app.agents.tea_agent import run_tea_all_routes
        results = run_tea_all_routes(substrate_id, conn, force_discovery=force_discovery)
        total_routes = sum(len(v) for v in results.values())
        return {
            "status": "success",
            "outputs_evaluated": len(results),
            "route_results": total_routes,
        }
    except Exception as exc:
        logger.exception("run_tea_task failed for substrate %s: %s", substrate_id, exc)
        return {"status": "error", "error": str(exc)}
    finally:
        try:
            conn.close()
        except Exception:
            pass


@celery_app.task(name="app.worker.run_lca_task", bind=True)
def run_lca_task(self, substrate_id, output_name=None):
    """Run standalone LCA for a substrate (no live bst_system required).

    Triggers independently of TEA — useful for re-running LCA after
    updating activity mappings or method selections.
    """
    from app.tasks.lca_task import run_lca_standalone
    return run_lca_standalone(substrate_id, output_name=output_name)


@celery_app.task(name="app.worker.generate_tea_report_task", bind=True)
def generate_tea_report_task(self, substrate_id: str, full: bool = False):
    import subprocess
    args = ["node", "/app/generate_tea_report.js", str(substrate_id)]
    if full:
        args.append("--full")
    result = subprocess.run(args, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(
            f"Report generation failed (rc={result.returncode}): {result.stderr[:500]}"
        )
    filepath = result.stdout.strip()
    filename = os.path.basename(filepath)
    logger.info("TEA report generated: %s", filepath)
    return {"status": "success", "filepath": filepath, "filename": filename}


@celery_app.task(name="app.worker.generate_commercialization_report_task", bind=True, max_retries=1)
def generate_commercialization_report_task(self, substrate_id: str):
    """Generate a full commercialization report (TEA + regulatory + R&D + investment)."""
    import subprocess
    logger.info("generate_commercialization_report_task: substrate=%s", substrate_id)
    result = subprocess.run(
        ["node", "/app/generate_tea_report.js", str(substrate_id), "--full"],
        capture_output=True,
        text=True,
        timeout=300,
    )
    stdout = result.stdout.strip()
    stderr = result.stderr.strip()
    if result.returncode != 0:
        logger.error("Commercialization report failed (rc=%d):\n%s", result.returncode, stderr)
        raise self.retry(
            exc=RuntimeError(f"Report generation failed (rc={result.returncode}): {stderr[:500]}"),
            countdown=30,
        )
    filepath = stdout
    filename = os.path.basename(filepath)
    logger.info("Commercialization report generated: %s", filepath)
    return {"status": "success", "filepath": filepath, "filename": filename}
    logger.info("TEA report generated: %s", filepath)
    return {"status": "success", "filepath": filepath, "filename": filename}


@celery_app.task(name="app.worker.run_literature_assumptions_task", bind=True, max_retries=1)
def run_literature_assumptions_task(self, output_name: str):
    """Search PubMed, Europe PMC, OpenAlex + web for titer/yield data; extract with Claude."""
    import asyncio
    import json
    import re as _re

    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM tea_assumptions_pending WHERE lower(output_name) = lower(%s) AND status IN ('pending','approved') LIMIT 1",
            (output_name,),
        )
        if cur.fetchone():
            cur.close()
            conn.close()
            return {"status": "already_exists", "output_name": output_name}
        cur.close()

        from app.agents.literature_agent import search_pubmed, search_europe_pmc, search_openalex

        query_ssf = f"{output_name} fermentation titer yield g/L SSF solid-state Aspergillus production"
        query_smf = f"{output_name} submerged fermentation titer g/L microbial production yield"

        async def _gather_papers():
            results = await asyncio.gather(
                search_pubmed(query_ssf, limit=5),
                search_pubmed(query_smf, limit=5),
                search_europe_pmc(query_ssf, limit=4),
                search_openalex(query_ssf, limit=4),
                return_exceptions=True,
            )
            papers = []
            for r in results:
                if isinstance(r, list):
                    papers.extend(r)
            seen = set()
            deduped = []
            for p in papers:
                key = p.get("doi") or p.get("pmid") or p.get("title", "")[:60]
                if key and key not in seen:
                    seen.add(key)
                    deduped.append(p)
            return deduped[:12]

        papers = asyncio.run(_gather_papers())

        # Build context: title + abstract for each paper
        context_parts = []
        for p in papers:
            title = p.get("title") or ""
            abstract = p.get("abstract") or ""
            doi = p.get("doi") or ""
            authors = p.get("authors") or ""
            year = p.get("year") or ""
            ref = f"{authors} ({year})" if authors and year else doi or title[:50]
            if title or abstract:
                context_parts.append(f"[{ref}]\nTitle: {title}\n{abstract[:600]}")

        context = "\n\n---\n\n".join(context_parts) if context_parts else ""

        import anthropic
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

        prompt = f"""You are a bioprocess engineer extracting fermentation performance data for TEA modeling.

Target compound: {output_name}

Literature sources found:
{context if context else "(no papers retrieved — use your training knowledge)"}

Extract the best available quantitative values for producing {output_name} via microbial fermentation:
- titer_g_l: product concentration in fermentation broth (g/L). Use the highest reliably reported value from SSF or SmF. Null only if truly no data exists anywhere.
- yield_g_g: product mass per substrate mass consumed (g/g, range 0-1)
- sub_cost_per_ton: typical feedstock/substrate cost in USD/ton
- fermentation_mode: "SSF" (solid-state) or "SmF" (submerged)
- organism: primary production organism (genus species)
- citations: author-year or DOI for each extracted value, comma-separated. Be specific — include actual paper references if available.
- confidence: "high" (primary data from abstract above), "medium" (from training knowledge with known studies), or "low" (rough estimate only)
- evidence_quotes: list of up to 3 objects, each with "paper" (author-year or DOI) and "quote" (exact or near-exact sentence from the abstract that contains the numeric value). Only include quotes that directly state a titer, yield, or production rate for {output_name}. Empty list if no direct quotes available.

Rules:
1. If a paper above directly reports a titer or yield for {output_name}, use it — that is high confidence.
2. If no paper above is relevant but you know of published studies, report from training knowledge as medium confidence.
3. Only use null for titer_g_l if {output_name} is not produced by fermentation at all.

Respond ONLY with valid JSON, no explanation:
{{"titer_g_l": <number|null>, "yield_g_g": <number|null>, "sub_cost_per_ton": <number|null>, "fermentation_mode": "<SSF|SmF>", "organism": "<organism>", "citations": "<citations>", "confidence": "<high|medium|low>", "evidence_quotes": [{{"paper": "<ref>", "quote": "<sentence>"}}]}}"""

        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        _log_anthropic_usage(
            task="run_literature_assumptions_task",
            model="claude-sonnet-4-6",
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
        )
        raw = message.content[0].text.strip()
        try:
            data = json.loads(raw)
        except Exception:
            m = _re.search(r'\{.*\}', raw, _re.DOTALL)
            data = json.loads(m.group(0)) if m else {}

        import json as _json
        titer    = data.get("titer_g_l")
        yield_gg = data.get("yield_g_g")
        sub_cost = data.get("sub_cost_per_ton")
        ferm_mode = data.get("fermentation_mode")
        organism  = data.get("organism")
        citations = data.get("citations", "")
        confidence = data.get("confidence", "low")
        evidence_quotes = data.get("evidence_quotes") or []
        if not isinstance(evidence_quotes, list):
            evidence_quotes = []

        cur2 = conn.cursor()
        cur2.execute(
            """
            INSERT INTO tea_assumptions_pending
              (output_name, titer_g_l, yield_g_g, sub_cost_per_ton,
               fermentation_mode, organism, citations, raw_response, confidence,
               evidence_quotes, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')
            ON CONFLICT (lower(output_name)) WHERE status = 'pending' DO NOTHING
            """,
            (output_name, titer, yield_gg, sub_cost, ferm_mode, organism, citations, raw, confidence,
             _json.dumps(evidence_quotes)),
        )

        # Store found papers in papers table and link to compound_opportunity_papers
        linked_paper_ids = []
        for p in papers:
            doi   = (p.get("doi") or "").strip() or None
            title = (p.get("title") or "").strip()
            if not title:
                continue
            try:
                cur2.execute("SAVEPOINT paper_insert")
                if doi:
                    cur2.execute(
                        """
                        INSERT INTO papers (title, authors, year, doi, abstract, source, added_by)
                        VALUES (%s, %s, %s, %s, %s, 'tea_lookup', 'system')
                        ON CONFLICT (doi) WHERE doi IS NOT NULL
                        DO UPDATE SET title = EXCLUDED.title
                        RETURNING paper_id
                        """,
                        (
                            title[:500],
                            (p.get("authors") or "")[:300] or None,
                            p.get("year") or None,
                            doi,
                            (p.get("abstract") or "")[:3000] or None,
                        ),
                    )
                else:
                    cur2.execute(
                        """
                        INSERT INTO papers (title, authors, year, doi, abstract, source, added_by)
                        VALUES (%s, %s, %s, %s, %s, 'tea_lookup', 'system')
                        RETURNING paper_id
                        """,
                        (
                            title[:500],
                            (p.get("authors") or "")[:300] or None,
                            p.get("year") or None,
                            doi,
                            (p.get("abstract") or "")[:3000] or None,
                        ),
                    )
                row = cur2.fetchone()
                if row:
                    paper_id = row[0]
                    linked_paper_ids.append(str(paper_id))
                    cur2.execute(
                        """
                        INSERT INTO compound_opportunity_papers (compound_name, paper_id)
                        VALUES (%s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (output_name, paper_id),
                    )
                cur2.execute("RELEASE SAVEPOINT paper_insert")
            except Exception as exc_p:
                logger.debug("Paper insert failed for '%s': %s", title[:60], exc_p)
                cur2.execute("ROLLBACK TO SAVEPOINT paper_insert")

        conn.commit()
        cur2.close()
        logger.info(
            "run_literature_assumptions_task: '%s' titer=%s confidence=%s papers=%d linked=%d",
            output_name, titer, confidence, len(papers), len(linked_paper_ids),
        )
        return {"status": "queued", "output_name": output_name, "titer_g_l": titer, "confidence": confidence}
    except Exception as exc:
        conn.rollback()
        logger.error("run_literature_assumptions_task failed for '%s': %s", output_name, exc)
        raise
    finally:
        conn.close()


def _log_anthropic_usage(task: str, model: str, input_tokens: int, output_tokens: int):
    try:
        from app.agents.usage_logger import log_anthropic_call
        log_anthropic_call(operation=task, model=model, input_tokens=input_tokens, output_tokens=output_tokens)
    except Exception:
        pass


@celery_app.task(name="app.worker.run_agent_task", bind=True)
def run_agent_task(self):
    from app.tasks.agent_task import run_agent_pipeline
    return run_agent_pipeline()


@celery_app.task(name="app.worker.run_discovery_task", bind=True)
def run_discovery_task(self, substrate_id: int):
    from app.tasks.discovery_task import run_discovery
    return run_discovery(substrate_id)


@celery_app.task(name="app.worker.run_strain_discovery_task", bind=True, max_retries=1)
def run_strain_discovery_task(self, strain_id: str):
    """Mode 1: Enzymatic Potential Mining for a strain."""
    import asyncio
    from app.agents.compound_discovery_agent import scan_strain_biosynthetic_potential
    from app.core.tracer import ExecutionTracer

    logger.info("run_strain_discovery_task: strain=%s", strain_id)
    conn = _get_conn()
    try:
        with ExecutionTracer(
            pipeline="compound_discovery",
            entity_id=strain_id,
            entity_type="strain",
            inputs={"strain_id": strain_id, "mode": "Mode1_enzymatic_potential"},
            triggered_by="celery",
        ) as tracer:
            tracer.step("Fetching strain CAZyme features")
            opportunities = asyncio.run(scan_strain_biosynthetic_potential(strain_id, conn))
            tracer.step("Discovery complete", {"n_opportunities": len(opportunities), "compounds": [o.compound_name for o in opportunities]})
            tracer.set_outputs({"n_opportunities": len(opportunities), "compounds": [o.compound_name for o in opportunities]})
            return {"status": "success", "strain_id": strain_id, "n_opportunities": len(opportunities), "compounds": [o.compound_name for o in opportunities]}
    except Exception as exc:
        logger.exception("run_strain_discovery_task failed for strain %s", strain_id)
        raise self.retry(exc=exc, countdown=60)
    finally:
        conn.close()


@celery_app.task(name="app.worker.run_substrate_discovery_task", bind=True, max_retries=1)
def run_substrate_discovery_task(self, substrate_id: str):
    """Mode 2: Substrate Dark Chemistry for a substrate."""
    import asyncio
    from app.agents.compound_discovery_agent import scan_substrate_dark_chemistry
    from app.core.tracer import ExecutionTracer

    logger.info("run_substrate_discovery_task: substrate=%s", substrate_id)
    conn = _get_conn()
    try:
        with ExecutionTracer(
            pipeline="compound_discovery",
            entity_id=str(substrate_id),
            entity_type="substrate",
            inputs={"substrate_id": str(substrate_id), "mode": "Mode2_substrate_dark_chemistry"},
            triggered_by="celery",
        ) as tracer:
            tracer.step("Analysing substrate composition")
            opportunities = asyncio.run(scan_substrate_dark_chemistry(substrate_id, conn))
            tracer.step("Discovery complete", {"n_opportunities": len(opportunities), "compounds": [o.compound_name for o in opportunities]})
            tracer.set_outputs({"n_opportunities": len(opportunities), "compounds": [o.compound_name for o in opportunities]})
            return {"status": "success", "substrate_id": substrate_id, "n_opportunities": len(opportunities)}
    except Exception as exc:
        logger.exception("run_substrate_discovery_task failed for substrate %s", substrate_id)
        raise self.retry(exc=exc, countdown=60)
    finally:
        conn.close()


@celery_app.task(name="app.worker.run_enzyme_routes_task", bind=True, max_retries=1)
def run_enzyme_routes_task(self, strain_id: str, substrate_id: str):
    """Mode 4: Enzyme-Supplemented Route Discovery for a strain × substrate pair."""
    import asyncio
    from app.agents.compound_discovery_agent import scan_enzyme_unlocked_routes
    from app.core.tracer import ExecutionTracer

    logger.info("run_enzyme_routes_task: strain=%s substrate=%s", strain_id, substrate_id)
    conn = _get_conn()
    try:
        with ExecutionTracer(
            pipeline="compound_discovery",
            entity_id=strain_id,
            entity_type="strain",
            inputs={"strain_id": strain_id, "substrate_id": substrate_id, "mode": "Mode4_enzyme_routes"},
            triggered_by="celery",
        ) as tracer:
            tracer.step("Scanning enzyme-unlocked biosynthetic routes")
            results = asyncio.run(scan_enzyme_unlocked_routes(strain_id, substrate_id, conn))
            tracer.step("Route scan complete", {"n_routes": len(results)})
            tracer.set_outputs({"n_routes": len(results), "compounds": [r["compound_name"] for r in results]})
            return {"status": "success", "strain_id": strain_id, "substrate_id": substrate_id, "n_routes": len(results)}
    except Exception as exc:
        logger.exception("run_enzyme_routes_task failed strain=%s substrate=%s", strain_id, substrate_id)
        raise self.retry(exc=exc, countdown=60)
    finally:
        conn.close()


@celery_app.task(name="app.worker.run_regulatory_task", bind=True)
def run_regulatory_task(self, compound_id: int):
    from app.tasks.regulatory_task import run_regulatory_check
    return run_regulatory_check(compound_id)


@celery_app.task(name="app.worker.on_opportunity_approved_task", bind=True, max_retries=1)
def on_opportunity_approved_task(self, opportunity_id: str):
    """Run full regulatory analysis when a compound opportunity is approved."""
    import asyncio
    from app.agents.regulatory_agent import full_regulatory_analysis
    from app.core.tracer import ExecutionTracer

    logger.info("on_opportunity_approved_task: opportunity=%s", opportunity_id)
    conn = _get_conn()
    try:
        with ExecutionTracer(
            pipeline="regulatory",
            entity_id=opportunity_id,
            entity_type="opportunity",
            inputs={"opportunity_id": opportunity_id},
            triggered_by="approval",
        ) as tracer:
            tracer.step("Starting full regulatory analysis")
            result = asyncio.run(full_regulatory_analysis(opportunity_id, conn))
            tracer.step("Regulatory analysis complete")
            tracer.set_outputs(result if isinstance(result, dict) else {"result": str(result)})
            return result
    except Exception as exc:
        logger.exception("on_opportunity_approved_task failed for %s", opportunity_id)
        raise self.retry(exc=exc, countdown=60)
    finally:
        conn.close()


@celery_app.task(name="app.worker.run_eu_catalogue_refresh", bind=True)
def run_eu_catalogue_refresh(self):
    """Refresh the EU Novel Food catalogue via load_eu_novel_food.py."""
    import subprocess

    script = "/opt/symbio/scripts/load_eu_novel_food.py"
    logger.info("run_eu_catalogue_refresh started")
    result = subprocess.run(
        ["python", script],
        capture_output=True,
        text=True,
        timeout=300,
        env={**__import__("os").environ},
    )
    stdout = result.stdout.strip()
    stderr = result.stderr.strip()
    if result.returncode != 0:
        logger.error("EU catalogue refresh failed (rc=%d):\n%s", result.returncode, stderr)
        raise RuntimeError(f"load_eu_novel_food.py exited {result.returncode}: {stderr[:500]}")
    logger.info("EU catalogue refresh complete:\n%s", stdout or stderr)
    return {"status": "success", "output": stdout or stderr}


@celery_app.task(name="app.worker.generate_rd_plan_task", bind=True)
def generate_rd_plan_task(self, substrate_id: str):
    """Generate an internal R&D plan DOCX for a substrate."""
    result = subprocess.run(
        ["node", "/app/generate_rd_plan.js", str(substrate_id)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"R&D plan generation failed (rc={result.returncode}): {result.stderr[:500]}"
        )
    filepath = result.stdout.strip()
    filename = os.path.basename(filepath)
    logger.info("R&D plan generated: %s", filepath)
    return {"status": "success", "filepath": filepath, "filename": filename}


@celery_app.task(name="app.worker.sync_gmail_contacts_task", bind=True, max_retries=1)
def sync_gmail_contacts_task(self, user_id: str):
    """Sync Gmail interactions for a single user's contacts."""
    from app.tasks.contacts_sync import sync_gmail_contacts
    return sync_gmail_contacts(user_id)


@celery_app.task(name="app.worker.sync_calendar_contacts_task", bind=True, max_retries=1)
def sync_calendar_contacts_task(self, user_id: str):
    """Sync Google Calendar interactions for a single user's contacts."""
    from app.tasks.contacts_sync import sync_calendar_contacts
    return sync_calendar_contacts(user_id)


@celery_app.task(name="app.worker.sync_gmail_contacts_all_users", bind=True)
def sync_gmail_contacts_all_users(self):
    """Hourly: sync Gmail for every user with a connected Google account."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM google_oauth_tokens")
        users = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    for uid in users:
        sync_gmail_contacts_task.delay(str(uid))
    return {"status": "queued", "users": len(users)}


@celery_app.task(name="app.worker.sync_gmail_incremental_task", bind=True, max_retries=1)
def sync_gmail_incremental_task(self, user_id: str):
    """Incremental Gmail sync for a single user using the History API."""
    from app.tasks.contacts_sync import sync_gmail_incremental
    return sync_gmail_incremental(user_id)


@celery_app.task(name="app.worker.sync_gmail_incremental_all_users", bind=True)
def sync_gmail_incremental_all_users(self):
    """Hourly: incremental Gmail sync for every user with a connected Google account."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM google_oauth_tokens")
        users = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    for uid in users:
        sync_gmail_incremental_task.delay(str(uid))
    return {"status": "queued", "users": len(users)}


@celery_app.task(name="app.worker.sync_calendar_contacts_all_users", bind=True)
def sync_calendar_contacts_all_users(self):
    """Hourly: sync Calendar for every user with a connected Google account."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM google_oauth_tokens")
        users = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    for uid in users:
        sync_calendar_contacts_task.delay(str(uid))
    return {"status": "queued", "users": len(users)}



@celery_app.task(name="app.worker.refresh_contact_summaries_task", bind=True)
def refresh_contact_summaries_task(self):
    """Nightly: refresh stale AI summaries for contacts with interactions."""
    from app.tasks.contacts_sync import refresh_stale_summaries
    return refresh_stale_summaries()


@celery_app.task(name="app.worker.enrich_contact_task", bind=True, max_retries=1)
def enrich_contact_task(self, contact_id: str):
    """Enrich a contact record with Semantic Scholar + Claude."""
    from app.tasks.contacts_sync import enrich_contact
    return enrich_contact(contact_id)


@celery_app.task(name="app.worker.summarize_contact_task", bind=True, max_retries=1)
def summarize_contact_task(self, contact_id: str):
    """Generate or refresh AI summary for a contact."""
    from app.tasks.contacts_sync import summarize_contact
    return summarize_contact(contact_id)


@celery_app.task(name="app.worker.infer_relationships_task", bind=True, max_retries=1)
def infer_relationships_task(self):
    """Infer contact relationships from email co-occurrence patterns."""
    from app.tasks.contacts_sync import infer_relationships_from_emails
    return infer_relationships_from_emails()


@celery_app.task(name="app.worker.sync_google_contacts_inbound_task", bind=True, max_retries=1)
def sync_google_contacts_inbound_task(self, user_id: str):
    """Pull Google Contacts for one user — update existing records, queue unknowns as pending."""
    from app.tasks.contacts_sync import sync_google_contacts_inbound
    return sync_google_contacts_inbound(user_id)


@celery_app.task(name="app.worker.sync_google_contacts_inbound_all_users", bind=True)
def sync_google_contacts_inbound_all_users(self):
    """Daily: inbound Google Contacts sync for every user with a connected account."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM google_oauth_tokens")
        users = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    for uid in users:
        sync_google_contacts_inbound_task.delay(str(uid))
    return {"status": "queued", "users": len(users)}


@celery_app.task(name="app.worker.push_contact_to_google_task", bind=True, max_retries=2)
def push_contact_to_google_task(self, contact_id: str):
    """Push a single platform contact to all users' Google Contacts."""
    from app.tasks.contacts_sync import push_contact_to_google
    return push_contact_to_google(contact_id)


# ---------------------------------------------------------------------------
# Notes: AI analysis task
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.analyze_note_task", bind=True, max_retries=1)
def analyze_note_task(self, note_id: str):
    """Run Claude analysis on a note's raw transcript to extract summary,
    action items, decisions, and follow-ups."""
    import re
    import json as _json
    import anthropic
    from app.core.tracer import ExecutionTracer

    logger.info("analyze_note_task: note=%s", note_id)
    conn = _get_conn()
    try:
        with ExecutionTracer(
            pipeline="note_analysis",
            entity_id=note_id,
            entity_type="note",
            inputs={"note_id": note_id},
            triggered_by="user",
        ) as tracer:
            cur = conn.cursor()
            cur.execute(
                "SELECT note_id, title, raw_transcript FROM notes WHERE note_id = %s::uuid",
                (note_id,),
            )
            row = cur.fetchone()
            if not row:
                logger.warning("analyze_note_task: note %s not found", note_id)
                tracer.step("Note not found — skipping")
                return {"status": "skipped", "reason": "not_found"}

            note_id_val, title, transcript = row
            if not transcript:
                cur.execute(
                    "UPDATE notes SET ai_status = 'error', updated_at = now() WHERE note_id = %s::uuid",
                    (note_id,),
                )
                conn.commit()
                tracer.step("No transcript — skipping")
                return {"status": "skipped", "reason": "no_transcript"}

            tracer.step("Fetched note from DB", {"title": title, "transcript_chars": len(transcript)})

            cur.execute(
                "UPDATE notes SET ai_status = 'processing', updated_at = now() WHERE note_id = %s::uuid",
                (note_id,),
            )
            conn.commit()

            client = anthropic.Anthropic()
            prompt = f"""Analyze this meeting or session transcript and extract structured information.

Meeting title: {title or "Untitled"}
Transcript:
{transcript[:12000]}

Return ONLY a valid JSON object with exactly these fields:
{{
  "summary": "2-3 paragraph prose summary of what was discussed and any outcomes",
  "action_items": [
    {{"title": "concise action title", "description": "brief details of what needs to be done", "assignee_hint": "person name or null"}}
  ],
  "decisions": [
    {{"decision": "what was decided", "context": "brief rationale"}}
  ],
  "follow_ups": ["string", "string"]
}}"""

            tracer.step("Sending transcript to Claude", {"model": "claude-sonnet-4-6", "prompt_chars": len(prompt)})
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip() if response.content else ""
            tracer.step("Claude response received", {"output_tokens": response.usage.output_tokens if hasattr(response, 'usage') else 0, "response_chars": len(raw)})

            # Strip markdown fences if present
            fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
            if fence:
                raw = fence.group(1).strip()
            start = raw.find("{")
            end = raw.rfind("}")
            if start == -1 or end == -1:
                raise ValueError(f"No JSON object in Claude response: {raw[:200]}")
            parsed = _json.loads(raw[start:end + 1])
            tracer.step("Response parsed", {
                "action_items": len(parsed.get("action_items", [])),
                "decisions": len(parsed.get("decisions", [])),
                "follow_ups": len(parsed.get("follow_ups", [])),
            })

            cur.execute(
                """
                UPDATE notes SET
                    ai_summary   = %s,
                    action_items = %s::jsonb,
                    decisions    = %s::jsonb,
                    follow_ups   = %s::jsonb,
                    ai_status    = 'done',
                    updated_at   = now()
                WHERE note_id = %s::uuid
                """,
                (
                    parsed.get("summary"),
                    _json.dumps(parsed.get("action_items", [])),
                    _json.dumps(parsed.get("decisions", [])),
                    _json.dumps(parsed.get("follow_ups", [])),
                    note_id,
                ),
            )
            conn.commit()
            tracer.step("DB updated — analysis complete")
            tracer.set_outputs({
                "action_items": len(parsed.get("action_items", [])),
                "decisions": len(parsed.get("decisions", [])),
            })
            logger.info("analyze_note_task complete: note=%s", note_id)
            return {
                "status": "done",
                "action_items": len(parsed.get("action_items", [])),
                "decisions": len(parsed.get("decisions", [])),
            }

    except Exception as exc:
        logger.exception("analyze_note_task failed for note %s", note_id)
        try:
            conn.rollback()
            cur2 = conn.cursor()
            cur2.execute(
                "UPDATE notes SET ai_status = 'error', updated_at = now() WHERE note_id = %s::uuid",
                (note_id,),
            )
            conn.commit()
        except Exception:
            pass
        raise self.retry(exc=exc, countdown=30)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Unified entries: AI analysis task (eln_entries table)
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.analyze_entry_task", bind=True, max_retries=1)
def analyze_entry_task(self, entry_id: str):
    """Run Claude analysis on a notebook entry's raw transcript."""
    import re
    import json as _json
    import anthropic
    from app.core.tracer import ExecutionTracer

    logger.info("analyze_entry_task: entry=%s", entry_id)
    conn = _get_conn()
    try:
        with ExecutionTracer(
            pipeline="entry_analysis",
            entity_id=entry_id,
            entity_type="eln_entry",
            inputs={"entry_id": entry_id},
            triggered_by="user",
        ) as tracer:
            cur = conn.cursor()
            cur.execute(
                "SELECT entry_id, title, raw_transcript FROM eln_entries WHERE entry_id = %s::uuid",
                (entry_id,),
            )
            row = cur.fetchone()
            if not row:
                logger.warning("analyze_entry_task: entry %s not found", entry_id)
                tracer.step("Entry not found — skipping")
                return {"status": "skipped", "reason": "not_found"}

            entry_id_val, title, transcript = row
            if not transcript:
                cur.execute(
                    "UPDATE eln_entries SET ai_status = 'error', updated_at = now() WHERE entry_id = %s::uuid",
                    (entry_id,),
                )
                conn.commit()
                tracer.step("No transcript — skipping")
                return {"status": "skipped", "reason": "no_transcript"}

            tracer.step("Fetched entry from DB", {"title": title, "transcript_chars": len(transcript)})

            cur.execute(
                "UPDATE eln_entries SET ai_status = 'processing', updated_at = now() WHERE entry_id = %s::uuid",
                (entry_id,),
            )
            conn.commit()

            client = anthropic.Anthropic()
            prompt = f"""Analyze this meeting or session transcript and extract structured information.

Meeting title: {title or "Untitled"}
Transcript:
{transcript[:12000]}

Return ONLY a valid JSON object with exactly these fields:
{{
  "summary": "2-3 paragraph prose summary of what was discussed and any outcomes",
  "action_items": [
    {{"title": "concise action title", "description": "brief details", "assignee_hint": "person name or null"}}
  ],
  "decisions": [
    {{"title": "decision made", "rationale": "brief reason or null"}}
  ],
  "follow_ups": [
    {{"item": "follow-up item", "deadline": "date string or null"}}
  ]
}}"""

            tracer.step("Sending transcript to Claude", {"model": "claude-sonnet-4-6", "prompt_chars": len(prompt)})
            msg = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = msg.content[0].text.strip()
            tracer.step("Claude response received", {"output_tokens": msg.usage.output_tokens if hasattr(msg, 'usage') else 0, "response_chars": len(raw)})

            fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
            if fence:
                raw = fence.group(1).strip()
            start = raw.find("{")
            end = raw.rfind("}")
            if start == -1 or end == -1:
                raise ValueError(f"No JSON in Claude response: {raw[:200]}")
            parsed = _json.loads(raw[start:end + 1])
            tracer.step("Response parsed", {
                "action_items": len(parsed.get("action_items", [])),
                "decisions": len(parsed.get("decisions", [])),
                "follow_ups": len(parsed.get("follow_ups", [])),
            })

            cur.execute(
                """
                UPDATE eln_entries SET
                    ai_summary   = %s,
                    action_items = %s::jsonb,
                    decisions    = %s::jsonb,
                    follow_ups   = %s::jsonb,
                    ai_status    = 'done',
                    updated_at   = now()
                WHERE entry_id = %s::uuid
                """,
                (
                    parsed.get("summary"),
                    _json.dumps(parsed.get("action_items", [])),
                    _json.dumps(parsed.get("decisions", [])),
                    _json.dumps(parsed.get("follow_ups", [])),
                    entry_id,
                ),
            )
            conn.commit()
            tracer.step("DB updated — analysis complete")
            tracer.set_outputs({
                "action_items": len(parsed.get("action_items", [])),
                "decisions": len(parsed.get("decisions", [])),
            })
            logger.info("analyze_entry_task complete: entry=%s", entry_id)
            return {
                "status": "done",
                "action_items": len(parsed.get("action_items", [])),
                "decisions": len(parsed.get("decisions", [])),
            }

    except Exception as exc:
        logger.exception("analyze_entry_task failed for entry %s", entry_id)
        try:
            conn.rollback()
            cur2 = conn.cursor()
            cur2.execute(
                "UPDATE eln_entries SET ai_status = 'error', updated_at = now() WHERE entry_id = %s::uuid",
                (entry_id,),
            )
            conn.commit()
        except Exception:
            pass
        raise self.retry(exc=exc, countdown=30)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tasks: Google Docs sync
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.sync_entry_gdoc_task", bind=True, max_retries=2)
def sync_entry_gdoc_task(self, entry_id: str, user_id: str):
    """Background: push updated notebook entry content to its linked Google Doc."""
    import re
    import httpx as _httpx

    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT title, body, objective, observations, results, conclusions, entry_type, gdoc_id FROM eln_entries WHERE entry_id = %s::uuid AND is_deleted = false",
            (entry_id,),
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        return {"status": "skipped", "reason": "not_found"}

    title, body, objective, observations, results, conclusions, entry_type, gdoc_id = row
    if not gdoc_id:
        return {"status": "skipped", "reason": "no_gdoc_id"}

    try:
        from app.routers.drive import _get_token
        token = _get_token(user_id)
    except Exception:
        return {"status": "skipped", "reason": "no_google_token"}

    def strip_html(html: str) -> str:
        if not html:
            return ""
        text = re.sub(r'<br\s*/?>', '\n', html or "")
        text = re.sub(r'</p>|</h[1-6]>|</li>|</tr>', '\n', text)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'&amp;', '&', text)
        text = re.sub(r'&lt;', '<', text)
        text = re.sub(r'&gt;', '>', text)
        text = re.sub(r'&nbsp;', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    sections = [f"# {title or 'Untitled Entry'}\n"]
    if entry_type == "experiment":
        for field_val, label in [(objective, "Objective"), (observations, "Observations"), (results, "Results"), (conclusions, "Conclusions")]:
            if field_val:
                sections.append(f"\n## {label}\n{strip_html(field_val)}")
    else:
        if body:
            sections.append(f"\n{strip_html(body)}")

    content = "\n".join(sections)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        doc_res = _httpx.get(f"https://docs.googleapis.com/v1/documents/{gdoc_id}", headers=headers, timeout=15)
        if doc_res.status_code != 200:
            return {"status": "error", "reason": "doc_fetch_failed"}
        end_index = doc_res.json().get("body", {}).get("content", [{}])[-1].get("endIndex", 2)
        if end_index > 2:
            _httpx.post(
                f"https://docs.googleapis.com/v1/documents/{gdoc_id}:batchUpdate",
                headers=headers,
                json={"requests": [{"deleteContentRange": {"range": {"startIndex": 1, "endIndex": end_index - 1}}}]},
                timeout=15,
            )
        _httpx.post(
            f"https://docs.googleapis.com/v1/documents/{gdoc_id}:batchUpdate",
            headers=headers,
            json={"requests": [{"insertText": {"location": {"index": 1}, "text": content}}]},
            timeout=15,
        )
        logger.info("sync_entry_gdoc_task: synced entry=%s to gdoc=%s", entry_id, gdoc_id)
        return {"status": "ok"}
    except Exception as exc:
        logger.warning("sync_entry_gdoc_task failed: %s", exc)
        raise self.retry(exc=exc, countdown=30)


# ---------------------------------------------------------------------------
# Tasks: due-date reminders
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.send_task_due_reminders", bind=True)
def send_task_due_reminders(self):
    """Daily: log overdue open tasks (placeholder for email/notification delivery)."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT COUNT(*) FROM tasks
            WHERE status = 'open'
              AND due_date < CURRENT_DATE
            """
        )
        overdue = cur.fetchone()[0]
        logger.info("send_task_due_reminders: %d overdue tasks", overdue)
        return {"status": "ok", "overdue": overdue}
    finally:
        conn.close()


@celery_app.task(name="app.worker.scan_email_suggestions_all_users", bind=True)
def scan_email_suggestions_all_users(self):
    """Every 4 hours: scan inbox emails for all connected users and notify on new suggestions."""
    from app.routers.email import scan_and_notify_user

    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id::text FROM google_oauth_tokens")
        user_ids = [r[0] for r in cur.fetchall()]
    except Exception as e:
        logger.error("scan_email_suggestions_all_users: failed to load users: %s", e)
        return {"status": "error"}
    finally:
        conn.close()

    logger.info("scan_email_suggestions_all_users: scanning %d users", len(user_ids))
    results = {}
    for uid in user_ids:
        try:
            count = scan_and_notify_user(uid)
            results[uid] = count
        except Exception as e:
            logger.warning("scan failed for user %s: %s", uid, e)
            results[uid] = -1

    logger.info("scan_email_suggestions_all_users: done %s", results)
    return {"status": "ok", "results": results}


@celery_app.task(name="app.worker.run_rnd_estimate_task", bind=True, max_retries=1)
def run_rnd_estimate_task(self, opportunity_id: str):
    """Run the R&D timeline and capital estimator for a compound opportunity."""
    from app.agents.rnd_estimator import run_rnd_estimate

    logger.info("run_rnd_estimate_task: opportunity=%s", opportunity_id)
    conn = _get_conn()
    try:
        result = run_rnd_estimate(opportunity_id, conn)
        return result
    except Exception as exc:
        logger.exception("run_rnd_estimate_task failed for %s", opportunity_id)
        raise self.retry(exc=exc, countdown=30)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Plaid actuals sync task
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.sync_plaid_actuals", bind=True, max_retries=2)
def sync_plaid_actuals(self):
    """Daily pull of Plaid bank data to update FP&A actuals (runs at 07:00 UTC)."""
    from app.routers.fpa import _do_plaid_sync

    logger.info("sync_plaid_actuals started")
    try:
        result = _do_plaid_sync()
        logger.info(
            "sync_plaid_actuals complete: cash=%.2f net_burn=%.2f",
            result["cash_balance"],
            result["net_burn"],
        )
        return result
    except Exception as exc:
        logger.exception("sync_plaid_actuals failed")
        raise self.retry(exc=exc, countdown=300)


@celery_app.task(name="app.worker.sync_qbo_actuals", bind=True, max_retries=2)
def sync_qbo_actuals(self):
    """Daily pull of QBO P&L data for projected vs actual comparison (runs at 07:15 UTC)."""
    from app.routers.fpa import _do_qbo_sync

    logger.info("sync_qbo_actuals started")
    try:
        monthly = _do_qbo_sync("monthly")
        weekly = _do_qbo_sync("weekly")
        quarterly = _do_qbo_sync("quarterly")
        yearly = _do_qbo_sync("yearly")
        logger.info("sync_qbo_actuals complete: %d monthly, %d weekly, %d quarterly, %d yearly",
                    len(monthly), len(weekly), len(quarterly), len(yearly))
        return {"monthly": len(monthly), "weekly": len(weekly), "quarterly": len(quarterly), "yearly": len(yearly)}
    except Exception as exc:
        # Don't retry if QBO isn't connected yet
        if "not connected" in str(exc).lower():
            logger.info("sync_qbo_actuals skipped: QBO not connected")
            return {"status": "skipped"}
        logger.exception("sync_qbo_actuals failed")
        raise self.retry(exc=exc, countdown=300)


# ---------------------------------------------------------------------------
# AI Planner tasks
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.generate_daily_plans_all_users", bind=True)
def generate_daily_plans_all_users(self):
    """06:00 CST daily: generate AI daily plan for every user with a Google token."""
    from datetime import date as _date
    from app.routers.planner import run_daily_plan

    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM google_oauth_tokens")
        users = [str(r[0]) for r in cur.fetchall()]
    finally:
        conn.close()

    results = []
    today = _date.today()
    for uid in users:
        try:
            conn2 = _get_conn()
            result = run_daily_plan(conn2, uid, today, force=False)
            conn2.close()
            results.append({"user_id": uid, "status": "ok", "plan_id": result.get("plan_id")})
            logger.info("generate_daily_plans_all_users: user=%s done", uid)
        except Exception as exc:
            logger.exception("generate_daily_plans_all_users: user=%s failed", uid)
            results.append({"user_id": uid, "status": "error", "error": str(exc)})

    return {"users": len(users), "results": results}


@celery_app.task(name="app.worker.generate_weekly_plans_all_users", bind=True)
def generate_weekly_plans_all_users(self):
    """06:00 CST Monday: generate AI weekly plan for every user with a Google token."""
    from datetime import date as _date, timedelta as _td
    from app.routers.planner import run_weekly_plan

    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM google_oauth_tokens")
        users = [str(r[0]) for r in cur.fetchall()]
    finally:
        conn.close()

    today = _date.today()
    # week_start = most recent Monday
    week_start = today - _td(days=today.weekday())

    results = []
    for uid in users:
        try:
            conn2 = _get_conn()
            result = run_weekly_plan(conn2, uid, week_start, force=False)
            conn2.close()
            results.append({"user_id": uid, "status": "ok", "plan_id": result.get("plan_id")})
            logger.info("generate_weekly_plans_all_users: user=%s done", uid)
        except Exception as exc:
            logger.exception("generate_weekly_plans_all_users: user=%s failed", uid)
            results.append({"user_id": uid, "status": "error", "error": str(exc)})

    return {"users": len(users), "results": results}


@celery_app.task(name="app.worker.rollover_incomplete_blocks", bind=True)
def rollover_incomplete_blocks(self):
    """17:30 CST daily: mark unstarted draft blocks as 'skipped' for the day.

    Blocks that are still in 'draft' status at end of day are marked skipped.
    Confirmed blocks that weren't completed are left as-is for reporting.
    """
    from datetime import date as _date

    conn = _get_conn()
    try:
        cur = conn.cursor()
        today = _date.today()
        cur.execute("""
            UPDATE plan_blocks
            SET status = 'skipped'
            WHERE status = 'draft'
              AND plan_id IN (
                  SELECT plan_id FROM daily_plans WHERE plan_date = %s
              )
        """, (today,))
        skipped = cur.rowcount
        conn.commit()
        logger.info("rollover_incomplete_blocks: %d blocks skipped for %s", skipped, today)
        return {"status": "ok", "skipped": skipped, "date": str(today)}
    except Exception as exc:
        logger.exception("rollover_incomplete_blocks failed")
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# RAG embedding tasks
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.embed_content_task", bind=True, max_retries=2)
def embed_content_task(self, source_table: str, source_id: str, user_id: str | None = None):
    """Embed a single content item into context_chunks."""
    from app.tasks.embed_task import embed_content
    try:
        return embed_content(source_table, source_id, user_id=user_id)
    except Exception as exc:
        logger.exception("embed_content_task failed: %s/%s", source_table, source_id)
        raise self.retry(exc=exc, countdown=60)


@celery_app.task(name="app.worker.backfill_all_embeddings", bind=True)
def backfill_all_embeddings(self, user_id: str | None = None):
    """One-shot: embed every row in all source tables (run once after migration)."""
    from app.tasks.embed_task import backfill_all
    logger.info("backfill_all_embeddings started (user_id=%s)", user_id)
    result = backfill_all(user_id=user_id)
    logger.info("backfill_all_embeddings complete: %s", result)
    return result


@celery_app.task(name="app.worker.nightly_embed_task", bind=True)
def nightly_embed_task(self):
    """Nightly: re-embed rows updated in the last 25 hours (catches missed triggers)."""
    from app.tasks.embed_task import embed_content

    conn = _get_conn()
    try:
        cur = conn.cursor()
        # Tables with user_id and tables without
        table_pks = {
            "notes": ("note_id", True),
            "eln_entries": ("entry_id", True),
            "papers": ("paper_id", False),
            "contacts": ("contact_id", False),
            "tasks": ("task_id", True),
        }
        total = 0
        for table, (pk_col, has_user_id) in table_pks.items():
            user_col = f", user_id::text" if has_user_id else ", NULL::text"
            cur.execute(
                f"SELECT {pk_col}::text{user_col} FROM {table} "
                f"WHERE updated_at > now() - interval '25 hours'"
            )
            rows = cur.fetchall()
            for sid, uid in rows:
                embed_content_task.delay(table, sid, uid)
                total += 1
        logger.info("nightly_embed_task: queued %d items", total)
        return {"status": "ok", "queued": total}
    finally:
        conn.close()


@celery_app.task(name="app.worker.run_composition_research_task", bind=True, max_retries=1)
def run_composition_research_task(self, substrate_id: str, substrate_name: str):
    """Research substrate composition from platform papers, USDA, and literature.

    All found values are persisted to substrate_composition_sources with full provenance.
    Updates the substrates table with the best available values.
    """
    import asyncio
    from app.agents.composition_agent import research_substrate_composition

    logger.info("Composition research task: %s (%s)", substrate_name, substrate_id)
    try:
        result = asyncio.run(
            research_substrate_composition(substrate_name, substrate_id=substrate_id)
        )

        # Update substrates table with consensus values — always overwrite stale data
        conn = _get_conn()
        try:
            cur = conn.cursor()
            composition = result.get("composition", {})
            from app.agents.composition_agent import COMPOSITION_FIELDS as _COMP_FIELDS
            _valid_fields = set(_COMP_FIELDS)
            update_fields = []
            update_values = []
            for field, fdata in composition.items():
                if field not in _valid_fields:
                    continue
                if fdata.get("value") is not None:
                    update_fields.append(f"{field} = %s")
                    update_values.append(fdata["value"])

            if update_fields:
                update_values.append(substrate_id)
                cur.execute(
                    f"UPDATE substrates SET {', '.join(update_fields)} WHERE substrate_id = %s",
                    update_values,
                )
                conn.commit()
                logger.info("Updated %d composition fields for %s", len(update_fields), substrate_name)
        finally:
            conn.close()

        fields_found = sum(1 for v in result.get("composition", {}).values() if v.get("value") is not None)

        # Trigger TEA now that composition data is persisted
        celery_app.send_task("app.worker.run_tea_task", args=[substrate_id])
        logger.info("Queued TEA task for substrate %s after composition research (%d fields)", substrate_id, fields_found)

        return {
            "status": "complete",
            "substrate_name": substrate_name,
            "search_quality": result.get("search_quality"),
            "sources_searched": result.get("sources_searched", []),
            "fields_found": fields_found,
        }
    except Exception as exc:
        logger.error("Composition research failed for %s: %s", substrate_name, exc)
        # Still attempt TEA even if composition research failed (substrate may have manually entered data)
        celery_app.send_task("app.worker.run_tea_task", args=[substrate_id])


@celery_app.task(name="app.worker.extract_paper_task", bind=True, max_retries=1, time_limit=300)
def extract_paper_task(self, paper_id: str):
    """Extract structured records from a single paper and insert into staging_queue.

    Safe to re-run — deduplicates by fingerprint. Called by the backfill endpoint.
    """
    import asyncio, hashlib, json as _json
    import psycopg2.extras as _pg_extras
    from app.agents.extraction_agent import extract_chunked
    from app.agents.fuzzy_matcher import EntityMatcher

    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=_pg_extras.RealDictCursor)
        cur.execute(
            "SELECT paper_id, title, doi, pdf_path, full_text, abstract, journal, year FROM papers WHERE paper_id = %s",
            (paper_id,),
        )
        row = cur.fetchone()
        if not row:
            return {"status": "not_found", "paper_id": paper_id}
        paper = dict(row)

        def _fp(rec):
            key = _json.dumps({
                "dt": rec.get("data_type"), "tv": rec.get("titer_value"),
                "ec": (rec.get("enzyme_class") or rec.get("enzyme_name") or "")[:30],
                "sn": (rec.get("strain_name") or rec.get("organism") or "")[:30],
                "sb": (rec.get("substrate") or rec.get("substrate_tested") or "")[:30],
                "ft": rec.get("fermentation_type"),
            }, sort_keys=True)
            return hashlib.md5(key.encode()).hexdigest()

        cur.execute("SELECT payload FROM staging_queue WHERE paper_id = %s", (paper_id,))
        existing_fps = {_fp(r["payload"]) for r in cur.fetchall()}

        paper_payload = {
            "title": paper.get("title") or "",
            "abstract": paper.get("abstract") or "",
            "full_text": paper.get("full_text") or paper.get("abstract") or "",
            "doi": paper.get("doi"),
            "year": paper.get("year"),
            "journal": paper.get("journal"),
        }

        records = asyncio.run(extract_chunked(paper_payload))
        new_records = [r for r in records if r.get("data_type") != "protocol" and _fp(r) not in existing_fps]

        # Generate summary regardless of whether new records were found
        cur.execute("SELECT paper_summary FROM papers WHERE paper_id = %s", (paper_id,))
        _sr = cur.fetchone()
        if not (_sr and _sr.get("paper_summary")):
            try:
                from app.agents.paper_summary_agent import summarize as _summarize
                _summary = asyncio.run(_summarize(paper_payload))
                if _summary.get("paper_summary"):
                    cur.execute(
                        """UPDATE papers SET paper_summary = %s, key_findings = %s, research_gaps = %s
                           WHERE paper_id = %s""",
                        (_summary.get("paper_summary"), _summary.get("key_findings"),
                         _summary.get("research_gaps"), paper_id),
                    )
                    conn.commit()
                    logger.info("extract_paper_task: generated summary for paper_id=%s", paper_id[:8])
            except Exception as _se:
                logger.warning("extract_paper_task: summary failed for paper_id=%s: %s", paper_id[:8], _se)

        if not new_records:
            cur.execute(
                "UPDATE papers SET last_extracted_at = COALESCE(last_extracted_at, NOW()) WHERE paper_id = %s",
                (paper_id,),
            )
            conn.commit()
            return {"status": "no_new_records", "paper_id": paper_id, "total_extracted": len(records)}

        matcher = EntityMatcher(conn=conn)
        added = 0
        for rec in new_records:
            raw_strain = rec.get("strain_name") or rec.get("organism") or ""
            raw_substrate = rec.get("substrate") or rec.get("substrate_tested") or ""
            strain_match = matcher.match_strain(raw_strain)
            substrate_match = matcher.match_substrate(raw_substrate)

            def _resolve(table, id_col, name_col, name):
                if not name:
                    return None
                cur.execute(f"SELECT {id_col} FROM {table} WHERE lower({name_col}) = lower(%s)", (name,))
                r = cur.fetchone()
                return str(r[id_col]) if r else None

            strain_uuid = _resolve("strains", "strain_id", "name", strain_match.matched_id)
            substrate_uuid = _resolve("substrates", "substrate_id", "name", substrate_match.matched_id)

            _eng_class = rec.get("strain_engineering_class") or "unknown"
            if _eng_class not in ("wild_type", "mutant", "recombinant", "unknown"):
                _eng_class = "unknown"
            _tier = getattr(strain_match, "tier", "unmatched") if strain_uuid else "unmatched"
            cur.execute(
                """
                INSERT INTO staging_queue (
                    data_type, source, trust_level, payload, confidence,
                    strain_name_raw, strain_id_matched, strain_match_score,
                    substrate_name_raw, substrate_id_matched, substrate_match_score,
                    strain_unmatched, substrate_unmatched, unit_ambiguous,
                    strain_specificity, paper_id, strain_engineering_class,
                    strain_match_tier, strain_match_confidence
                ) VALUES (
                    %s, 'backfill', 'human_review', %s::jsonb, %s,
                    %s, %s::uuid, %s,
                    %s, %s::uuid, %s,
                    %s, %s, false,
                    %s, %s::uuid, %s,
                    %s, %s
                )
                ON CONFLICT DO NOTHING
                RETURNING queue_id
                """,
                (
                    rec.get("data_type", "fermentation_run"),
                    _json.dumps(rec), rec.get("confidence"),
                    raw_strain or None, strain_uuid, strain_match.score,
                    raw_substrate or None, substrate_uuid, substrate_match.score,
                    strain_uuid is None, substrate_uuid is None,
                    "species_level" if strain_match.method in ("species_level", "collection") and getattr(strain_match, "tier", "") in ("species_proxy", "genus_proxy") else "strain_level",
                    paper_id, _eng_class,
                    _tier, strain_match.score if strain_uuid else None,
                ),
            )
            qrow = cur.fetchone()
            if qrow:
                added += 1
                cur.execute(
                    "INSERT INTO paper_extractions (paper_id, queue_id) VALUES (%s::uuid, %s::uuid) ON CONFLICT DO NOTHING",
                    (paper_id, str(qrow["queue_id"])),
                )

        cur.execute(
            "UPDATE papers SET last_extracted_at = NOW() WHERE paper_id = %s",
            (paper_id,),
        )
        conn.commit()
        logger.info("extract_paper_task: paper_id=%s added %d/%d records", paper_id[:8], added, len(records))
        return {"status": "success", "paper_id": paper_id, "added": added, "total_extracted": len(records)}

    except Exception as exc:
        logger.error("extract_paper_task failed for paper_id=%s: %s", paper_id, exc)
        conn.rollback()
        raise self.retry(exc=exc, countdown=60)
    finally:
        conn.close()


@celery_app.task(name="app.worker.backfill_extractions_task", bind=True)
def backfill_extractions_task(self, limit: int = 20):
    """Queue extract_paper_task for up to `limit` unextracted papers."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT paper_id FROM papers
            WHERE (archived IS NULL OR archived = false)
              AND last_extracted_at IS NULL
              AND (char_length(full_text) > 500 OR char_length(abstract) > 200)
            ORDER BY char_length(full_text) DESC NULLS LAST, added_at ASC
            LIMIT %s
            """,
            (limit,),
        )
        ids = [str(r[0]) for r in cur.fetchall()]
    finally:
        conn.close()

    for pid in ids:
        extract_paper_task.delay(pid)

    logger.info("backfill_extractions_task: queued %d papers", len(ids))
    return {"status": "queued", "n_papers": len(ids)}


# ---------------------------------------------------------------------------
# antiSMASH annotation task
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.run_antismash_task", bind=True, max_retries=1)
def run_antismash_task(self, strain_id: str, protein_faa: str):
    """Run antiSMASH 7 BGC annotation for a single strain and persist results."""
    from app.annotation.antismash_client import run_antismash_annotation

    conn = _get_conn()
    try:
        result = run_antismash_annotation(strain_id, protein_faa)
        if result.get("status") != "success":
            logger.error("run_antismash_task failed for strain %s: %s", strain_id, result.get("reason"))
            return result

        # Import write helpers from parse_annotations (on host, not container)
        import sys, os
        sys.path.insert(0, "/opt/symbio/annotation")
        from parse_annotations import write_bgc_clusters

        clusters = result.get("clusters", [])
        write_bgc_clusters(strain_id, clusters, conn)

        cur = conn.cursor()
        cur.execute(
            """
            UPDATE strains SET
                bgc_count          = %s,
                bgc_types          = %s,
                bgc_safety_flagged = %s,
                bgc_annotated_at   = NOW(),
                antismash_version  = '7.1.0'
            WHERE strain_id = %s
            """,
            (
                result["bgc_count"],
                result["bgc_types"],
                result["safety_flagged"],
                strain_id,
            ),
        )
        conn.commit()
        cur.close()
        logger.info(
            "run_antismash_task complete: strain=%s bgc_count=%d safety_flagged=%s",
            strain_id, result["bgc_count"], result["safety_flagged"],
        )
        return {
            "status": "success",
            "strain_id": strain_id,
            "bgc_count": result["bgc_count"],
            "safety_flagged": result["safety_flagged"],
        }
    except Exception as exc:
        conn.rollback()
        logger.exception("run_antismash_task failed for strain %s", strain_id)
        raise self.retry(exc=exc, countdown=120)
    finally:
        conn.close()


@celery_app.task(name="app.worker.flag_bgc_safety_task", bind=True)
def flag_bgc_safety_task(self):
    """Scan all bgc_clusters rows and set safety flags on strains table.

    Runs nightly; updates strains.bgc_safety_flagged based on cluster-level flags.
    """
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE strains s
            SET bgc_safety_flagged = EXISTS (
                SELECT 1 FROM bgc_clusters bc
                WHERE bc.strain_id = s.strain_id
                  AND bc.safety_flag IS NOT NULL
            )
            WHERE s.bgc_annotated_at IS NOT NULL
            """
        )
        updated = cur.rowcount
        conn.commit()
        cur.close()
        logger.info("flag_bgc_safety_task: updated safety flags on %d strains", updated)
        return {"status": "success", "strains_updated": updated}
    except Exception as exc:
        conn.rollback()
        logger.exception("flag_bgc_safety_task failed")
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tasks: Granola meeting notes auto-sync
# ---------------------------------------------------------------------------

@celery_app.task(name="app.worker.sync_granola_notes_task")
def sync_granola_notes_task():
    """Poll Granola API for new meeting notes and create eln_entries automatically."""
    import uuid as _uuid
    import json as _json
    from datetime import datetime, timezone
    import requests as _req
    import redis as _redis_lib
    import markdown as _md

    api_key = os.environ.get("GRANOLA_API_KEY", "")
    user_email = os.environ.get("GRANOLA_SYNC_USER_EMAIL", "")
    if not api_key or not user_email:
        logger.warning("sync_granola_notes_task: GRANOLA_API_KEY or GRANOLA_SYNC_USER_EMAIL not set — skipping")
        return {"status": "skipped", "reason": "not_configured"}

    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    r = _redis_lib.from_url(redis_url)

    conn = _get_conn()
    try:
        cur = conn.cursor()

        # Resolve platform user
        cur.execute("SELECT user_id FROM users WHERE email = %s AND is_active = true LIMIT 1", (user_email,))
        row = cur.fetchone()
        if not row:
            logger.warning("sync_granola_notes_task: user %s not found", user_email)
            return {"status": "skipped", "reason": "user_not_found"}
        user_id = str(row[0])

        # Find or create a "Granola" notebook for this user
        cur.execute(
            "SELECT notebook_id FROM eln_notebooks WHERE user_id = %s::uuid AND name = 'Granola' AND is_deleted = false LIMIT 1",
            (user_id,),
        )
        nb_row = cur.fetchone()
        if nb_row:
            notebook_id = str(nb_row[0])
        else:
            notebook_id = str(_uuid.uuid4())
            cur.execute(
                "INSERT INTO eln_notebooks (notebook_id, user_id, name, description, color, is_shared, is_deleted, created_at, updated_at) "
                "VALUES (%s::uuid, %s::uuid, 'Granola', 'Auto-synced meeting notes from Granola', '#10b981', false, false, now(), now())",
                (notebook_id, user_id),
            )
            conn.commit()
            logger.info("sync_granola_notes_task: created Granola notebook %s for user %s", notebook_id, user_id)

        # Determine created_after from last sync timestamp stored in Redis
        last_sync_key = f"granola:last_sync:{user_id}"
        last_sync_raw = r.get(last_sync_key)
        created_after = last_sync_raw.decode() if last_sync_raw else None

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        imported_key = f"granola:imported:{user_id}"

        imported_count = 0
        cursor = None

        while True:
            params: dict = {}
            if created_after:
                params["created_after"] = created_after
            if cursor:
                params["cursor"] = cursor

            resp = _req.get("https://public-api.granola.ai/v1/notes", headers=headers, params=params, timeout=15)
            if resp.status_code == 401:
                logger.error("sync_granola_notes_task: Granola API key invalid")
                return {"status": "error", "reason": "invalid_api_key"}
            resp.raise_for_status()
            data = resp.json()

            notes = data.get("notes", data.get("items", []))
            for note in notes:
                note_id = note.get("id", "")
                if not note_id:
                    continue
                # Skip already-imported notes
                if r.sismember(imported_key, note_id):
                    continue

                # Fetch full note with transcript
                detail_resp = _req.get(
                    f"https://public-api.granola.ai/v1/notes/{note_id}",
                    headers=headers,
                    params={"include": "transcript"},
                    timeout=20,
                )
                if not detail_resp.ok:
                    logger.warning("sync_granola_notes_task: failed to fetch note %s: %s", note_id, detail_resp.status_code)
                    continue
                detail = detail_resp.json()

                title = detail.get("title") or note.get("title") or "Untitled meeting"
                summary_raw = detail.get("summary_markdown") or detail.get("summary_text") or ""
                summary = _md.markdown(summary_raw, extensions=["extra"]) if summary_raw else ""
                transcript_segments = detail.get("transcript", [])
                raw_transcript = " ".join(
                    seg.get("text", "").strip()
                    for seg in transcript_segments
                    if seg.get("text", "").strip()
                )
                note_created_at = detail.get("created_at") or note.get("created_at")

                entry_id = str(_uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO eln_entries (
                        entry_id, user_id, notebook_id, title, entry_type,
                        body, ai_status,
                        is_shared, is_deleted, created_at, updated_at
                    ) VALUES (
                        %s::uuid, %s::uuid, %s::uuid, %s, 'meeting',
                        %s, 'none',
                        false, false,
                        COALESCE(%s::timestamptz, now()),
                        COALESCE(%s::timestamptz, now())
                    )
                    """,
                    (entry_id, user_id, notebook_id, title, summary or None,
                     note_created_at, note_created_at),
                )
                conn.commit()
                r.sadd(imported_key, note_id)
                imported_count += 1
                logger.info("sync_granola_notes_task: imported note %s → entry %s", note_id, entry_id)

            next_cursor = data.get("cursor") or data.get("next_cursor")
            if not next_cursor:
                break
            cursor = next_cursor

        # Update last sync timestamp
        r.set(last_sync_key, datetime.now(timezone.utc).isoformat())
        logger.info("sync_granola_notes_task: done — %d new notes imported", imported_count)
        return {"status": "ok", "imported": imported_count}

    except Exception as exc:
        conn.rollback()
        logger.exception("sync_granola_notes_task failed")
        raise
    finally:
        conn.close()
