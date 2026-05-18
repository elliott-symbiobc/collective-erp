-- Migration: user-manageable category and status lists for lab equipment

CREATE TABLE IF NOT EXISTS equipment_categories (
    name TEXT PRIMARY KEY
);

INSERT INTO equipment_categories (name) VALUES
  ('Autoclave'),('Balance'),('Biosafety Cabinet'),('Centrifuge'),('Freezer'),
  ('Fridge'),('Incubator'),('Microscope'),('Other'),('PCR Machine'),
  ('Shaker'),('Spectrophotometer')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS equipment_statuses (
    name  TEXT PRIMARY KEY,
    color TEXT NOT NULL DEFAULT 'gray'
);

INSERT INTO equipment_statuses (name, color) VALUES
  ('operational',    'green'),
  ('maintenance',    'amber'),
  ('out_of_order',   'red'),
  ('decommissioned', 'gray')
ON CONFLICT DO NOTHING;
