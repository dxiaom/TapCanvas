-- 手机号登录/注册：同一手机号只允许一个有效账号。
-- 部分唯一索引：未删除且已填 phone 的用户行内 phone 唯一；guest/历史数据不受影响。
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_unique"
  ON "users"("phone")
  WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL;
