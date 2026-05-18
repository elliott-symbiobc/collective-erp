"""
Unit normalization for fermentation titer data.

Maps the diverse unit strings produced by LLM extraction to canonical
units accepted by the training_pairs materialized view:
  - 'g_per_g_substrate' (yield model)
  - 'U/g' (enzyme production model)

Normalization rules are documented with their rationale and limitations.
This module is conservative: if a unit cannot be confidently normalized,
it returns None rather than making a potentially wrong conversion.

All conversions that require substrate loading or broth volume data
are conditional — they only proceed if the required contextual value
is available in the staging_queue row.
"""

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

YIELD_MODEL_UNIT = 'g_per_g_substrate'
ENZYME_MODEL_UNIT = 'U/g'

# Direct mappings — no calculation required
DIRECT_YIELD_MAPPINGS = {
    'g_per_g_substrate': YIELD_MODEL_UNIT,
    'g/g substrate': YIELD_MODEL_UNIT,
    'g/g dry substrate': YIELD_MODEL_UNIT,
    'g/g ds': YIELD_MODEL_UNIT,
    'g/g DW': YIELD_MODEL_UNIT,
    'g product/g substrate': YIELD_MODEL_UNIT,
    'g product / g substrate': YIELD_MODEL_UNIT,
    'g/g': YIELD_MODEL_UNIT,
    'g gallic acid/g tannic acid': YIELD_MODEL_UNIT,
    'g gallic acid / g tannic acid': YIELD_MODEL_UNIT,
    'g GA/g TA': YIELD_MODEL_UNIT,
    'g product/g carbon source': YIELD_MODEL_UNIT,
    'g/g carbon source': YIELD_MODEL_UNIT,
}

DIRECT_ENZYME_MAPPINGS = {
    'U/g': ENZYME_MODEL_UNIT,
    'U/g substrate': ENZYME_MODEL_UNIT,
    'U/g ds': ENZYME_MODEL_UNIT,
    'U/g DW': ENZYME_MODEL_UNIT,
    'U/g dry substrate': ENZYME_MODEL_UNIT,
    'IU/g': ENZYME_MODEL_UNIT,
    'IU/g substrate': ENZYME_MODEL_UNIT,
    'units/g substrate': ENZYME_MODEL_UNIT,
    'units/g': ENZYME_MODEL_UNIT,
    'U g-1': ENZYME_MODEL_UNIT,
    'U g\u207b\xb9': ENZYME_MODEL_UNIT,
    'IU/g DS': ENZYME_MODEL_UNIT,
    'U/gds': ENZYME_MODEL_UNIT,
    'IU/g DMB': ENZYME_MODEL_UNIT,   # Dry Matter Basis
    'IU/g dmb': ENZYME_MODEL_UNIT,
    'U/gsd': ENZYME_MODEL_UNIT,      # g substrate dry
    'U/g sd': ENZYME_MODEL_UNIT,
}

# Volume units requiring substrate_loading_g_per_l for conversion
VOLUME_UNITS_NEEDING_LOADING = {
    'g/L', 'g L-1', 'g L\u207b\xb9', 'g/l',
    'mg/L', 'mg/ml', 'mg/mL',
}

ENZYME_VOLUME_UNITS = {
    'U/mL', 'U/ml', 'U/L', 'IU/mL', 'IU/ml',
    'IU/L', 'U/liter',
}

BIOMASS_UNITS = {
    'U/mg protein', 'U/mg', 'U/mg dry weight',
    'nmol/min/mg', '\u03bcmol/min/mg',
}

# Units that are never production titers — molecular mass, kinetics params, relative change
REJECT_UNITS = {
    'Da', 'kDa', 'MDa', 'g/mol', 'kg/mol',
    '10^3 g mol-1', '10^3 g/mol',
    'Da (apparent molecular mass)',
    'fold', 'fold increase', 'fold increase over control',
    'fold increase in ferulic acid release',
    'fold increase over unsonicated control',
    '% increase', '% decrease', '% increase over control',
    '% inhibition', 'IC50', 'MIC',
    'µM', 'uM', 'nM', 'mM',   # inhibition concentrations
    'h (half-life)', 't½', 't1/2',
}

# Implausible value ranges per canonical unit — used as a secondary sanity check
IMPOSSIBLE_VALUE_THRESHOLDS = {
    YIELD_MODEL_UNIT: (0.0, 2.0),    # g product / g substrate: >2 violates mass balance
    ENZYME_MODEL_UNIT: (0.0, 1e7),   # U/g substrate: >10M U/g is unphysical
}


def normalize_unit(
    titer_value: float,
    titer_unit: str,
    substrate_loading_g_per_l: Optional[float] = None,
    data_type: str = 'fermentation_run',
) -> tuple[Optional[float], Optional[str], str]:
    """
    Normalize a titer value and unit to canonical form.

    Returns (normalized_value, canonical_unit, normalization_method).
    Returns (None, None, reason) if normalization is not possible.
    """
    if titer_value is None or titer_unit is None:
        return None, None, 'missing_value_or_unit'

    if titer_value <= 0:
        return None, None, 'non_positive_value'

    unit_clean = titer_unit.strip()

    if unit_clean in REJECT_UNITS or unit_clean.lower() in {u.lower() for u in REJECT_UNITS}:
        return None, None, f'rejected_non_production_unit_{unit_clean[:50]}'

    if unit_clean in DIRECT_YIELD_MAPPINGS:
        return titer_value, YIELD_MODEL_UNIT, 'direct_mapping'

    if unit_clean in DIRECT_ENZYME_MAPPINGS:
        return titer_value, ENZYME_MODEL_UNIT, 'direct_mapping'

    # Case-insensitive fallback
    unit_lower = unit_clean.lower()
    for k, v in {**DIRECT_YIELD_MAPPINGS, **DIRECT_ENZYME_MAPPINGS}.items():
        if k.lower() == unit_lower:
            return titer_value, v, 'direct_mapping_case_insensitive'

    # Volume-based yield units → g_per_g_substrate
    if unit_clean in VOLUME_UNITS_NEEDING_LOADING:
        if substrate_loading_g_per_l and substrate_loading_g_per_l > 0:
            scale = 0.001 if 'mg' in unit_clean.lower() else 1.0
            normalized = (titer_value * scale) / substrate_loading_g_per_l
            if 0 < normalized <= 1.5:
                return normalized, YIELD_MODEL_UNIT, f'calculated_from_loading_{substrate_loading_g_per_l}g_per_l'
            return None, None, f'calculated_yield_{normalized:.3f}_outside_plausible_range'
        return None, None, 'volume_unit_needs_substrate_loading'

    # Volume-based enzyme units → U/g
    if unit_clean in ENZYME_VOLUME_UNITS:
        if substrate_loading_g_per_l and substrate_loading_g_per_l > 0:
            # U/mL × 1000 mL/L ÷ g/L substrate = U/g substrate
            normalized = (titer_value * 1000) / substrate_loading_g_per_l
            if 0 < normalized < 1e7:
                return normalized, ENZYME_MODEL_UNIT, f'calculated_from_loading_{substrate_loading_g_per_l}g_per_l'
            return None, None, f'calculated_activity_{normalized:.1f}_outside_plausible_range'
        return None, None, 'enzyme_volume_unit_needs_substrate_loading'

    if unit_clean in BIOMASS_UNITS:
        return None, None, 'per_biomass_unit_not_mappable_to_substrate'

    if '%' in unit_clean:
        if 'w/w' in unit_lower or 'wt' in unit_lower:
            normalized = titer_value / 100.0
            if 0 < normalized <= 1.0:
                return normalized, YIELD_MODEL_UNIT, 'pct_ww_divided_by_100'
        return None, None, 'percentage_unit_ambiguous'

    if 'FPU' in unit_clean or 'FPASE' in unit_clean.upper():
        return None, None, 'FPU_not_mappable_without_substrate_specification'

    return None, None, f'unit_not_recognized_{unit_clean[:50]}'


def normalize_staging_queue_row(row: dict) -> dict:
    """
    Apply unit normalization to a staging_queue payload dict.

    Returns the row dict augmented with:
        normalized_titer_value, normalized_titer_unit,
        normalization_method, normalization_eligible
    """
    titer_value = row.get('titer_value')
    titer_unit = row.get('titer_unit')
    substrate_loading = row.get('substrate_loading_g_per_l')
    data_type = row.get('data_type', 'fermentation_run')

    try:
        if titer_value is not None:
            titer_value = float(titer_value)
    except (TypeError, ValueError):
        return {
            **row,
            'normalized_titer_value': None,
            'normalized_titer_unit': None,
            'normalization_method': 'titer_value_not_numeric',
            'normalization_eligible': False,
        }

    norm_value, norm_unit, method = normalize_unit(
        titer_value, titer_unit, substrate_loading, data_type
    )

    return {
        **row,
        'normalized_titer_value': norm_value,
        'normalized_titer_unit': norm_unit,
        'normalization_method': method,
        'normalization_eligible': norm_value is not None,
    }


def apply_normalization_to_staging_queue(conn, dry_run: bool = True) -> dict:
    """
    Apply unit normalization to all staging_queue rows.

    Writes normalized_titer_value, normalized_titer_unit, normalization_method,
    original_titer_unit to the dedicated columns added by migration 030.

    Parameters
    ----------
    conn : psycopg2 connection
    dry_run : bool
        If True, report what would change without writing to DB.

    Returns
    -------
    dict with summary statistics.
    """
    cur = conn.cursor()

    cur.execute("""
        SELECT queue_id, payload, review_status
        FROM staging_queue
        WHERE payload->>'titer_unit' IS NOT NULL
    """)
    rows = cur.fetchall()

    results = {
        'total': len(rows),
        'already_canonical': 0,
        'normalized': 0,
        'cannot_normalize': 0,
        'by_method': {},
        'by_original_unit': {},
    }

    for queue_id, payload, review_status in rows:
        if payload is None:
            continue

        original_unit = payload.get('titer_unit', '')
        results['by_original_unit'][original_unit] = (
            results['by_original_unit'].get(original_unit, 0) + 1
        )

        normalized = normalize_staging_queue_row(payload)
        method = normalized['normalization_method']
        results['by_method'][method] = results['by_method'].get(method, 0) + 1

        is_already_canonical = (
            original_unit in (YIELD_MODEL_UNIT, ENZYME_MODEL_UNIT)
            and method == 'direct_mapping'
        )

        if is_already_canonical:
            results['already_canonical'] += 1
        elif normalized['normalization_eligible']:
            results['normalized'] += 1
            if not dry_run:
                cur.execute(
                    """
                    UPDATE staging_queue
                    SET normalized_titer_value = %s,
                        normalized_titer_unit  = %s,
                        normalization_method   = %s,
                        original_titer_unit    = %s
                    WHERE queue_id = %s
                    """,
                    (
                        normalized['normalized_titer_value'],
                        normalized['normalized_titer_unit'],
                        method,
                        original_unit,
                        queue_id,
                    ),
                )
        else:
            results['cannot_normalize'] += 1

    if not dry_run:
        conn.commit()

    return results
