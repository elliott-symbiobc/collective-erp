-- 025_composition_and_inference_provenance.sql
-- Adds provenance tracking for:
--   (a) substrate composition data fetched from literature
--   (b) biochemical/enzymatic output inference (source, citation, EC basis)

-- Where substrate composition came from
ALTER TABLE substrates
    ADD COLUMN IF NOT EXISTS composition_citation TEXT,
    ADD COLUMN IF NOT EXISTS composition_source   TEXT
        DEFAULT 'unknown'
        CHECK (composition_source IN (
            'internal_analysis', 'literature_lookup', 'vendor_datasheet',
            'cluster_defaults', 'user_entered', 'unknown'
        ));

COMMENT ON COLUMN substrates.composition_citation IS
    'Full citation(s) for the composition values (DOI or bibliographic reference). '
    'Populated automatically when values are fetched from literature by the TEA agent.';
COMMENT ON COLUMN substrates.composition_source IS
    'How composition data was obtained. literature_lookup = Claude/LLM search; '
    'internal_analysis = lab measurement; cluster_defaults = inferred from cluster type.';

-- Where each route TEA output inference came from
ALTER TABLE route_tea_results
    ADD COLUMN IF NOT EXISTS inference_provenance JSONB;

COMMENT ON COLUMN route_tea_results.inference_provenance IS
    'Provenance of the output inference: source type (biochemical_inference, '
    'enzymatic_route, compound_discovery, literature), literature citation, '
    'EC number basis, and which substrate component is being converted.';

-- Same for substrate_tea_results (best-route copy)
ALTER TABLE substrate_tea_results
    ADD COLUMN IF NOT EXISTS inference_provenance JSONB;

COMMENT ON COLUMN substrate_tea_results.inference_provenance IS
    'Same as route_tea_results.inference_provenance — copied for the best route record.';
