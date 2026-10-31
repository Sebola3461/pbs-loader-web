-- Envio de mod pelo site: cada linha é uma operação (publish, edit, remove, hide) com autor, data e estado,
-- e é dela que nasce o PR no repo do catálogo. mod_id não tem FK: os mods vivem no catálogo em Git,
-- e a API confere existência e posse no catálogo publicado antes de gravar.

CREATE TABLE submissions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  mod_id TEXT NOT NULL CHECK (length(mod_id) BETWEEN 2 AND 64),
  operation TEXT NOT NULL CHECK (operation IN ('publish', 'edit', 'remove', 'hide')),
  -- JSON do mod em publish e edit; remover e ocultar não levam payload. O PR nasce daqui, inclusive
  -- no reenvio de uma submissão failed.
  payload TEXT CHECK (
    (operation IN ('publish', 'edit')) = (payload IS NOT NULL)
    AND (payload IS NULL OR json_valid(payload))
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'rejected', 'failed')),
  pr_number INTEGER CHECK (pr_number IS NULL OR pr_number > 0),
  -- Por que falhou: obrigatório exatamente quando a submissão failed.
  error_code TEXT CHECK (status != 'failed' OR error_code IS NOT NULL),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
) STRICT;

CREATE INDEX submissions_by_user ON submissions (user_id, created_at);
CREATE INDEX submissions_by_status ON submissions (status, mod_id);
