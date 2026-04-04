-- M14: project cohorts + term memberships for advanced analytics workflows
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS project_cohorts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  color VARCHAR(32) NULL,
  rule_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_cohort_name (project_id, name),
  INDEX idx_project_cohort_project_sort (project_id, sort_order, id),
  CONSTRAINT fk_project_cohort_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_term_memberships (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  term_id BIGINT NOT NULL,
  cohort_id BIGINT NOT NULL,
  membership_weight DOUBLE NOT NULL DEFAULT 1.0,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  confidence DOUBLE NOT NULL DEFAULT 1.0,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_term_membership (project_id, term_id, cohort_id),
  INDEX idx_project_term_membership_project_term (project_id, term_id),
  INDEX idx_project_term_membership_project_cohort (project_id, cohort_id),
  INDEX idx_project_term_membership_cohort_weight (cohort_id, membership_weight),
  CONSTRAINT fk_project_term_membership_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_term_membership_term FOREIGN KEY (term_id) REFERENCES lexicon_terms(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_term_membership_cohort FOREIGN KEY (cohort_id) REFERENCES project_cohorts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create a default cohort so uncategorized terms can still participate in cohort analytics.
INSERT INTO project_cohorts (project_id, name, description, color, sort_order, is_active)
SELECT DISTINCT
  pt.project_id,
  'custom' AS name,
  'Default cohort for uncategorized terms' AS description,
  '#6b7280' AS color,
  9999 AS sort_order,
  1 AS is_active
FROM project_terms pt
WHERE pt.project_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  description = IFNULL(description, VALUES(description)),
  color = IFNULL(color, VALUES(color));

-- Backfill cohort definitions from legacy project_terms.category.
INSERT INTO project_cohorts (project_id, name, description, color, sort_order, is_active)
SELECT
  src.project_id,
  src.normalized_category AS name,
  CONCAT('Backfilled from project_terms category: ', src.normalized_category) AS description,
  CASE
    WHEN src.normalized_category IN ('technology', 'tech', 'science') THEN '#2f7cf6'
    WHEN src.normalized_category IN ('brand') THEN '#9c4eff'
    WHEN src.normalized_category IN ('common') THEN '#30a46c'
    WHEN src.normalized_category IN ('noun') THEN '#d89614'
    ELSE '#4f7cff'
  END AS color,
  50 AS sort_order,
  1 AS is_active
FROM (
  SELECT DISTINCT
    pt.project_id,
    LOWER(TRIM(pt.category)) AS normalized_category
  FROM project_terms pt
  WHERE pt.category IS NOT NULL
    AND TRIM(pt.category) <> ''
) src
ON DUPLICATE KEY UPDATE
  description = IFNULL(description, VALUES(description)),
  color = IFNULL(color, VALUES(color));

-- Backfill term memberships from project_terms.(category, weight).
INSERT INTO project_term_memberships
  (project_id, term_id, cohort_id, membership_weight, source, confidence, note)
SELECT
  pt.project_id,
  pt.term_id,
  pc.id AS cohort_id,
  COALESCE(NULLIF(pt.weight, 0), 1.0) AS membership_weight,
  'legacy-sync' AS source,
  CASE
    WHEN pt.category IS NULL OR TRIM(pt.category) = '' THEN 0.80
    ELSE 0.92
  END AS confidence,
  'Backfilled from project_terms category/weight' AS note
FROM project_terms pt
JOIN project_cohorts pc
  ON pc.project_id = pt.project_id
 AND pc.name = COALESCE(NULLIF(LOWER(TRIM(pt.category)), ''), 'custom')
ON DUPLICATE KEY UPDATE
  membership_weight = VALUES(membership_weight),
  source = VALUES(source),
  confidence = GREATEST(confidence, VALUES(confidence)),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
