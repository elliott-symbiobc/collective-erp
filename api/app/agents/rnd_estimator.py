"""
rnd_estimator.py — R&D timeline and capital estimator for compound opportunities.

Provides:
  estimate_poc_duration()               — Phase 1: PoC fermentation timeline
  PROCESS_DEV_TABLE                     — Phase 3: process development benchmarks
  classify_compound_class()             — map compound name → compound class
  estimate_titer_optimization_duration() — Phase 2: titer optimisation timeline
  estimate_time_to_revenue()            — Monte Carlo convolution of all phases
  estimate_capital_requirements()       — CapEx lo/hi per phase
  run_rnd_estimate()                    — full pipeline: fetch → estimate → persist
"""
import logging
import math
from typing import Optional

import numpy as np
import psycopg2.extras
from scipy import optimize
from scipy.stats import lognorm, norm

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Phase 1 — PoC Duration
# ---------------------------------------------------------------------------

_SCORE_BASE = [
    (0.70, 2.0),
    (0.55, 5.0),
    (0.40, 10.0),
    (0.00, 18.0),
]

_EDIT_MULT = {0: 1.0, 1: 1.3, 2: 1.8, 3: 2.5}
_EDIT_MULT_GE4 = 3.2

_PRECEDENT_MULT = {
    "strong":   0.7,
    "moderate": 1.0,
    "weak":     1.5,
    "none":     2.2,
}

_NATIVE_MULT = 0.6


def estimate_poc_duration(
    compatibility_score: float,
    n_edits_required: int,
    pathway_precedent: str,
    is_native_product: bool,
) -> dict:
    """Estimate Phase 1 PoC fermentation duration.

    Returns dict with p10_months, p50_months, p90_months.
    """
    base = next(b for threshold, b in _SCORE_BASE if compatibility_score >= threshold)

    edit_mult = _EDIT_MULT.get(n_edits_required, _EDIT_MULT_GE4)
    prec_mult = _PRECEDENT_MULT.get(pathway_precedent, 1.0)
    native_mult = _NATIVE_MULT if is_native_product else 1.0

    p50 = base * edit_mult * prec_mult * native_mult

    uncertainty = 0.4 + (n_edits_required * 0.1)
    p10 = max(1.0, p50 * (1.0 - uncertainty))
    p90 = p50 * (1.0 + uncertainty * 1.5)

    return {
        "p10_months": round(p10, 2),
        "p50_months": round(p50, 2),
        "p90_months": round(p90, 2),
    }


# ---------------------------------------------------------------------------
# Phase 3 — Process Development benchmarks
# ---------------------------------------------------------------------------

PROCESS_DEV_TABLE: dict[str, tuple[int, int, int]] = {
    "enzyme_preparation":  (6,  12, 24),
    "organic_acid":        (9,  18, 36),
    "single_cell_protein": (6,  14, 28),
    "lipid_fraction":      (12, 24, 48),
    "specialty_sugar":     (8,  16, 30),
    "alkaloid":            (18, 36, 60),
}

# Phase 3 CapEx ranges by compound class (lo, hi in USD)
_PHASE3_CAPEX: dict[str, tuple[int, int]] = {
    "enzyme_preparation":  (50_000,  150_000),
    "organic_acid":        (100_000, 300_000),
    "single_cell_protein": (80_000,  250_000),
    "lipid_fraction":      (150_000, 400_000),
    "specialty_sugar":     (100_000, 300_000),
    "alkaloid":            (200_000, 600_000),
}


# ---------------------------------------------------------------------------
# Compound class classifier
# ---------------------------------------------------------------------------

def classify_compound_class(compound_name: str, chebi_id: Optional[str] = None) -> str:
    """Map a compound name to one of the PROCESS_DEV_TABLE keys.

    Matching is case-insensitive on compound_name keywords.
    """
    lower = compound_name.lower()

    if any(kw in lower for kw in ("ase", "enzyme", "cocktail", "cellulase", "xylanase",
                                   "protease", "lipase", "amylase", "laccase")):
        return "enzyme_preparation"

    if any(kw in lower for kw in ("acid",)) and any(
        kw in lower for kw in ("ferulic", "gallic", "lactic", "coumaric", "succinic",
                                "citric", "acetic", "malic", "fumaric", "gluconic",
                                "ellagic", "tartaric")
    ):
        return "organic_acid"

    if any(kw in lower for kw in ("protein", "scp", "biomass", "mycoprotein")):
        return "single_cell_protein"

    if any(kw in lower for kw in ("cbe", "butter", "lipid", "fatty", "oil", "oleic",
                                   "palmitic", "stearic", "linoleic")):
        return "lipid_fraction"

    if any(kw in lower for kw in ("sugar", "syrup", "oligosaccharide", "xylobiose",
                                   "fructooligosaccharide", "galactooligosaccharide",
                                   "trehalose", "lactulose")):
        return "specialty_sugar"

    if any(kw in lower for kw in ("theobromine", "alkaloid", "methylxanthine",
                                   "caffeine", "xanthine", "ergot")):
        return "alkaloid"

    return "enzyme_preparation"  # default


# ---------------------------------------------------------------------------
# Phase 2 — Titer Optimisation
# ---------------------------------------------------------------------------

def estimate_titer_optimization_duration(
    current_predicted_score: float,
    target_titer_threshold: float,
    current_best_titer: float,
    model_uncertainty: float,
    lab_runs_per_week: float = 2.5,
    conn=None,
) -> dict:
    """Estimate Phase 2 titer optimisation duration via a runs-based model.

    Returns dict with p10_months, p50_months, p90_months, runs_required_p50,
    already_viable (bool), titer_gap.
    """
    if current_best_titer >= target_titer_threshold:
        return {
            "already_viable":    True,
            "titer_gap":         0.0,
            "p10_months":        1.0,
            "p50_months":        1.0,
            "p90_months":        1.8,
            "runs_required_p50": 0,
        }

    titer_gap = target_titer_threshold - current_best_titer

    # Runs to reduce model uncertainty below 20 %
    # Formula: ceil( log(0.20 / max(uncertainty, 0.05)) / log(1 - 0.20) )
    # Negative result means already below threshold → clamp to 0
    raw_confidence_runs = math.log(0.20 / max(model_uncertainty, 0.05)) / math.log(1.0 - 0.20)
    runs_to_confidence = max(0, math.ceil(raw_confidence_runs))

    # Runs to achieve titer improvement, keyed on gap / score ratio
    ratio = titer_gap / max(current_predicted_score, 1e-9)
    if ratio < 0.2:
        improvement_runs = 5
    elif ratio < 0.5:
        improvement_runs = 12
    elif ratio < 1.0:
        improvement_runs = 25
    else:
        improvement_runs = 50

    total_runs = runs_to_confidence + improvement_runs
    months_p50 = (total_runs / lab_runs_per_week) / 4.33

    return {
        "already_viable":    False,
        "titer_gap":         round(titer_gap, 4),
        "p10_months":        round(months_p50 * 0.6, 2),
        "p50_months":        round(months_p50, 2),
        "p90_months":        round(months_p50 * 1.8, 2),
        "runs_required_p50": total_runs,
    }


# ---------------------------------------------------------------------------
# Monte Carlo lognormal convolution — estimate_time_to_revenue
# ---------------------------------------------------------------------------

def _fit_lognormal(p10: float, p50: float, p90: float):
    """Fit a lognormal distribution to (p10, p50, p90) percentiles.

    Returns (mu, sigma) for the underlying normal.
    Falls back to mu=log(p50), sigma=0.4 if fsolve fails or p values degenerate.
    """
    _FALLBACK_SIGMA = 0.4

    # Clamp to strictly positive
    p10 = max(p10, 0.01)
    p50 = max(p50, 0.01)
    p90 = max(p90, p50)  # p90 must be >= p50

    mu_init = math.log(p50)

    # Degenerate case: p10 == p50 == p90 (or very close)
    if p90 <= p50 * 1.001:
        return mu_init, _FALLBACK_SIGMA

    # Try analytical estimate from p50 and p90
    try:
        sigma_from_p90 = (math.log(p90) - math.log(p50)) / norm.ppf(0.90)
        if sigma_from_p90 > 0:
            return mu_init, sigma_from_p90
    except Exception:
        pass

    # Last resort: fsolve with two-equation system [p10, p90]
    def equations(params):
        mu, sigma = params
        sigma = max(sigma, 1e-6)
        eq1 = lognorm.ppf(0.10, s=sigma, scale=math.exp(mu)) - p10
        eq2 = lognorm.ppf(0.90, s=sigma, scale=math.exp(mu)) - p90
        return [eq1, eq2]

    try:
        result, info, ier, _ = optimize.fsolve(
            equations, x0=[mu_init, _FALLBACK_SIGMA], full_output=True
        )
        if ier == 1 and result[1] > 0:
            return result[0], result[1]
    except Exception:
        pass

    return mu_init, _FALLBACK_SIGMA


def _phase4_to_percentiles(phase4: dict) -> tuple[float, float, float]:
    """Convert phase4 lo/hi dict to (p10, p50, p90)."""
    lo = float(phase4.get("timeline_months_lo", 6))
    hi = float(phase4.get("timeline_months_hi", 18))
    # Geometric mean as p50; lo → p10, hi → p90
    p50 = math.sqrt(lo * hi) if lo > 0 and hi > 0 else (lo + hi) / 2.0
    return lo, p50, hi


def estimate_time_to_revenue(
    phase1: dict,
    phase2: dict,
    phase3: dict,
    phase4: dict,
    n_simulations: int = 10_000,
) -> dict:
    """Monte Carlo lognormal convolution of four R&D phases.

    phase1/2/3 must have p10_months, p50_months, p90_months keys.
    phase4 may have either those keys OR timeline_months_lo / timeline_months_hi.

    Returns dict with p10_months_total, p50_months_total, p90_months_total.
    """
    rng = np.random.default_rng(seed=42)

    def _samples(phase: dict) -> np.ndarray:
        if "p10_months" in phase:
            p10 = float(phase["p10_months"])
            p50 = float(phase["p50_months"])
            p90 = float(phase["p90_months"])
        else:
            p10, p50, p90 = _phase4_to_percentiles(phase)

        mu, sigma = _fit_lognormal(p10, p50, p90)
        return rng.lognormal(mean=mu, sigma=sigma, size=n_simulations)

    draws = (
        _samples(phase1)
        + _samples(phase2)
        + _samples(phase3)
        + _samples(phase4)
    )

    return {
        "p10_months_total": round(float(np.percentile(draws, 10)), 1),
        "p50_months_total": round(float(np.percentile(draws, 50)), 1),
        "p90_months_total": round(float(np.percentile(draws, 90)), 1),
    }


# ---------------------------------------------------------------------------
# Capital requirements
# ---------------------------------------------------------------------------

def estimate_capital_requirements(
    n_edits_required: int,
    compound_class: str,
    reg_cost_lo: float,
    reg_cost_hi: float,
) -> dict:
    """Estimate CapEx lo/hi per phase and totals.

    Phase 1: base ($15K–$50K) + $20K per edit
    Phase 2: ($40K–$120K) × (1 + n_edits × 0.3)
    Phase 3: by compound_class from _PHASE3_CAPEX
    Phase 4: reg_cost_lo, reg_cost_hi
    """
    p1_lo = 15_000 + n_edits_required * 20_000
    p1_hi = 50_000 + n_edits_required * 20_000

    scale2 = 1.0 + n_edits_required * 0.3
    p2_lo = 40_000 * scale2
    p2_hi = 120_000 * scale2

    p3_lo, p3_hi = _PHASE3_CAPEX.get(compound_class, (80_000, 250_000))

    return {
        "phase1_capex_lo": p1_lo,
        "phase1_capex_hi": p1_hi,
        "phase2_capex_lo": p2_lo,
        "phase2_capex_hi": p2_hi,
        "phase3_capex_lo": p3_lo,
        "phase3_capex_hi": p3_hi,
        "phase4_capex_lo": reg_cost_lo,
        "phase4_capex_hi": reg_cost_hi,
        "total_capex_lo":  p1_lo + p2_lo + p3_lo + reg_cost_lo,
        "total_capex_hi":  p1_hi + p2_hi + p3_hi + reg_cost_hi,
    }


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

def run_rnd_estimate(opportunity_id: str, conn) -> dict:
    """Fetch opportunity data, run all estimators, persist to compound_rnd_estimates.

    Returns the full estimate dict.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Fetch opportunity
    cur.execute(
        """
        SELECT o.compound_name, o.chebi_id, o.confidence, o.cazyme_evidence,
               o.biosynthetic_pathway, o.substrate_id
        FROM   strain_compound_opportunities o
        WHERE  o.opportunity_id = %s
        """,
        (opportunity_id,),
    )
    row = cur.fetchone()
    if not row:
        cur.close()
        raise ValueError(f"Opportunity {opportunity_id} not found")

    compound_name = row["compound_name"]
    chebi_id      = row.get("chebi_id")
    confidence    = float(row.get("confidence") or 0.5)

    # Derive n_edits from cazyme_evidence (count distinct EC entries, default 1)
    caz_ev = row.get("cazyme_evidence") or {}
    if isinstance(caz_ev, dict):
        n_edits = max(1, min(len(caz_ev), 4))
    else:
        n_edits = 1

    # Pathway precedent: use biosynthetic_pathway field as a heuristic
    pathway = (row.get("biosynthetic_pathway") or "").lower()
    if any(kw in pathway for kw in ("native", "natural", "endogenous")):
        precedent = "strong"
        is_native = True
    elif any(kw in pathway for kw in ("known", "characterised", "characterize", "established")):
        precedent = "moderate"
        is_native = False
    elif pathway:
        precedent = "weak"
        is_native = False
    else:
        precedent = "moderate"
        is_native = False

    # Phase 4 — regulatory timeline from compound_regulatory_status
    cur.execute(
        """
        SELECT status, notes
        FROM   compound_regulatory_status
        WHERE  compound_name = %s AND jurisdiction = 'US_FDA'
        LIMIT  1
        """,
        (compound_name,),
    )
    reg_row = cur.fetchone()
    cur.close()

    if reg_row and reg_row["status"] == "GRAS":
        phase4 = {"timeline_months_lo": 3,  "timeline_months_hi": 9}
        reg_cost_lo, reg_cost_hi = 25_000,  75_000
    elif reg_row and reg_row["status"] == "CFR_LISTED":
        phase4 = {"timeline_months_lo": 6,  "timeline_months_hi": 12}
        reg_cost_lo, reg_cost_hi = 50_000,  120_000
    else:
        # Default: self-affirmed GRAS pathway
        phase4 = {"timeline_months_lo": 6,  "timeline_months_hi": 18}
        reg_cost_lo, reg_cost_hi = 50_000,  150_000

    # Phase 1
    phase1 = estimate_poc_duration(confidence, n_edits, precedent, is_native)

    # Phase 2 — titer optimisation (target titer = 1.0 normalised; current = confidence)
    phase2_full = estimate_titer_optimization_duration(
        current_predicted_score=confidence,
        target_titer_threshold=1.0,
        current_best_titer=confidence * 0.5,  # heuristic: current best is ~50 % of score
        model_uncertainty=max(0.1, 1.0 - confidence),
    )
    phase2 = {
        "p10_months": phase2_full["p10_months"],
        "p50_months": phase2_full["p50_months"],
        "p90_months": phase2_full["p90_months"],
    }

    # Phase 3 — process development
    compound_class = classify_compound_class(compound_name, chebi_id)
    p3_p10, p3_p50, p3_p90 = PROCESS_DEV_TABLE.get(
        compound_class, PROCESS_DEV_TABLE["enzyme_preparation"]
    )
    phase3 = {"p10_months": p3_p10, "p50_months": p3_p50, "p90_months": p3_p90}

    # Combined timeline
    combined = estimate_time_to_revenue(phase1, phase2, phase3, phase4)

    # Capital
    capex = estimate_capital_requirements(n_edits, compound_class, reg_cost_lo, reg_cost_hi)

    # Persist to compound_rnd_estimates (upsert per phase)
    phases_to_write = [
        ("poc_fermentation",    phase1["p10_months"],     phase1["p50_months"],     phase1["p90_months"],     capex["phase1_capex_lo"] / 1e6),
        ("titer_optimization",  phase2["p10_months"],     phase2["p50_months"],     phase2["p90_months"],     capex["phase2_capex_lo"] / 1e6),
        ("process_development", phase3["p10_months"],     phase3["p50_months"],     phase3["p90_months"],     capex["phase3_capex_lo"] / 1e6),
        ("regulatory",          phase4["timeline_months_lo"], (phase4["timeline_months_lo"] + phase4["timeline_months_hi"]) / 2, phase4["timeline_months_hi"], capex["phase4_capex_lo"] / 1e6),
    ]

    try:
        cur2 = conn.cursor()
        for phase_name, p10, p50, p90, capex_musd in phases_to_write:
            cur2.execute(
                """
                INSERT INTO compound_rnd_estimates
                    (compound_name, phase, p10_months, p50_months, p90_months, capex_musd)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (compound_name, phase)
                DO UPDATE SET
                    p10_months  = EXCLUDED.p10_months,
                    p50_months  = EXCLUDED.p50_months,
                    p90_months  = EXCLUDED.p90_months,
                    capex_musd  = EXCLUDED.capex_musd
                """,
                (compound_name, phase_name, p10, p50, p90, capex_musd),
            )
        conn.commit()
        cur2.close()
    except Exception as exc:
        logger.warning("run_rnd_estimate DB write error: %s", exc)
        conn.rollback()

    result = {
        "opportunity_id":  opportunity_id,
        "compound_name":   compound_name,
        "compound_class":  compound_class,
        "n_edits":         n_edits,
        "precedent":       precedent,
        "is_native":       is_native,
        "phase1":          phase1,
        "phase2":          phase2,
        "phase3":          phase3,
        "phase4":          phase4,
        "combined":        combined,
        "capex":           capex,
        "reg_cost_lo":     reg_cost_lo,
        "reg_cost_hi":     reg_cost_hi,
    }

    logger.info(
        "run_rnd_estimate: %s class=%s p50_total=%s months capex_hi=$%.0f",
        compound_name, compound_class,
        combined["p50_months_total"], capex["total_capex_hi"],
    )
    return result
