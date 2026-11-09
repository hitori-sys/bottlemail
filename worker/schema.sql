-- ボトルメールの投稿
-- status: pending（確認待ち） / approved（公開） / rejected（却下） / removed（取り下げ）
CREATE TABLE IF NOT EXISTS bottles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT    NOT NULL,
  image       BLOB,
  image_type  TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending',
  slot        INTEGER,            -- 画像の置き場所（atlas * 16 + cell）。承認時に割り当て、以後固定
  pinned      INTEGER NOT NULL DEFAULT 0, -- 1 なら期限で沈まない（管理者の投稿用）
  ip_hash     TEXT,               -- 連投制限用（IP そのものは保存しない）
  created_at  INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bottles_status ON bottles(status);
CREATE INDEX IF NOT EXISTS idx_bottles_ip     ON bottles(ip_hash, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bottles_slot ON bottles(slot) WHERE slot IS NOT NULL;
