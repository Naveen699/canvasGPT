-- Run from the canvasGPT repo root:
-- sqlite3 -header -column backend/.data/canvasgpt.sqlite3 < backend/tests/sql/course_index_storage_checks.sql
--
-- These checks inspect the most recently updated local course index.

.headers on
.mode column

DROP VIEW IF EXISTS temp.latest_course;

CREATE TEMP VIEW latest_course AS
  SELECT id
  FROM courses
  ORDER BY updated_at DESC
  LIMIT 1;

WITH checks AS (
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
        FROM material_placements placement
        LEFT JOIN materials material
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
SELECT *
FROM checks
ORDER BY
  CASE status WHEN 'FAIL' THEN 0 ELSE 1 END,
  test_name;

SELECT
  'latest_course' AS section,
  id,
  canvas_origin,
  course_id,
  course_name,
  canvas_user_id,
  local_profile_id,
  consent_granted,
  vector_store_id,
  sync_status,
  updated_at
FROM courses
WHERE id = (SELECT id FROM latest_course);

SELECT
  'materials_by_status' AS section,
  status,
  COUNT(*) AS count
FROM materials
WHERE course_id = (SELECT id FROM latest_course)
GROUP BY status
ORDER BY status;

SELECT
  'sample_materials' AS section,
  material_key,
  kind,
  title,
  status,
  error_type,
  content_hash,
  canvas_updated_at,
  size,
  content_type,
  file_name
FROM materials
WHERE course_id = (SELECT id FROM latest_course)
ORDER BY kind, title, material_key
LIMIT 25;

SELECT
  'sample_placements' AS section,
  material_key,
  source_kind,
  module_id,
  module_name,
  module_item_id,
  position,
  label
FROM material_placements
WHERE course_id = (SELECT id FROM latest_course)
ORDER BY material_key, position
LIMIT 25;
