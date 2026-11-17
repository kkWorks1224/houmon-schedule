-- 訪問スケジュール：定期ルール（series）と、各回の変更・単発の予定（visits）を分けて保存する
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 利用を許可するアカウント（メールアドレス単位）
CREATE TABLE members (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  added_at INTEGER NOT NULL
);

CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mark TEXT NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kana TEXT NOT NULL DEFAULT '',
  default_duration INTEGER NOT NULL,
  default_kind TEXT NOT NULL,
  default_staff_id TEXT NOT NULL,
  default_start INTEGER,
  memo TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE series (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  kind TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  weekdays TEXT NOT NULL,
  interval INTEGER NOT NULL CHECK (interval IN (1, 2)),
  start_date TEXT NOT NULL,
  end_date TEXT,
  anchor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_series_range ON series(start_date, end_date);

CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'done', 'skipped')),
  series_id TEXT,
  occ_date TEXT,
  template_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_visits_date ON visits(date, staff_id);
CREATE INDEX idx_visits_client ON visits(client_id, date);
-- 定期の同じ回に例外は1件だけ（二重登録の防止）
CREATE UNIQUE INDEX idx_visits_occ ON visits(series_id, occ_date) WHERE series_id IS NOT NULL;

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  weekday INTEGER NOT NULL,
  start INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE ai_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- 変更の記録（誰がいつ何をしたか。内容は保存しない）
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  email TEXT NOT NULL,
  action TEXT NOT NULL,
  ops INTEGER NOT NULL
);
CREATE INDEX idx_audit_at ON audit_log(at);
