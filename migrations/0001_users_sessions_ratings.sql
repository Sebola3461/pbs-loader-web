-- Usuários do site (login com Google), sessões e avaliações por estrelas.
-- Datas em texto ISO-8601 UTC (Date.toISOString), que ordena como texto.

CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  google_sub TEXT NOT NULL UNIQUE CHECK (length(google_sub) BETWEEN 1 AND 255),
  nickname TEXT CHECK (nickname IS NULL OR length(nickname) BETWEEN 3 AND 24),
  -- Apelido em minúsculas: "Fulana" e "fulana" não podem coexistir.
  nickname_key TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((nickname IS NULL) = (nickname_key IS NULL))
) STRICT;

-- Histórico só de inserção do que muda num usuário: quem fez, quando e qual operação.
CREATE TABLE user_events (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'rename', 'ban', 'unban', 'role')),
  detail TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX user_events_by_user ON user_events (user_id, created_at);
CREATE INDEX user_events_by_actor ON user_events (actor_id);

-- O cookie leva o token; aqui fica só o SHA-256 dele, para um vazamento do banco não virar sessão válida.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);

-- mod_id não tem FK: os mods vivem no catálogo em Git, e a API confere se o mod existe antes de gravar.
CREATE TABLE ratings (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mod_id TEXT NOT NULL CHECK (length(mod_id) BETWEEN 2 AND 64),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, mod_id)
) STRICT;

CREATE INDEX ratings_by_mod ON ratings (mod_id);

CREATE TABLE rating_events (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  mod_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('set', 'remove')),
  stars INTEGER CHECK (
    (operation = 'set' AND stars BETWEEN 1 AND 5) OR (operation = 'remove' AND stars IS NULL)
  ),
  created_at TEXT NOT NULL
) STRICT;

-- Também atende o limite de mudanças por hora (por usuário, a partir de uma data).
CREATE INDEX rating_events_by_user ON rating_events (user_id, created_at);
CREATE INDEX rating_events_by_mod ON rating_events (mod_id);
