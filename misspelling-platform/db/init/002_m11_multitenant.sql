-- 文件说明：数据库迁移脚本，负责补齐多租户与权限相关结构。

-- M11 multi-tenant owner columns + indexes (idempotent for MySQL 8.0)
SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'owner_user_id') = 0,
  'ALTER TABLE tasks ADD COLUMN owner_user_id BIGINT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_owner_created') = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_owner_created (owner_user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'time_series' AND COLUMN_NAME = 'owner_user_id') = 0,
  'ALTER TABLE time_series ADD COLUMN owner_user_id BIGINT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'time_series' AND INDEX_NAME = 'idx_time_series_owner_created') = 0,
  'ALTER TABLE time_series ADD INDEX idx_time_series_owner_created (owner_user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_artifacts' AND COLUMN_NAME = 'owner_user_id') = 0,
  'ALTER TABLE task_artifacts ADD COLUMN owner_user_id BIGINT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_artifacts' AND INDEX_NAME = 'idx_task_artifacts_owner_created') = 0,
  'ALTER TABLE task_artifacts ADD INDEX idx_task_artifacts_owner_created (owner_user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lexicon_terms' AND COLUMN_NAME = 'owner_user_id') = 0,
  'ALTER TABLE lexicon_terms ADD COLUMN owner_user_id BIGINT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lexicon_terms' AND INDEX_NAME = 'idx_lexicon_terms_owner_created') = 0,
  'ALTER TABLE lexicon_terms ADD INDEX idx_lexicon_terms_owner_created (owner_user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lexicon_variants' AND COLUMN_NAME = 'owner_user_id') = 0,
  'ALTER TABLE lexicon_variants ADD COLUMN owner_user_id BIGINT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lexicon_variants' AND INDEX_NAME = 'idx_lexicon_variants_owner_created') = 0,
  'ALTER TABLE lexicon_variants ADD INDEX idx_lexicon_variants_owner_created (owner_user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
