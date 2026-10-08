CREATE TABLE IF NOT EXISTS ground_zero_snapshots (
  id serial PRIMARY KEY,
  as_of_date date NOT NULL,
  total_value_ore bigint NOT NULL CHECK (total_value_ore >= 0),
  net_external_flows_ore bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
