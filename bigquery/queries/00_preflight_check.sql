-- ============================================================================
-- SwasthyaSetu AI | STEP 0 (READ-ONLY PRE-FLIGHT CHECK)
-- ----------------------------------------------------------------------------
-- Run this BEFORE training the model. Every query below is read-only and is
-- designed to prove the data is in the exact shape BigQuery ML ARIMA_PLUS needs.
-- If all four checks pass, model training cannot fail for data reasons.
-- ============================================================================

-- 0.1  Which tables exist in the dataset?
SELECT
  table_name,
  table_type,
  creation_time
FROM `swasthya_ai`.INFORMATION_SCHEMA.TABLES
ORDER BY table_name;


-- 0.2  Column contract for the four source tables (order + type must look right).
-- Expected: inventory_history.date is DATE (STRING works too, the SQL handles it)
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type
FROM `swasthya_ai`.INFORMATION_SCHEMA.COLUMNS
WHERE table_name IN ('phcs', 'medicines', 'inventory_history', 'current_inventory')
ORDER BY table_name, ordinal_position;


-- 0.3  Row counts + null/typed sanity. Expect: ~10,800 history rows, 15 PHCs,
--      8 medicines, 120 current_inventory rows, 120 distinct time series.
SELECT
  (SELECT COUNT(*) FROM `swasthya_ai.phcs`)              AS phcs_rows,
  (SELECT COUNT(*) FROM `swasthya_ai.medicines`)         AS medicines_rows,
  (SELECT COUNT(*) FROM `swasthya_ai.inventory_history`) AS history_rows,
  (SELECT COUNT(*) FROM `swasthya_ai.current_inventory`) AS current_rows;


-- 0.4  Time-series shape: distinct series, data span, and points per series.
--      ARIMA_PLUS needs >= 3 points per series (we expect 90).
SELECT
  COUNT(*)                              AS total_series,
  MIN(points_per_series)                AS min_points_per_series,
  MAX(points_per_series)                AS max_points_per_series,
  MIN(first_date)                        AS earliest_date,
  MAX(last_date)                         AS latest_date
FROM (
  SELECT
    CONCAT(CAST(phc_id AS STRING), '_', CAST(medicine_id AS STRING)) AS series_id,
    COUNT(DISTINCT date)      AS points_per_series,
    MIN(CAST(date AS STRING)) AS first_date,
    MAX(CAST(date AS STRING)) AS last_date
  FROM `swasthya_ai.inventory_history`
  WHERE date IS NOT NULL AND phc_id IS NOT NULL AND medicine_id IS NOT NULL
  GROUP BY series_id
);


-- 0.5  DUPLICATE TIMESTAMP CHECK.
--      If this returns rows, the CSV was uploaded/appended more than once.
--      The training + forecast SQL in this folder de-duplicates automatically,
--      so duplicates are NOT fatal - but it is good to know they exist.
SELECT
  CONCAT(CAST(phc_id AS STRING), '_', CAST(medicine_id AS STRING)) AS series_id,
  date,
  COUNT(*) AS rows_for_this_date
FROM `swasthya_ai.inventory_history`
GROUP BY series_id, date
HAVING COUNT(*) > 1
ORDER BY rows_for_this_date DESC, series_id
LIMIT 20;


-- 0.6  The critical demo scenario must be present: PHC MH-PUNE-PHC-003 (Baramati)
--      with ORS stock 40 and consumption 22/day  ->  ~1.8 days to stock-out.
SELECT
  phc_id, medicine_id, current_stock, daily_consumption,
  ROUND(current_stock / NULLIF(daily_consumption, 0), 2) AS days_remaining
FROM `swasthya_ai.current_inventory`
WHERE phc_id IN ('MH-PUNE-PHC-003', 'MH-PUNE-PHC-011')
ORDER BY phc_id, medicine_id;
