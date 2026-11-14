-- 協力者（連投制限なしの投稿 URL /c/<token> を渡す相手）。schema.sql から作った新しい DB には不要
CREATE TABLE IF NOT EXISTS collaborators (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  token      TEXT    NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
ALTER TABLE bottles ADD COLUMN collaborator_id INTEGER;
