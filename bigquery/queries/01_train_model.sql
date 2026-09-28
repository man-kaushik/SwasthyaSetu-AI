-- ============================================================================
-- SwasthyaSetu AI | STEP 1 - TRAIN BigQuery ML ARIMA_PLUS FORECASTING MODEL
-- ----------------------------------------------------------------------------
-- Produces ONE model covering ALL (PHC x medicine) time series at once by using
-- TIME_SERIES_ID_COL = 'phc_medicine_id' (120 series: 15 PHCs x 8 medicines).
--
-- Hardening applied (each item removes a specific BigQuery ML failure mode):
--   1. Date coercion : SAFE.PARSE_DATE(SUBSTR(CAST(date AS STRING),1,10))
--      -> works whether the loaded column is DATE, DATETIME, TIMESTAMP or STRING.
--   2. Duplicate timestamps are de-duplicated with GROUP BY (ARIMA_PLUS rejects
--      duplicate timestamps per series, which happens if a CSV was loaded twice).
--   3. Rows with unparseable dates / NULL consumption are dropped, not fatal.
--   4. Series with fewer than 3 points are excluded (ARIMA_PLUS minimum).
--   5. Dates are shifted forward so the series ends TODAY. The synthetic history
--      ends 2025-02-15, so without this the 14-day forecast would be dated in the
--      past. After the shift the forecast covers the next 14 days from today.
--
-- Runtime: ~1-3 minutes for 120 series with auto_arima. If you need it faster,
-- uncomment AUTO_ARIMA_MAX_ORDER = 2 (lower = faster, slightly less accurate).
-- ============================================================================

-- Fail early with an actionable message if the history table is empty or has
-- no series with at least three parseable dates and non-NULL consumption rows.
ASSERT (
  SELECT COUNT(*) > 0
  FROM (
    SELECT
      CONCAT(CAST(phc_id AS STRING), '_', CAST(medicine_id AS STRING)) AS phc_medicine_id
    FROM `swasthya_ai.inventory_history`
    WHERE date IS NOT NULL
      AND phc_id IS NOT NULL
      AND medicine_id IS NOT NULL
      AND SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(date AS STRING), 1, 10)) IS NOT NULL
      AND SAFE_CAST(daily_consumption AS FLOAT64) IS NOT NULL
    GROUP BY phc_medicine_id
    HAVING COUNT(DISTINCT SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(date AS STRING), 1, 10))) >= 3
  )
) AS 'No usable inventory_history rows for model training. Run bigquery/seed_sql/04_seed_inventory_history.sql in this same BigQuery project first and confirm rows_loaded is 10800. Do not rerun schema.sql after seeding, because it drops this table.';

CREATE OR REPLACE MODEL `swasthya_ai.medicine_demand_forecast`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'date',
  time_series_data_col = 'daily_consumption',
  time_series_id_col = 'phc_medicine_id',
  horizon = 14,
  auto_arima = TRUE
  -- , auto_arima_max_order = 2   -- optional speed-up for demos
  -- , holiday_region = 'IN'      -- optional: Indian public-holiday effects
) AS
WITH src AS (
  SELECT
    SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(date AS STRING), 1, 10)) AS series_date,
    CONCAT(CAST(phc_id AS STRING), '_', CAST(medicine_id AS STRING)) AS phc_medicine_id,
    SAFE_CAST(daily_consumption AS FLOAT64)                          AS daily_consumption
  FROM `swasthya_ai.inventory_history`
  WHERE date IS NOT NULL
    AND phc_id IS NOT NULL
    AND medicine_id IS NOT NULL
),
clean AS (
  SELECT series_date, phc_medicine_id, daily_consumption
  FROM src
  WHERE series_date IS NOT NULL
    AND daily_consumption IS NOT NULL
),
deduped AS (
  SELECT
    series_date,
    phc_medicine_id,
    AVG(daily_consumption)                       AS daily_consumption,
    COUNT(*) OVER (PARTITION BY phc_medicine_id) AS points_per_series
  FROM clean
  GROUP BY series_date, phc_medicine_id
),
shift AS (
  -- Single row: how many days to add so the series ends today.
  SELECT IFNULL(DATE_DIFF(CURRENT_DATE(), MAX(series_date), DAY), 0) AS shift_days
  FROM clean
),
aligned AS (
  SELECT
    DATE_ADD(series_date, INTERVAL shift_days DAY) AS series_date,
    phc_medicine_id,
    daily_consumption,
    points_per_series
  FROM deduped
  CROSS JOIN shift
)
SELECT
  series_date AS date,
  daily_consumption,
  phc_medicine_id
FROM aligned
WHERE points_per_series >= 3;


-- Verify the model was created (name, type, training metrics):
SELECT
  model_name,
  model_type,
  creation_time,
  last_modified_time
FROM `swasthya_ai`.INFORMATION_SCHEMA.MODELS
WHERE model_name = 'medicine_demand_forecast';
