CREATE TABLE IF NOT EXISTS code_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  inputs_json TEXT,
  function_name TEXT,
  seed INTEGER,
  example_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS code_history_user_last_run_idx
  ON code_history(user_id, last_run_at DESC);

