-- M13: guest task isolation + user variant cache
SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'guest_key') = 0,
  'ALTER TABLE tasks ADD COLUMN guest_key VARCHAR(64) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_guest_created') = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_guest_created (guest_key, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS variant_cache_entries (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_user_id BIGINT NOT NULL,
  word VARCHAR(255) NOT NULL,
  variant VARCHAR(255) NOT NULL,
  source VARCHAR(64) NULL,
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_variant_cache_owner_word_variant (owner_user_id, word, variant),
  INDEX idx_variant_cache_owner_word_created (owner_user_id, word, created_at),
  INDEX idx_variant_cache_owner_created (owner_user_id, created_at),
  CONSTRAINT fk_variant_cache_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
