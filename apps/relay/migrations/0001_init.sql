-- requests: one row per question relayed to the master Bot.
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,                 -- accepted | processing | awaiting_approval | completed | failed | delivery_unknown
  answer TEXT,
  error_code TEXT,
  external_run_ref TEXT,
  result_token_hash TEXT NOT NULL,      -- sha256 of the per-request token the Bot must present
  result_token_expires_at TEXT NOT NULL,
  result_received_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_requests_owner_status ON requests (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_token_hash ON requests (result_token_hash);
-- MVP: at most one in-flight request per owner, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_one_active ON requests (owner_id)
  WHERE status IN ('accepted', 'processing', 'awaiting_approval', 'delivery_unknown');
