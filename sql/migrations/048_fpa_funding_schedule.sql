-- Migration 048: FP&A - unified funding schedule (dilutive + non-dilutive)
ALTER TABLE public.fpa_model
  ADD COLUMN IF NOT EXISTS funding_schedule JSONB DEFAULT '[]'::jsonb;
