-- 期限で沈まない印（管理者の投稿用）。schema.sql から作った新しい DB には不要
ALTER TABLE bottles ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
