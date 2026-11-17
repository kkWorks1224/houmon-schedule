-- 利用者の住所（地図・経路を開くため）
ALTER TABLE clients ADD COLUMN address TEXT NOT NULL DEFAULT '';
