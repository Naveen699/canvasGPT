-- Read-only report for inspecting the latest stored CanvasGPT course index.
-- Run from the repo root through:
--   scripts/print-course-index
-- or:
--   sqlite3 -readonly backend/.data/canvasgpt.sqlite3 < backend/tests/sql/course_index_report.sql

.headers on
.mode column
.nullvalue NULL
.width 39 23 9 40 14 16 15 13 29 12 32 32

.print '== Latest Course Summary =='
WITH latest_course AS (
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT
  id AS course_index_id,
  canvas_origin,
  course_id,
  course_name,
  canvas_user_id,
  local_profile_id,
  consent_granted,
  CASE
    WHEN consent_granted = 1 THEN 'granted'
    ELSE 'not_granted'
  END AS consent_state,
  CASE
    WHEN consent_granted = 1 AND vector_store_id IS NOT NULL THEN 'ready'
    ELSE 'not_created'
  END AS effective_vector_store_status,
  sync_status,
  created_at,
  updated_at
FROM courses
WHERE id = (SELECT id FROM latest_course);

.print ''
.print '== Material Counts By Kind And Status =='
.width 18 12 8
WITH latest_course AS (
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT
  kind,
  status,
  COUNT(*) AS count
FROM materials
WHERE course_id = (SELECT id FROM latest_course)
GROUP BY kind, status
ORDER BY kind, status;

.print ''
.print '== Material Counts By Status =='
.width 12 8
WITH latest_course AS (
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT
  status,
  COUNT(*) AS count
FROM materials
WHERE course_id = (SELECT id FROM latest_course)
GROUP BY status
ORDER BY status;

.print ''
.print '== Skipped Policy Summary =='
.width 24 8 72
WITH latest_course AS (
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT
  COALESCE(error_type, 'missing_reason') AS reason,
  COUNT(*) AS count,
  substr(group_concat(material_key, ', '), 1, 72) AS sample_material_keys
FROM materials
WHERE course_id = (SELECT id FROM latest_course)
  AND status = 'skipped'
GROUP BY COALESCE(error_type, 'missing_reason')
ORDER BY count DESC, reason;

.print ''
.print '== Sample Materials =='
.width 42 14 42 10 23 24 22 10 24 28
WITH latest_course AS (
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT
  substr(material_key, 1, 42) AS material_key,
  kind,
  substr(COALESCE(title, ''), 1, 48) AS title,
  status,
  error_type,
  substr(COALESCE(content_hash, ''), 1, 24) AS content_hash,
  canvas_updated_at,
  size,
  content_type,
  substr(COALESCE(file_name, ''), 1, 28) AS file_name
FROM materials
WHERE course_id = (SELECT id FROM latest_course)
ORDER BY
  CASE status WHEN 'skipped' THEN 0 ELSE 1 END,
  kind,
  title,
  material_key
LIMIT 40;

.print ''
.print '== Sample Placements =='
.width 42 14 38 14 12 32 22 9 32
WITH latest_course AS (
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT
  substr(placement.material_key, 1, 42) AS material_key,
  material.kind,
  substr(COALESCE(material.title, ''), 1, 38) AS title,
  placement.source_kind,
  placement.module_id,
  substr(COALESCE(placement.module_name, ''), 1, 32) AS module_name,
  placement.module_item_id,
  placement.position,
  substr(COALESCE(placement.label, ''), 1, 32) AS label
FROM material_placements AS placement
LEFT JOIN materials AS material
  ON material.course_id = placement.course_id
 AND material.material_key = placement.material_key
WHERE placement.course_id = (SELECT id FROM latest_course)
ORDER BY placement.material_key, placement.position
LIMIT 40;

.print ''
.print '== PASS/FAIL Storage Checks =='
.width 8 48 78
WITH latest_course AS (
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1
),
checks AS (
  SELECT
    'latest_course_exists' AS test_name,
    CASE WHEN EXISTS (SELECT 1 FROM latest_course) THEN 'PASS' ELSE 'FAIL' END AS status,
    COALESCE((SELECT id FROM latest_course), 'no course row found') AS details

  UNION ALL

  SELECT
    'latest_course_has_identity',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM courses
        WHERE id = (SELECT id FROM latest_course)
          AND canvas_origin IS NOT NULL
          AND course_id IS NOT NULL
          AND (canvas_user_id IS NOT NULL OR local_profile_id IS NOT NULL)
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    COALESCE(
      (
        SELECT canvas_origin || ' course_id=' || course_id
        FROM courses
        WHERE id = (SELECT id FROM latest_course)
      ),
      'missing course identity'
    )

  UNION ALL

  SELECT
    'materials_stored_for_latest_course',
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM materials
        WHERE course_id = (SELECT id FROM latest_course)
      ) > 0
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    (
      SELECT COUNT(*) || ' material row(s)'
      FROM materials
      WHERE course_id = (SELECT id FROM latest_course)
    )

  UNION ALL

  SELECT
    'material_keys_are_unique_per_course',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM materials
        WHERE course_id = (SELECT id FROM latest_course)
        GROUP BY material_key
        HAVING COUNT(*) > 1
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'no duplicate material_key rows expected'

  UNION ALL

  SELECT
    'placements_reference_stored_materials',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM material_placements AS placement
        LEFT JOIN materials AS material
          ON material.course_id = placement.course_id
         AND material.material_key = placement.material_key
        WHERE placement.course_id = (SELECT id FROM latest_course)
          AND material.id IS NULL
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    (
      SELECT COUNT(*) || ' placement row(s)'
      FROM material_placements
      WHERE course_id = (SELECT id FROM latest_course)
    )

  UNION ALL

  SELECT
    'skipped_material_reasons_are_policy_reasons',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM materials
        WHERE course_id = (SELECT id FROM latest_course)
          AND status = 'skipped'
          AND COALESCE(error_type, '') NOT IN ('too_large', 'unsupported_file_type')
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    (
      SELECT COUNT(*) || ' skipped material row(s)'
      FROM materials
      WHERE course_id = (SELECT id FROM latest_course)
        AND status = 'skipped'
    )

  UNION ALL

  SELECT
    'non_file_materials_not_skipped_by_file_policy',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM materials
        WHERE course_id = (SELECT id FROM latest_course)
          AND kind NOT IN ('attachment', 'file', 'slide')
          AND status = 'skipped'
          AND error_type = 'unsupported_file_type'
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    (
      SELECT COUNT(*) || ' non-file skipped row(s) with unsupported_file_type'
      FROM materials
      WHERE course_id = (SELECT id FROM latest_course)
        AND kind NOT IN ('attachment', 'file', 'slide')
        AND status = 'skipped'
        AND error_type = 'unsupported_file_type'
    )

  UNION ALL

  SELECT
    'no_remote_index_created_by_prepare',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM courses
        WHERE id = (SELECT id FROM latest_course)
          AND vector_store_id IS NOT NULL
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'vector_store_id should remain NULL after prepare-only storage'

  UNION ALL

  SELECT
    'materials_do_not_store_sensitive_columns',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM pragma_table_info('materials')
        WHERE lower(name) GLOB '*body*'
           OR lower(name) GLOB '*bytes*'
           OR lower(name) GLOB '*cookie*'
           OR lower(name) GLOB '*token*'
           OR lower(name) GLOB '*prompt*'
           OR lower(name) GLOB '*embedding*'
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'materials table should store metadata only'

  UNION ALL

  SELECT
    'material_urls_do_not_look_signed_or_tokenized',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM materials
        WHERE course_id = (SELECT id FROM latest_course)
          AND (
            lower(COALESCE(canvas_url, '')) LIKE '%token=%'
            OR lower(COALESCE(canvas_url, '')) LIKE '%signature=%'
            OR lower(COALESCE(canvas_url, '')) LIKE '%x-amz-signature=%'
            OR lower(COALESCE(canvas_url, '')) LIKE '%access_token=%'
          )
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'canvas_url should be metadata URL only, not signed download URL'
)
SELECT
  status,
  test_name,
  details
FROM checks
ORDER BY
  CASE status WHEN 'FAIL' THEN 0 ELSE 1 END,
  test_name;
