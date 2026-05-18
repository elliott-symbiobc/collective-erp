"""
Tests for substrate composition compatibility guard.
Verifies that incompatible substrate-product pairs are rejected
and compatible pairs are accepted.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.tea_agent import (
    check_composition_compatibility,
    OUTPUT_COMPOSITION_REQUIREMENTS,
)


# ── Grape pomace composition (the failing case) ───────────────────────────────
GRAPE_POMACE = {
    "pct_starch": None,
    "pct_cellulose": 41.2,
    "pct_hemicellulose": 22.5,
    "pct_pectin": 3.2,
    "pct_lignin": 18.3,
    "pct_protein": 8.2,
    "pct_lipid": 5.8,
    "tannin_load_mgkg": 8500,
}

# ── Bakery waste (starch-rich) ────────────────────────────────────────────────
BAKERY_WASTE = {
    "pct_starch": 52.0,
    "pct_cellulose": 5.0,
    "pct_hemicellulose": 4.0,
    "pct_pectin": 1.0,
    "pct_lignin": 2.0,
    "pct_protein": 12.0,
    "pct_lipid": 8.0,
    "tannin_load_mgkg": 50,
}

# ── Wheat bran ────────────────────────────────────────────────────────────────
WHEAT_BRAN = {
    "pct_starch": 20.0,
    "pct_cellulose": 10.0,
    "pct_hemicellulose": 28.0,
    "pct_pectin": 2.0,
    "pct_lignin": 5.0,
    "pct_protein": 16.0,
    "pct_lipid": 4.0,
    "tannin_load_mgkg": 100,
}


class TestGrapePomaceIncompatible:
    """Grape pomace should reject starch-derived products."""

    def test_glucose_maltose_syrup_rejected(self):
        ok, reason = check_composition_compatibility("Glucose-Maltose Syrup", GRAPE_POMACE)
        assert not ok
        assert "starch" in reason.lower()

    def test_trehalose_rejected(self):
        ok, reason = check_composition_compatibility("Trehalose", GRAPE_POMACE)
        assert not ok

    def test_citric_acid_accepted_via_cellulose(self):
        # pct_starch=NULL but pct_cellulose=41.2% satisfies the >=20% alternative
        ok, reason = check_composition_compatibility("Citric Acid", GRAPE_POMACE)
        assert ok, f"Citric acid should be compatible via cellulose alternative: {reason}"

    def test_kojic_acid_rejected(self):
        ok, reason = check_composition_compatibility("Kojic Acid", GRAPE_POMACE)
        assert not ok

    def test_high_maltose_syrup_rejected(self):
        ok, reason = check_composition_compatibility("High-Maltose Syrup", GRAPE_POMACE)
        assert not ok


class TestGrapePomaceCompatible:
    """Grape pomace should accept tannin, cellulose, hemicellulose products."""

    def test_gallic_acid_accepted(self):
        ok, reason = check_composition_compatibility("Gallic Acid", GRAPE_POMACE)
        assert ok, f"Gallic acid should be compatible: {reason}"

    def test_tannase_accepted(self):
        ok, reason = check_composition_compatibility("Tannase", GRAPE_POMACE)
        assert ok

    def test_cellulase_accepted(self):
        ok, reason = check_composition_compatibility("Cellulase Cocktail", GRAPE_POMACE)
        assert ok

    def test_xylanase_accepted(self):
        ok, reason = check_composition_compatibility("Xylanase", GRAPE_POMACE)
        assert ok

    def test_ferulic_acid_accepted(self):
        ok, reason = check_composition_compatibility("Ferulic Acid", GRAPE_POMACE)
        assert ok

    def test_pectin_oligosaccharides_accepted(self):
        ok, reason = check_composition_compatibility("Pectin Oligosaccharides", GRAPE_POMACE)
        assert ok

    def test_amino_acid_hydrolysate_accepted(self):
        ok, reason = check_composition_compatibility("Amino Acid Hydrolysate", GRAPE_POMACE)
        assert ok  # 8.2% protein >= 8.0 threshold

    def test_single_cell_protein_accepted(self):
        ok, reason = check_composition_compatibility("Single-Cell Protein", GRAPE_POMACE)
        assert ok


class TestBakeryWasteCompatible:
    """Bakery waste (starch-rich) should accept starch-derived products."""

    def test_glucose_maltose_accepted(self):
        ok, reason = check_composition_compatibility("Glucose-Maltose Syrup", BAKERY_WASTE)
        assert ok, f"Glucose-Maltose should be compatible: {reason}"

    def test_trehalose_accepted(self):
        ok, reason = check_composition_compatibility("Trehalose", BAKERY_WASTE)
        assert ok

    def test_citric_acid_accepted(self):
        ok, reason = check_composition_compatibility("Citric Acid", BAKERY_WASTE)
        assert ok

    def test_gallic_acid_rejected(self):
        ok, reason = check_composition_compatibility("Gallic Acid", BAKERY_WASTE)
        assert not ok  # tannin_load_mgkg=50, threshold is 1000

    def test_xylanase_rejected(self):
        ok, reason = check_composition_compatibility("Xylanase", BAKERY_WASTE)
        assert not ok  # pct_hemicellulose=4.0, threshold is 10.0

    def test_cellulase_rejected(self):
        ok, reason = check_composition_compatibility("Cellulase Cocktail", BAKERY_WASTE)
        assert not ok  # pct_cellulose=5.0, threshold is 10.0


class TestWheatBranCompatible:
    """Wheat bran should accept hemicellulose and starch products."""

    def test_xylanase_accepted(self):
        ok, reason = check_composition_compatibility("Xylanase", WHEAT_BRAN)
        assert ok

    def test_ferulic_acid_accepted(self):
        ok, reason = check_composition_compatibility("Ferulic Acid", WHEAT_BRAN)
        assert ok

    def test_glucose_maltose_accepted(self):
        ok, reason = check_composition_compatibility("Glucose-Maltose Syrup", WHEAT_BRAN)
        assert ok  # 20% starch >= 5% threshold

    def test_cellulase_accepted(self):
        ok, reason = check_composition_compatibility("Cellulase Cocktail", WHEAT_BRAN)
        assert ok  # 10% cellulose meets threshold exactly


class TestAlternativeFraction:
    """Test OR logic for outputs with alternative_fraction (e.g. Citric Acid)."""

    def test_citric_acid_high_cellulose_no_starch(self):
        substrate = {
            "pct_starch": 0.0,
            "pct_cellulose": 45.0,  # high cellulose qualifies as alternative
        }
        ok, reason = check_composition_compatibility("Citric Acid", substrate)
        assert ok, f"High-cellulose substrate should qualify for citric acid: {reason}"

    def test_citric_acid_low_both_rejected(self):
        substrate = {
            "pct_starch": 2.0,
            "pct_cellulose": 10.0,
        }
        ok, reason = check_composition_compatibility("Citric Acid", substrate)
        assert not ok


class TestNullHandling:
    """NULL substrate fractions handled correctly."""

    def test_null_fraction_strict_fails(self):
        substrate = {"pct_starch": None}
        ok, reason = check_composition_compatibility("Glucose-Maltose Syrup", substrate, strict=True)
        assert not ok
        assert "NULL" in reason

    def test_null_fraction_nonstrict_passes(self):
        substrate = {"pct_starch": None}
        ok, reason = check_composition_compatibility("Glucose-Maltose Syrup", substrate, strict=False)
        assert ok

    def test_unknown_output_always_passes(self):
        ok, reason = check_composition_compatibility("SomeUnknownProduct", GRAPE_POMACE)
        assert ok
        assert reason == "no_requirements_defined"

    def test_empty_substrate_strict_fails(self):
        ok, reason = check_composition_compatibility("Glucose-Maltose Syrup", {}, strict=True)
        assert not ok

    def test_empty_substrate_nonstrict_passes(self):
        ok, reason = check_composition_compatibility("Glucose-Maltose Syrup", {}, strict=False)
        assert ok


class TestOutputRequirementsConstant:
    """Sanity checks on the constant itself."""

    def test_all_required_products_defined(self):
        for product in [
            "Glucose-Maltose Syrup", "Cellulase Cocktail", "Xylanase",
            "Gallic Acid", "Ferulic Acid", "Citric Acid", "Single-Cell Protein",
        ]:
            assert product in OUTPUT_COMPOSITION_REQUIREMENTS, f"{product} missing from requirements"

    def test_all_fractions_reference_valid_columns(self):
        valid_columns = {
            "pct_starch", "pct_cellulose", "pct_hemicellulose", "pct_pectin",
            "pct_lignin", "pct_protein", "pct_lipid", "tannin_load_mgkg",
            "total_phenolics_mgkg",
        }
        for output, reqs in OUTPUT_COMPOSITION_REQUIREMENTS.items():
            for req in reqs:
                assert req["fraction"] in valid_columns, (
                    f"Output '{output}' references unknown column '{req['fraction']}'"
                )
                if "alternative_fraction" in req:
                    assert req["alternative_fraction"] in valid_columns, (
                        f"Output '{output}' alternative references unknown column "
                        f"'{req['alternative_fraction']}'"
                    )
