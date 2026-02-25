-- v1 official schema (M2), idempotent for MySQL 8.0
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) NULL,
  email VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  INDEX idx_user_roles_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT NOT NULL,
  permission_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  INDEX idx_role_permissions_perm (permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NULL,
  target_id VARCHAR(128) NULL,
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_action (action),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS data_sources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL UNIQUE,
  base_url VARCHAR(512) NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  default_granularity VARCHAR(16) NOT NULL DEFAULT 'day',
  config_json JSON NULL,
  last_sync_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_data_sources_enabled (is_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lexicon_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL UNIQUE,
  note VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lexicon_versions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lexicon_terms (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  canonical VARCHAR(255) NOT NULL,
  category VARCHAR(32) NULL,
  language VARCHAR(16) NULL,
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lexicon_terms_canonical (canonical),
  INDEX idx_lexicon_terms_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lexicon_variants (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  term_id BIGINT NOT NULL,
  variant VARCHAR(255) NOT NULL,
  variant_type VARCHAR(32) NULL,
  source VARCHAR(64) NULL,
  version_id BIGINT NULL,
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lexicon_variants_term FOREIGN KEY (term_id) REFERENCES lexicon_terms(id) ON DELETE CASCADE,
  CONSTRAINT fk_lexicon_variants_version FOREIGN KEY (version_id) REFERENCES lexicon_versions(id) ON DELETE SET NULL,
  UNIQUE KEY uq_lexicon_variants_term_variant (term_id, variant),
  INDEX idx_lexicon_variants_term (term_id),
  INDEX idx_lexicon_variants_version (version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lexicon_import_jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT NULL,
  source VARCHAR(64) NOT NULL,
  input_artifact VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  summary_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lexicon_import_jobs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_lexicon_import_jobs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id VARCHAR(255) NOT NULL UNIQUE,
  task_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  params_json JSON NULL,
  result_json JSON NULL,
  error_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tasks_status (status),
  INDEX idx_tasks_type (task_type),
  INDEX idx_tasks_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id VARCHAR(255) NOT NULL,
  ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  level VARCHAR(16) NOT NULL DEFAULT 'INFO',
  message VARCHAR(1024) NOT NULL,
  meta_json JSON NULL,
  CONSTRAINT fk_task_events_task FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  INDEX idx_task_events_task (task_id),
  INDEX idx_task_events_ts (ts),
  INDEX idx_task_events_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_artifacts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id VARCHAR(255) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  path VARCHAR(512) NOT NULL,
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_artifacts_task FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  UNIQUE KEY uq_task_artifacts_unique (task_id, kind, filename),
  INDEX idx_task_artifacts_task (task_id),
  INDEX idx_task_artifacts_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS time_series (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  term_id BIGINT NOT NULL,
  variant_id BIGINT NULL,
  source_id BIGINT NOT NULL,
  granularity VARCHAR(16) NOT NULL,
  window_start DATE NULL,
  window_end DATE NULL,
  units VARCHAR(32) NULL,
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_time_series_term FOREIGN KEY (term_id) REFERENCES lexicon_terms(id) ON DELETE CASCADE,
  CONSTRAINT fk_time_series_variant FOREIGN KEY (variant_id) REFERENCES lexicon_variants(id) ON DELETE SET NULL,
  CONSTRAINT fk_time_series_source FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE RESTRICT,
  INDEX idx_time_series_term (term_id),
  INDEX idx_time_series_variant (variant_id),
  INDEX idx_time_series_source (source_id),
  INDEX idx_time_series_granularity (granularity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS time_series_points (
  series_id BIGINT NOT NULL,
  t DATE NOT NULL,
  value DOUBLE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (series_id, t),
  CONSTRAINT fk_time_series_points_series FOREIGN KEY (series_id) REFERENCES time_series(id) ON DELETE CASCADE,
  INDEX idx_time_series_points_t (t)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO data_sources (name, default_granularity, is_enabled) VALUES
  ('GDELT', 'day', 1),
  ('GBNC', 'year', 1);

INSERT IGNORE INTO lexicon_versions (name, note, is_active) VALUES
  ('v1-initial', 'Initial lexicon version created by M2 bootstrap', 1);

INSERT IGNORE INTO roles (name, description) VALUES
  ('admin', 'Administrator role'),
  ('user', 'Normal user role');

INSERT IGNORE INTO permissions (code, description) VALUES
  ('admin.lexicon.write', 'Manage lexicon terms and variants'),
  ('admin.datasource.write', 'Manage external data sources'),
  ('task.read', 'Read tasks and artifacts'),
  ('task.create', 'Create tasks');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'admin';
