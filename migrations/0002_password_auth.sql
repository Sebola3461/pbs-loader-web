-- Login próprio (usuário + senha): o apelido público passa a ser o login, agora chamado username, e o Google sai.
-- Nenhuma conta real existe (o site ainda não foi ao ar), então users e user_events são recriados vazios:
-- o que houver de dados locais de desenvolvimento é descartado de propósito.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  username TEXT NOT NULL CHECK (length(username) BETWEEN 3 AND 24),
  -- Nome de login em minúsculas: "Ana" e "ana" não podem coexistir.
  username_key TEXT NOT NULL UNIQUE,
  -- Formato auto-descritivo "pbkdf2$sha256$<iterações>$<salt>$<hash>", que permite subir as iterações no futuro.
  password_hash TEXT NOT NULL CHECK (
    password_hash LIKE 'pbkdf2$sha256$%' AND length(password_hash) BETWEEN 40 AND 400
  ),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE user_events_new (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (
    operation IN ('create', 'rename', 'ban', 'unban', 'role', 'password_change')
  ),
  detail TEXT,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO user_events_new SELECT id, user_id, actor_id, operation, detail, created_at FROM user_events;

DROP TABLE user_events;
ALTER TABLE user_events_new RENAME TO user_events;

CREATE INDEX user_events_by_user ON user_events (user_id, created_at);
CREATE INDEX user_events_by_actor ON user_events (actor_id);

-- Trava de força bruta: contador por janela de uma hora, separado por conta e por IP.
CREATE TABLE auth_attempts (
  kind TEXT NOT NULL CHECK (kind IN ('login-account', 'login-ip', 'register-ip')),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 64),
  -- Janela em texto ISO cheio ("2026-10-31T19:00:00.000Z"), que compara certo como texto.
  window TEXT NOT NULL CHECK (length(window) = 24),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (kind, key, window)
) STRICT;
