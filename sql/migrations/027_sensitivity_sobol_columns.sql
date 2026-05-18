-- 027_sensitivity_sobol_columns.sql
-- Add Sobol' sensitivity index columns and method flag to tea_sensitivity.
-- sobol_s1:  first-order Sobol' index (direct effect only)
-- sobol_st:  total-order Sobol' index (includes interactions)
-- sensitivity_method: 'sobol' or 'oat_fallback'
-- parameter_label: human-readable display name

ALTER TABLE tea_sensitivity
    ADD COLUMN IF NOT EXISTS sobol_s1 double precision,
    ADD COLUMN IF NOT EXISTS sobol_st double precision,
    ADD COLUMN IF NOT EXISTS sensitivity_method text DEFAULT 'oat_fallback',
    ADD COLUMN IF NOT EXISTS parameter_label text;

COMMENT ON COLUMN tea_sensitivity.sobol_s1 IS
    'First-order Sobol index: fraction of MPSP variance explained by this parameter alone. Saltelli 2010 doi:10.1016/j.cpc.2009.09.018';
COMMENT ON COLUMN tea_sensitivity.sobol_st IS
    'Total-order Sobol index: fraction including all interaction terms. Higher STi = parameter matters more.';
COMMENT ON COLUMN tea_sensitivity.sensitivity_method IS
    'sobol = global Saltelli/SALib analysis; oat_fallback = one-at-a-time approximation';
COMMENT ON COLUMN tea_sensitivity.parameter_label IS
    'Display-friendly parameter label for UI';
