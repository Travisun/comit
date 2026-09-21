-- 建部分唯一索引前先收敛历史重复：同一用户多条 pending 时保留最早一条，其余转
-- 'rejected'（不删行：描述与附件是审计痕迹，语义为「重复合并到首条」）。
-- 不去重则 CREATE UNIQUE INDEX 直接失败、整个迁移中断。
UPDATE "verification_requests" SET
  "status" = 'rejected',
  "reject_reason" = '重复申请已自动合并 / Duplicate request auto-merged'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "user_id" ORDER BY "created_at", "id"
           ) AS rn
    FROM "verification_requests"
    WHERE "status" = 'pending'
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

CREATE UNIQUE INDEX "verification_one_pending_key" ON "verification_requests" USING btree ("user_id") WHERE status = 'pending';