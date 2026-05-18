-- Migration 047: FP&A - expense_schedule driver column
ALTER TABLE public.fpa_model
  ADD COLUMN IF NOT EXISTS expense_schedule JSONB DEFAULT '[]'::jsonb;
