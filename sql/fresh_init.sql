-- fresh_init.sql
-- Initialises a new Symbio database from tracked SQL files.
-- Apply with:
--   psql -d <db> -f sql/fresh_init.sql
--
-- Run migration 026 first because earlier migrations (005, 006, 015, 021, 022, 025)
-- reference tables whose CREATE statements were added to the tracked schema only in
-- migration 026 (those tables were previously created by application code at startup).
-- This ordering is required only for fresh installs; the running production DB already
-- has all tables and applies subsequent migrations incrementally.

\i sql/schema.sql
\i sql/migrations/026_reconcile_missing_tables.sql
\i sql/migrations/002_fpa_plaid.sql
\i sql/migrations/003_fpa_qbo_categories.sql
\i sql/migrations/005_paper_summaries.sql
\i sql/migrations/006_notebook_notes_tasks.sql
\i sql/migrations/007_unified_entries.sql
\i sql/migrations/008_entry_body.sql
\i sql/migrations/009_entry_attachments.sql
\i sql/migrations/010_tasks_contact_link.sql
\i sql/migrations/011_funding.sql
\i sql/migrations/012_bioprocess_flowsheets.sql
\i sql/migrations/013_lab_chemicals.sql
\i sql/migrations/014_dilutive.sql
\i sql/migrations/015_portal_auth.sql
\i sql/migrations/016_standalone_portals.sql
\i sql/migrations/017_context_chunks.sql
\i sql/migrations/018_tasks_priority.sql
\i sql/migrations/019_system_design_costs.sql
\i sql/migrations/020_supplier_quotes.sql
\i sql/migrations/021_flowsheet_substrate_link.sql
\i sql/migrations/022_feedstock_cost_scenarios.sql
\i sql/migrations/023_tea_calculation_workbook.sql
\i sql/migrations/024_dsp_library.sql
\i sql/migrations/025_composition_and_inference_provenance.sql
