-- =============================================================================
-- Migration 026: Reconcile missing tables
-- =============================================================================
-- Purpose: Bring tracked SQL in sync with the running production DB.
--          All CREATE TABLE statements use IF NOT EXISTS so this migration
--          is safe to re-apply against an already-initialised database.
--
-- Tables added in this migration were present in the running database but
-- absent from schema.sql or migrations 002-025. They were likely created by
-- application code via _ensure_tables() or earlier untracked scripts.
--
-- After applying this migration, the following command sequence will produce
-- a fully working instance from tracked files only:
--
--   psql -d <db> -f sql/schema.sql
--   for f in sql/migrations/*.sql; do psql -d <db> -f "$f"; done
--
-- Column comments document purpose and FK relationships where known.
-- =============================================================================

-- agent_config_overrides
CREATE TABLE IF NOT EXISTS public.agent_config_overrides (
    agent_id character varying NOT NULL,
    model character varying,
    max_tokens integer,
    temperature double precision,
    system_prompt_override text,
    notes text,
    updated_at timestamp with time zone DEFAULT now(),
    top_p double precision,
    top_k integer
);
-- celery_job_overrides
CREATE TABLE IF NOT EXISTS public.celery_job_overrides (
    job_name character varying NOT NULL,
    enabled boolean DEFAULT true,
    cron_minute character varying,
    cron_hour character varying,
    cron_day_of_week character varying,
    notes text,
    updated_at timestamp with time zone DEFAULT now()
);
-- citations
CREATE TABLE IF NOT EXISTS public.citations (
    cite_key text NOT NULL,
    authors text NOT NULL,
    title text NOT NULL,
    journal text,
    year integer,
    doi text,
    source_type text NOT NULL,
    confidence_level text NOT NULL,
    notes text,
    CONSTRAINT citations_confidence_level_check CHECK ((confidence_level = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT citations_source_type_check CHECK ((source_type = ANY (ARRAY['journal'::text, 'book'::text, 'report'::text, 'patent'::text, 'internal'::text])))
);
-- commercial_enzymes
CREATE TABLE IF NOT EXISTS public.commercial_enzymes (
    enzyme_id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_name text NOT NULL,
    supplier text NOT NULL,
    enzyme_class text NOT NULL,
    ec_numbers text[],
    activity_u_mg numeric,
    price_usd_kg numeric,
    gras_status boolean DEFAULT false,
    min_temp_c numeric,
    max_temp_c numeric,
    ph_optimum_min numeric,
    ph_optimum_max numeric,
    typical_loading_g_kg_substrate numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived boolean DEFAULT false,
    archived_at timestamp with time zone,
    datasheet_url text,
    supplier_order_url text,
    supplier_contact_email text,
    supplier_contact_name text,
    tds_document_path text,
    sds_document_path text,
    catalog_number text
);
-- compound_activity_profiles
CREATE TABLE IF NOT EXISTS public.compound_activity_profiles (
    profile_id uuid DEFAULT gen_random_uuid() NOT NULL,
    compound_name text NOT NULL,
    chebi_id text,
    activity_type text,
    activity_strength text,
    market_segment text,
    foodb_id text,
    supporting_pmids text[],
    market_price_lo_usd_kg double precision,
    market_price_hi_usd_kg double precision,
    last_updated date
);
-- compound_ontology
CREATE TABLE IF NOT EXISTS public.compound_ontology (
    ontology_id uuid DEFAULT gen_random_uuid() NOT NULL,
    chebi_id text NOT NULL,
    compound_name text NOT NULL,
    molecular_formula text,
    roles text[],
    is_substrate_of text[],
    is_product_of text[],
    parent_chebi_ids text[],
    market_relevance text,
    last_updated timestamp with time zone DEFAULT now()
);
-- contact_advisors
CREATE TABLE IF NOT EXISTS public.contact_advisors (
    advisor_id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    equity_percent numeric(6,4),
    faa_sign_date date,
    piia_due_date date,
    piia_issued boolean DEFAULT false,
    piia_issue_date date,
    piu_cliff_months integer DEFAULT 6,
    piu_vest_date date,
    vesting_schedule text,
    fast_performance_level text,
    expected_hours_per_month numeric(5,1),
    expected_meetings text,
    expected_responsiveness text,
    duties text,
    faa_document_url text,
    piia_document_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_advisors_contact_id_idx ON public.contact_advisors USING btree (contact_id);
-- contact_tags
CREATE TABLE IF NOT EXISTS public.contact_tags (
    name text NOT NULL,
    color text DEFAULT '#6b7280'::text NOT NULL
);
-- crm_deals
CREATE TABLE IF NOT EXISTS public.crm_deals (
    deal_id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    company text,
    contact_name text,
    email text,
    phone text,
    stage text DEFAULT 'New'::text NOT NULL,
    probability numeric(5,2),
    expected_revenue numeric(15,2),
    description text,
    deadline date,
    odoo_id integer,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON public.crm_deals USING btree (stage) WHERE (NOT archived);
-- daily_plans
CREATE TABLE IF NOT EXISTS public.daily_plans (
    plan_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    weekly_plan_id uuid,
    plan_date date NOT NULL,
    health_summary text,
    ai_reasoning text,
    brain_dump text,
    status text DEFAULT 'active'::text,
    generated_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date ON public.daily_plans USING btree (user_id, plan_date);
-- eln_edits
CREATE TABLE IF NOT EXISTS public.eln_edits (
    edit_id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    user_id uuid,
    fields text[] DEFAULT '{}'::text[] NOT NULL,
    edited_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eln_edits_edited_at ON public.eln_edits USING btree (edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_eln_edits_entry_id ON public.eln_edits USING btree (entry_id);
CREATE INDEX IF NOT EXISTS idx_eln_edits_user_id ON public.eln_edits USING btree (user_id);
-- eln_entries
CREATE TABLE IF NOT EXISTS public.eln_entries (
    entry_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text DEFAULT 'Untitled Entry'::text NOT NULL,
    experiment_types text[] DEFAULT '{}'::text[] NOT NULL,
    is_shared boolean DEFAULT false NOT NULL,
    objective text DEFAULT ''::text NOT NULL,
    protocol text DEFAULT ''::text NOT NULL,
    observations text DEFAULT ''::text NOT NULL,
    results text DEFAULT ''::text NOT NULL,
    conclusions text DEFAULT ''::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    notebook_id uuid,
    linked_run_ids uuid[] DEFAULT '{}'::uuid[],
    linked_strain_ids uuid[] DEFAULT '{}'::uuid[],
    linked_substrate_ids uuid[] DEFAULT '{}'::uuid[],
    linked_protocols jsonb DEFAULT '[]'::jsonb,
    entry_type character varying DEFAULT 'experiment'::character varying,
    raw_transcript text,
    ai_summary text,
    ai_status character varying DEFAULT 'none'::character varying,
    action_items jsonb DEFAULT '[]'::jsonb,
    decisions jsonb DEFAULT '[]'::jsonb,
    follow_ups jsonb DEFAULT '[]'::jsonb,
    calendar_event_id character varying,
    calendar_event_title character varying,
    calendar_event_time timestamp with time zone,
    body text
);
CREATE INDEX IF NOT EXISTS eln_entries_ai_status_idx ON public.eln_entries USING btree (ai_status);
CREATE INDEX IF NOT EXISTS eln_entries_type_idx ON public.eln_entries USING btree (entry_type);
CREATE INDEX IF NOT EXISTS idx_eln_entries_created ON public.eln_entries USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eln_entries_notebook_id ON public.eln_entries USING btree (notebook_id);
CREATE INDEX IF NOT EXISTS idx_eln_entries_updated ON public.eln_entries USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_eln_entries_user_id ON public.eln_entries USING btree (user_id);
-- eln_notebooks
CREATE TABLE IF NOT EXISTS public.eln_notebooks (
    notebook_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text DEFAULT 'New Notebook'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    is_shared boolean DEFAULT false NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    project_id uuid
);
CREATE INDEX IF NOT EXISTS idx_eln_notebooks_project ON public.eln_notebooks USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_eln_notebooks_user_id ON public.eln_notebooks USING btree (user_id);
-- email_followup_suggestions
CREATE TABLE IF NOT EXISTS public.email_followup_suggestions (
    suggestion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id text NOT NULL,
    from_name text,
    from_email text,
    subject text,
    date text,
    reason text,
    suggested_action text,
    suggested_due_date date,
    status text DEFAULT 'pending'::text NOT NULL,
    scan_batch_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_suggestions_status ON public.email_followup_suggestions USING btree (status, created_at DESC);
-- enzyme_cocktail_compositions
CREATE TABLE IF NOT EXISTS public.enzyme_cocktail_compositions (
    composition_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cocktail_id uuid NOT NULL,
    enzyme_id uuid NOT NULL,
    standard_loading_g_kg numeric
);
-- enzyme_cocktail_features
CREATE TABLE IF NOT EXISTS public.enzyme_cocktail_features (
    cocktail_id uuid NOT NULL,
    has_alpha_amylase boolean DEFAULT false NOT NULL,
    has_beta_amylase boolean DEFAULT false NOT NULL,
    has_glucoamylase boolean DEFAULT false NOT NULL,
    has_xylanase boolean DEFAULT false NOT NULL,
    has_protease boolean DEFAULT false NOT NULL,
    has_dextranase boolean DEFAULT false NOT NULL,
    n_enzyme_classes integer DEFAULT 0 NOT NULL,
    cocktail_temp_opt_c double precision,
    cocktail_ph_opt double precision,
    is_maltogenic boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
-- enzyme_cocktails
CREATE TABLE IF NOT EXISTS public.enzyme_cocktails (
    cocktail_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier text,
    product_code text,
    enzyme_class text,
    declared_activity_u_ml double precision,
    application_notes text
);
-- enzyme_supplementation
CREATE TABLE IF NOT EXISTS public.enzyme_supplementation (
    supplementation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid,
    enzyme_id uuid,
    loading_g_kg numeric NOT NULL,
    addition_time_hrs numeric,
    cost_usd numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
-- execution_traces
CREATE TABLE IF NOT EXISTS public.execution_traces (
    trace_id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid,
    entity_id uuid,
    entity_type text,
    pipeline text NOT NULL,
    module_path text,
    function_name text,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    duration_ms integer,
    status text DEFAULT 'running'::text,
    inputs jsonb,
    steps jsonb DEFAULT '[]'::jsonb,
    outputs jsonb,
    assumptions jsonb,
    citations jsonb,
    error_message text,
    error_traceback text,
    source_hash text,
    triggered_by text DEFAULT 'system'::text,
    user_session text
);
CREATE INDEX IF NOT EXISTS idx_traces_entity ON public.execution_traces USING btree (entity_id, pipeline);
CREATE INDEX IF NOT EXISTS idx_traces_started ON public.execution_traces USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status ON public.execution_traces USING btree (status);
-- fpa_model
CREATE TABLE IF NOT EXISTS public.fpa_model (
    model_id uuid DEFAULT gen_random_uuid() NOT NULL,
    version text DEFAULT '1.0'::text,
    uploaded_at timestamp with time zone DEFAULT now(),
    uploaded_by text,
    is_active boolean DEFAULT true,
    exit_multiple double precision DEFAULT 4.0,
    exit_year integer DEFAULT 10,
    start_year integer DEFAULT 2025,
    working_capital double precision DEFAULT 5000,
    starting_valuation double precision DEFAULT 690000,
    original_equity double precision DEFAULT 210000,
    non_cash_equity double precision DEFAULT 480000,
    financing_charges_pct double precision DEFAULT 0,
    sba_rate double precision DEFAULT 0.075,
    bank_debt_rate double precision DEFAULT 0.08,
    mezz_rate double precision DEFAULT 0.09,
    hy_rate double precision DEFAULT 0.12,
    rd_contract_avg_value double precision DEFAULT 15000,
    rd_contract_duration_months integer DEFAULT 5,
    portfolio_contract_avg_value double precision DEFAULT 15000,
    portfolio_contract_duration_months integer DEFAULT 3,
    annual_data jsonb DEFAULT '[]'::jsonb,
    equity_rounds jsonb DEFAULT '[]'::jsonb,
    notes text,
    monthly_data jsonb DEFAULT '[]'::jsonb
);
-- fpa_qbo_transactions
CREATE TABLE IF NOT EXISTS public.fpa_qbo_transactions (
    id integer NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    txn_date date NOT NULL,
    txn_type text NOT NULL,
    txn_id text,
    account text,
    category text,
    name text,
    memo text,
    amount numeric(12,2) NOT NULL,
    is_expense boolean DEFAULT true NOT NULL
);
CREATE INDEX IF NOT EXISTS fpa_qbo_transactions_category ON public.fpa_qbo_transactions USING btree (category);
CREATE INDEX IF NOT EXISTS fpa_qbo_transactions_date ON public.fpa_qbo_transactions USING btree (txn_date);
-- fpa_scenarios
CREATE TABLE IF NOT EXISTS public.fpa_scenarios (
    scenario_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    created_by text,
    model_snapshot jsonb NOT NULL
);
-- fpa_uploaded_excel
CREATE TABLE IF NOT EXISTS public.fpa_uploaded_excel (
    id integer NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    uploaded_by text,
    filename text NOT NULL,
    data bytea NOT NULL,
    cell_map jsonb
);
-- literature_default_citations
CREATE TABLE IF NOT EXISTS public.literature_default_citations (
    id integer NOT NULL,
    output_name text NOT NULL,
    parameter text NOT NULL,
    cite_key text NOT NULL
);
-- model_config
CREATE TABLE IF NOT EXISTS public.model_config (
    id integer DEFAULT 1 NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT model_config_single_row CHECK ((id = 1))
);
-- organism_regulatory_status
CREATE TABLE IF NOT EXISTS public.organism_regulatory_status (
    org_reg_id uuid DEFAULT gen_random_uuid() NOT NULL,
    strain_id uuid,
    jurisdiction text NOT NULL,
    is_engineered boolean DEFAULT false NOT NULL,
    base_organism_status text,
    engineering_regulatory_path text,
    applicable_regulations text[],
    blocking_flag boolean DEFAULT false,
    engineering_notes text,
    last_checked date DEFAULT now()
);
-- paper_annotations
CREATE TABLE IF NOT EXISTS public.paper_annotations (
    annotation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid NOT NULL,
    page_num integer DEFAULT 1 NOT NULL,
    "position" jsonb,
    selected_text text,
    color text DEFAULT 'yellow'::text,
    note text,
    created_at timestamp with time zone DEFAULT now(),
    created_by text DEFAULT 'system'::text
);
CREATE INDEX IF NOT EXISTS idx_paper_annotations_paper_id ON public.paper_annotations USING btree (paper_id);
-- paper_extractions
CREATE TABLE IF NOT EXISTS public.paper_extractions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid,
    queue_id uuid,
    run_id uuid,
    created_at timestamp with time zone DEFAULT now()
);
-- paper_notes
CREATE TABLE IF NOT EXISTS public.paper_notes (
    note_id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid NOT NULL,
    queue_id uuid,
    note_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by text DEFAULT 'system'::text
);
CREATE INDEX IF NOT EXISTS idx_paper_notes_paper_id ON public.paper_notes USING btree (paper_id);
-- papers
CREATE TABLE IF NOT EXISTS public.papers (
    paper_id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    authors text,
    journal text,
    year integer,
    doi text,
    url text,
    abstract text,
    full_text text,
    pdf_path text,
    source text DEFAULT 'upload'::text NOT NULL,
    added_at timestamp with time zone DEFAULT now(),
    added_by text DEFAULT 'system'::text,
    word_count integer,
    language text DEFAULT 'en'::text,
    archived boolean DEFAULT false,
    paper_summary text,
    key_findings text,
    research_gaps text,
    last_extracted_at timestamp with time zone,
    extraction_model text
);
CREATE INDEX IF NOT EXISTS idx_papers_added ON public.papers USING btree (added_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_doi ON public.papers USING btree (doi) WHERE (doi IS NOT NULL);
-- paper_tags
CREATE TABLE IF NOT EXISTS public.paper_tags (
    tag_id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid NOT NULL,
    tag text NOT NULL,
    tag_type text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by text DEFAULT 'system'::text
);
CREATE INDEX IF NOT EXISTS idx_paper_tags_paper_id ON public.paper_tags USING btree (paper_id);
-- plan_blocks
CREATE TABLE IF NOT EXISTS public.plan_blocks (
    block_id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    estimated_minutes integer,
    actual_minutes integer,
    priority_score double precision DEFAULT 0,
    priority_reason text,
    block_type text DEFAULT 'focus'::text,
    source_type text,
    source_id text,
    status text DEFAULT 'draft'::text,
    gcal_event_id text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_blocks_plan ON public.plan_blocks USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_blocks_user_status ON public.plan_blocks USING btree (user_id, status);
-- portal_contacts
CREATE TABLE IF NOT EXISTS public.portal_contacts (
    id integer NOT NULL,
    portal_id uuid NOT NULL,
    name text NOT NULL,
    title text,
    email text,
    phone text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);
-- portal_updates
CREATE TABLE IF NOT EXISTS public.portal_updates (
    id integer NOT NULL,
    portal_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid
);
-- process_routes
CREATE TABLE IF NOT EXISTS public.process_routes (
    route_id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_code text NOT NULL,
    route_name text NOT NULL,
    route_category text NOT NULL,
    description text,
    requires_living_organism boolean DEFAULT true,
    requires_commercial_enzyme boolean DEFAULT false,
    typical_duration_hrs_min double precision,
    typical_duration_hrs_max double precision,
    water_use text,
    bioreactor_type text,
    default_substrate_input_kg_hr double precision DEFAULT 10.0,
    default_fermentation_time_hrs double precision,
    default_temperature_c double precision,
    default_moisture_pct double precision,
    default_separation_method text,
    default_downstream_method text,
    lang_factor_typical double precision DEFAULT 3.0,
    applicable_substrate_clusters text[],
    not_applicable_for text[],
    notes text
);
-- product_conversions
CREATE TABLE IF NOT EXISTS public.product_conversions (
    conversion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_type text NOT NULL,
    from_unit text DEFAULT 'g_per_g_substrate'::text NOT NULL,
    to_unit text NOT NULL,
    factor double precision DEFAULT 1.0 NOT NULL,
    requires_loading boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);
-- project_drive_files
CREATE TABLE IF NOT EXISTS public.project_drive_files (
    file_id text NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    mime_type text,
    web_view_link text,
    modified_time timestamp with time zone,
    size_bytes bigint,
    content_text text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_files_project ON public.project_drive_files USING btree (project_id);
-- project_portals
CREATE TABLE IF NOT EXISTS public.project_portals (
    portal_id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text DEFAULT encode(public.gen_random_bytes(32), 'hex'::text) NOT NULL,
    project_id uuid,
    label text,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    portal_drive_folder_id text,
    portal_drive_folder_name text,
    description text,
    is_password_protected boolean DEFAULT false NOT NULL,
    password_hash text,
    name text
);
CREATE INDEX IF NOT EXISTS project_portals_project_id_idx ON public.project_portals USING btree (project_id);
CREATE INDEX IF NOT EXISTS project_portals_token_idx ON public.project_portals USING btree (token);
-- projects
CREATE TABLE IF NOT EXISTS public.projects (
    project_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    project_type text DEFAULT 'crm_opportunity'::text NOT NULL,
    stage text,
    status text DEFAULT 'active'::text,
    contact_id uuid,
    odoo_project_id integer,
    odoo_crm_id integer,
    probability numeric(5,2),
    expected_revenue numeric(12,2),
    date_start date,
    date_deadline date,
    tags text[] DEFAULT '{}'::text[],
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    drive_folder_id text,
    drive_folder_name text,
    drive_synced_at timestamp with time zone,
    section text,
    crm_type text DEFAULT 'lead'::text,
    CONSTRAINT projects_section_check CHECK ((section = ANY (ARRAY['client'::text, 'partnership'::text])))
);
CREATE INDEX IF NOT EXISTS projects_contact_idx ON public.projects USING btree (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_odoo_crm_idx ON public.projects USING btree (odoo_crm_id) WHERE (odoo_crm_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS projects_odoo_project_idx ON public.projects USING btree (odoo_project_id) WHERE (odoo_project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS projects_section_idx ON public.projects USING btree (section);
-- project_tasks
CREATE TABLE IF NOT EXISTS public.project_tasks (
    task_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    odoo_task_id integer,
    name text NOT NULL,
    stage text,
    state text,
    date_deadline timestamp with time zone,
    description text,
    is_done boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_tasks_odoo_idx ON public.project_tasks USING btree (odoo_task_id) WHERE (odoo_task_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON public.project_tasks USING btree (project_id);
-- protocol_revisions
CREATE TABLE IF NOT EXISTS public.protocol_revisions (
    revision_id text DEFAULT (gen_random_uuid())::text NOT NULL,
    protocol_id text NOT NULL,
    revised_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    protocol_type text,
    author text,
    organism text,
    substrate text,
    vessel_type text,
    scale text,
    notes text,
    tags text[],
    content_markdown text,
    is_internal boolean,
    version_label text,
    is_major boolean DEFAULT false NOT NULL,
    change_summary text,
    changed_by uuid
);
CREATE INDEX IF NOT EXISTS idx_protocol_revisions_protocol_id ON public.protocol_revisions USING btree (protocol_id);
-- protocols
CREATE TABLE IF NOT EXISTS public.protocols (
    protocol_id uuid DEFAULT gen_random_uuid() NOT NULL,
    protocol_type text NOT NULL,
    title text NOT NULL,
    version text DEFAULT '1.0'::text,
    status text DEFAULT 'draft'::text,
    source_type text DEFAULT 'generated'::text,
    source_queue_id uuid,
    source_genome_edit_id uuid,
    source_paper_doi text,
    source_citation text,
    content_docx_path text,
    content_markdown text,
    content_json jsonb,
    organism text,
    substrate text,
    vessel_type text,
    scale text,
    created_at timestamp with time zone DEFAULT now(),
    created_by text DEFAULT 'system'::text,
    approved_by text,
    approved_at timestamp with time zone,
    notes text,
    tags text[],
    author text,
    is_internal boolean DEFAULT false NOT NULL,
    version_major integer DEFAULT 1 NOT NULL,
    version_minor integer DEFAULT 0 NOT NULL,
    CONSTRAINT protocols_protocol_type_check CHECK ((protocol_type = ANY (ARRAY['fermentation_method'::text, 'medium_preparation'::text, 'downstream_processing'::text, 'genome_edit_sop'::text, 'analytical_assay'::text, 'strain_maintenance'::text, 'substrate_preparation'::text, 'other'::text]))),
    CONSTRAINT protocols_source_type_check CHECK ((source_type = ANY (ARRAY['generated'::text, 'extracted'::text, 'manual'::text, 'imported'::text]))),
    CONSTRAINT protocols_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'archived'::text])))
);
CREATE INDEX IF NOT EXISTS idx_protocols_organism ON public.protocols USING btree (organism);
CREATE INDEX IF NOT EXISTS idx_protocols_status ON public.protocols USING btree (status);
CREATE INDEX IF NOT EXISTS idx_protocols_type ON public.protocols USING btree (protocol_type);
-- route_tea_results
CREATE TABLE IF NOT EXISTS public.route_tea_results (
    result_id uuid DEFAULT gen_random_uuid() NOT NULL,
    substrate_id uuid,
    candidate_output text NOT NULL,
    route_code text,
    pilot_mpsp_usd_kg double precision,
    pilot_npv_usd double precision,
    pilot_capex_usd double precision,
    pilot_opex_usd_yr double precision,
    pilot_titer_assumed double precision,
    pilot_titer_unit text,
    pilot_titer_confidence text,
    pilot_titer_citation text,
    pilot_enzyme_cost_usd_yr double precision,
    pilot_recommendation text,
    pilot_margin_headroom double precision,
    commercial_mpsp_usd_kg double precision,
    commercial_npv_usd double precision,
    commercial_capex_usd double precision,
    commercial_scale_factor double precision DEFAULT 50.0,
    commercial_recommendation text,
    config_id uuid,
    simulation_method text,
    market_price_lo double precision,
    market_price_hi double precision,
    is_best_route boolean DEFAULT false,
    rank_by_mpsp integer,
    computed_at timestamp with time zone DEFAULT now(),
    notes text,
    feedstock_cost_scenario text,
    feedstock_cost_usd_ton double precision,
    workbook_summary jsonb,
    inference_provenance jsonb
);
CREATE INDEX IF NOT EXISTS idx_route_tea_route ON public.route_tea_results USING btree (route_code);
CREATE INDEX IF NOT EXISTS idx_route_tea_substrate ON public.route_tea_results USING btree (substrate_id, candidate_output);
-- run_lineage
CREATE TABLE IF NOT EXISTS public.run_lineage (
    lineage_id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    field_name text NOT NULL,
    value_raw text,
    unit_raw text,
    conversion_applied text,
    source_type text NOT NULL,
    paper_id uuid,
    queue_id uuid,
    doi text,
    evidence_quote text,
    assumption_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT run_lineage_source_type_check CHECK ((source_type = ANY (ARRAY['measured'::text, 'literature'::text, 'estimated'::text, 'assumed'::text])))
);
CREATE INDEX IF NOT EXISTS idx_rl_run ON public.run_lineage USING btree (run_id);
-- species_level_observations
CREATE TABLE IF NOT EXISTS public.species_level_observations (
    obs_id uuid DEFAULT gen_random_uuid() NOT NULL,
    queue_id uuid,
    paper_id uuid,
    source_doi text,
    source_citation text,
    species_name text NOT NULL,
    strain_description text,
    substrate_name_raw text,
    substrate_id_matched uuid,
    substrate_cluster text,
    fermentation_type text DEFAULT 'SSF'::text,
    enzyme_class text,
    ec_number text,
    titer_value double precision NOT NULL,
    titer_unit text NOT NULL,
    titer_normalized_u_ml double precision,
    temp_c double precision,
    initial_ph double precision,
    duration_hrs double precision,
    moisture_pct double precision,
    confidence double precision,
    evidence_quote text,
    used_for_calibration boolean DEFAULT false,
    calibration_output text,
    calibration_approved_by text,
    calibration_approved_at timestamp with time zone,
    calibration_notes text,
    approved_at timestamp with time zone DEFAULT now(),
    approved_by text,
    notes text
);
CREATE INDEX IF NOT EXISTS idx_slo_enzyme ON public.species_level_observations USING btree (ec_number);
CREATE INDEX IF NOT EXISTS idx_slo_species ON public.species_level_observations USING btree (species_name);
CREATE INDEX IF NOT EXISTS idx_slo_substrate ON public.species_level_observations USING btree (substrate_cluster);
-- substrate_composition_sources
CREATE TABLE IF NOT EXISTS public.substrate_composition_sources (
    source_id uuid DEFAULT gen_random_uuid() NOT NULL,
    substrate_id uuid NOT NULL,
    field_name text NOT NULL,
    value double precision,
    source_type text NOT NULL,
    confidence text,
    paper_id uuid,
    doi text,
    url text,
    citation text,
    evidence_quote text,
    assumption_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text DEFAULT 'composition_agent'::text,
    CONSTRAINT substrate_composition_sources_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT substrate_composition_sources_source_type_check CHECK ((source_type = ANY (ARRAY['measured'::text, 'literature'::text, 'usda'::text, 'estimated'::text, 'assumed'::text])))
);
CREATE INDEX IF NOT EXISTS idx_scs_field ON public.substrate_composition_sources USING btree (substrate_id, field_name);
CREATE INDEX IF NOT EXISTS idx_scs_substrate ON public.substrate_composition_sources USING btree (substrate_id);
-- target_product_classes
CREATE TABLE IF NOT EXISTS public.target_product_classes (
    enzyme_class_pattern text NOT NULL,
    target_product text NOT NULL,
    product_display_name text NOT NULL,
    notes text
);
-- tea_process_configs
CREATE TABLE IF NOT EXISTS public.tea_process_configs (
    config_id uuid DEFAULT gen_random_uuid() NOT NULL,
    substrate_id uuid NOT NULL,
    output_name text NOT NULL,
    version_name text DEFAULT 'Default'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    substrate_input_kg_hr double precision DEFAULT 10.0,
    operating_days integer DEFAULT 330,
    bioreactor_count integer DEFAULT 1,
    bioreactor_mode text DEFAULT 'batch'::text,
    fermentation_time_hrs double precision DEFAULT 96.0,
    temperature_c double precision DEFAULT 30.0,
    vessel_volume_m3 double precision DEFAULT 1.0,
    inoculum_fraction double precision DEFAULT 0.10,
    aeration_vvm double precision DEFAULT 0.0,
    agitation_rpm double precision DEFAULT 0.0,
    conversion_cellulose_pct double precision DEFAULT 0.60,
    conversion_hemicellulose_pct double precision DEFAULT 0.70,
    conversion_starch_pct double precision DEFAULT 0.90,
    titer_g_l double precision,
    titer_source text DEFAULT 'literature'::text,
    titer_citation text,
    titer_confidence text DEFAULT 'medium'::text,
    yield_g_g double precision,
    yield_source text DEFAULT 'literature'::text,
    yield_citation text,
    yield_confidence text DEFAULT 'medium'::text,
    sub_cost_per_ton double precision DEFAULT 40.0,
    sub_cost_citation text,
    separation_method text DEFAULT 'centrifuge'::text,
    centrifuge_solids_recovery_pct double precision DEFAULT 0.95,
    centrifuge_cake_moisture_pct double precision DEFAULT 0.65,
    membrane_rejection_pct double precision DEFAULT 0.95,
    membrane_flux_lmh double precision DEFAULT 50.0,
    crystallization_yield_pct double precision DEFAULT 0.75,
    extraction_solvent text DEFAULT 'water'::text,
    extraction_yield_pct double precision DEFAULT 0.80,
    downstream_method text DEFAULT 'drum_dryer'::text,
    dryer_inlet_moisture_pct double precision DEFAULT 0.65,
    dryer_outlet_moisture_pct double precision DEFAULT 0.05,
    dryer_inlet_temp_c double precision DEFAULT 120.0,
    spray_dryer_outlet_temp_c double precision DEFAULT 80.0,
    electricity_usd_kwh double precision DEFAULT 0.07,
    steam_usd_gj double precision DEFAULT 8.0,
    cooling_water_usd_gj double precision DEFAULT 0.25,
    process_water_usd_m3 double precision DEFAULT 2.50,
    enzyme_loading_usd_kg_cellulose double precision DEFAULT 0.05,
    chemicals_usd_tonne_product double precision DEFAULT 25.0,
    inoculum_cost_usd_kg double precision DEFAULT 2.0,
    heat_integration boolean DEFAULT false,
    cooling_water_temp_in_c double precision DEFAULT 20.0,
    steam_pressure_bar double precision DEFAULT 4.0,
    ww_cod_kg_per_tonne_product double precision DEFAULT 15.0,
    ww_treatment_cost_usd_m3 double precision DEFAULT 2.50,
    ww_recycle_fraction double precision DEFAULT 0.80,
    operators_per_shift integer DEFAULT 2,
    shifts_per_day integer DEFAULT 3,
    wage_rate_usd_hr double precision DEFAULT 35.0,
    labor_burden_fraction double precision DEFAULT 0.40,
    lang_factor double precision DEFAULT 3.0,
    contingency_pct_capex double precision DEFAULT 0.10,
    working_capital_pct_fci double precision DEFAULT 0.05,
    maintenance_pct_capex double precision DEFAULT 0.02,
    insurance_pct_capex double precision DEFAULT 0.005,
    overhead_pct_labor double precision DEFAULT 0.60,
    irr_pct double precision DEFAULT 15.0,
    project_life_yrs integer DEFAULT 10,
    income_tax_rate double precision DEFAULT 0.21,
    depreciation text DEFAULT 'MACRS7'::text,
    construction_schedule text DEFAULT '40_60'::text,
    startup_time_months integer DEFAULT 3,
    startup_capacity_pct double precision DEFAULT 0.50,
    debt_fraction double precision DEFAULT 0.0,
    interest_rate_pct double precision DEFAULT 0.0,
    salvage_value_pct_capex double precision DEFAULT 0.05,
    project_start_year integer DEFAULT 2025,
    price_scenario text DEFAULT 'midpoint'::text,
    custom_price_usd_kg double precision,
    process_mode text DEFAULT 'ssf_only'::text,
    enzyme_supplementation jsonb,
    route_code text,
    feedstock_cost_scenario text DEFAULT 'nominal'::text,
    feedstock_nominal_cost_per_ton double precision,
    feedstock_cost_citation text,
    feedstock_gate_fee_usd_ton double precision,
    CONSTRAINT tea_process_configs_feedstock_cost_scenario_check CHECK ((feedstock_cost_scenario = ANY (ARRAY['zero'::text, 'nominal'::text, 'low'::text, 'high'::text, 'custom'::text]))),
    CONSTRAINT tea_process_configs_process_mode_check CHECK ((process_mode = ANY (ARRAY['ssf_only'::text, 'enzyme_supplemented'::text, 'enzyme_only'::text])))
);
CREATE INDEX IF NOT EXISTS idx_tea_config_substrate ON public.tea_process_configs USING btree (substrate_id, output_name);
-- time_logs
CREATE TABLE IF NOT EXISTS public.time_logs (
    log_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    block_id uuid,
    task_id uuid,
    description text,
    logged_minutes integer NOT NULL,
    log_date date DEFAULT CURRENT_DATE NOT NULL,
    logged_at timestamp with time zone DEFAULT now(),
    CONSTRAINT time_logs_logged_minutes_check CHECK ((logged_minutes > 0))
);
CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON public.time_logs USING btree (user_id, log_date);
-- weekly_plans
CREATE TABLE IF NOT EXISTS public.weekly_plans (
    plan_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    week_start date NOT NULL,
    week_summary text,
    ai_reasoning text,
    status text DEFAULT 'active'::text,
    generated_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_user_week ON public.weekly_plans USING btree (user_id, week_start);
