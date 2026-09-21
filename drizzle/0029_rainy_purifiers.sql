-- 建立两条去重约束前的历史数据收敛（只处理重复项，不删业务内容）：
--
-- 1) mentions：此前无唯一约束，三处写入点的 onConflictDoNothing 形同装饰，
--    重试/并发可积累同 (user_id, target_type, target_id) 的重复行。行内除时间戳
--    外无独立信息（通知正文在 notifications），故保留最早一条、删除其余。
--    优先保留已通知的那条，避免约束生效后重复发送「被 @ 提及」通知。
DELETE FROM "mentions" WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "user_id", "target_type", "target_id"
             ORDER BY "notified_at" NULLS LAST, "created_at"
           ) AS rn
    FROM "mentions"
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

-- 2) reports：同一举报人对同一目标的多条未处理举报只保留最早一条，其余转
--    'dismissed'（不删行：理由文本与审计痕迹保留，语义即「合并到首条，未单独处理」）。
UPDATE "reports" SET "status" = 'dismissed' WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "reporter_id", "target_type", "target_id"
             ORDER BY "created_at"
           ) AS rn
    FROM "reports" WHERE "status" = 'open'
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

CREATE UNIQUE INDEX "mentions_user_target_key" ON "mentions" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_key" ON "reports" USING btree ("reporter_id","target_type","target_id") WHERE status = 'open';
