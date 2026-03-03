-- M12 enterprise extensions: projects, reports, task lineage, diagnostics metadata
SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'parent_task_id') = 0,
  'ALTER TABLE tasks ADD COLUMN parent_task_id VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'deleted_at') = 0,
  'ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_parent') = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_parent (parent_task_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_deleted_at') = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_deleted_at (deleted_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_user_id BIGINT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_projects_owner_name (owner_user_id, name),
  INDEX idx_projects_owner_created (owner_user_id, created_at),
  CONSTRAINT fk_projects_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_terms (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  term_id BIGINT NOT NULL,
  category VARCHAR(32) NULL,
  weight DOUBLE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_terms (project_id, term_id),
  INDEX idx_project_terms_project (project_id),
  INDEX idx_project_terms_term (term_id),
  CONSTRAINT fk_project_terms_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_terms_term FOREIGN KEY (term_id) REFERENCES lexicon_terms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  task_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_tasks (project_id, task_id),
  INDEX idx_project_tasks_project (project_id),
  INDEX idx_project_tasks_task (task_id),
  CONSTRAINT fk_project_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_tasks_task FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS report_exports (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_user_id BIGINT NULL,
  task_id VARCHAR(255) NULL,
  project_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  format VARCHAR(16) NOT NULL DEFAULT 'html',
  filename VARCHAR(255) NULL,
  path VARCHAR(512) NULL,
  summary_json JSON NULL,
  error_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_report_owner_created (owner_user_id, created_at),
  INDEX idx_report_task (task_id),
  INDEX idx_report_project (project_id),
  CONSTRAINT fk_report_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_report_task FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE SET NULL,
  CONSTRAINT fk_report_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_user_id BIGINT NULL,
  project_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
  method VARCHAR(64) NOT NULL DEFAULT 'baseline-kmeans',
  params_json JSON NULL,
  result_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_analytics_owner_created (owner_user_id, created_at),
  CONSTRAINT fk_analytics_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_analytics_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
