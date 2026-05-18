-- Migration 046: FP&A v2 - Driver-based modeling and version history

-- Add driver columns to active model
ALTER TABLE public.fpa_model
  ADD COLUMN IF NOT EXISTS contract_pipeline JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS headcount_schedule JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS change_summary TEXT;

-- Immutable version history: every committed save appends a row here
CREATE TABLE IF NOT EXISTS public.fpa_model_versions (
  version_id  UUID        DEFAULT gen_random_uuid() NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by  TEXT,
  change_summary TEXT,
  scenario_name  TEXT,
  model_snapshot JSONB NOT NULL,
  audit_data     JSONB DEFAULT '[]'::jsonb,
  CONSTRAINT fpa_model_versions_pkey PRIMARY KEY (version_id)
);

CREATE INDEX IF NOT EXISTS idx_fpa_model_versions_created
  ON public.fpa_model_versions USING btree (created_at DESC);
