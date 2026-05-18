-- Migration 049: add is_default flag to version history
ALTER TABLE public.fpa_model_versions
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
