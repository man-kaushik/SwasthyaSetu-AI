-- ============================================================================
-- SwasthyaSetu AI | STEP 3-ALT (FALLBACK) - MOVING-AVERAGE FORECAST
-- ----------------------------------------------------------------------------
-- Use this INSTEAD of STEP 2 + STEP 3 if BigQuery ML training is unavailable,
-- hits quota, or is too slow during the demo. It produces the SAME table name
-- and EXACTLY the same columns as the BigQuery ML path, so STEP 4 works either
-- way and you can swap between them at any time.
--
-- Two bugs in the original snippet are fixed here:
--   * `WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 21 DAY)` returns ZERO
--     rows for this dataset, because the generated history ends 2025-02-15.
--     -> We instead take the last 21 AVAILABLE days per series (row_number).
--   * `DATE_ADD(CURRENT_DATE(), INTERVAL n DAY)` produced dates anchored to
--     today while the history is from 2025. -> We anchor on
--     GREATEST(last_history_date, CURRENT_DATE()) so the 14 forecast days always
--     land in the future.
--
-- Runtime: ~2 seconds. Output: 120 series x 14 days = 1,680 rows.
-- ============================================================================

DROP TABLE IF EXISTS `swasthya_ai.forecast_results`;

CREATE TABLE `swasthya_ai.forecast_results`
PARTITION BY forecast_date
CLUSTER BY phc_id, medicine_id
AS
WITH src AS (
  SELECT
    SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(date AS STRING), 1, 10)) AS series_date,
    CAST(phc_id AS STRING)                                           AS phc_id,
    CAST(medicine_id AS STRING)                                      AS medicine_id,
    SAFE_CAST(daily_consumption AS FLOAT64)                          AS daily_consumption
  FROM `swasthya_ai.inventory_history`
  WHERE date IS NOT NULL AND phc_id IS NOT NULL AND medicine_id IS NOT NULL
),
clean AS (
  SELECT phc_id, medicine_id, series_date, daily_consumption
  FROM src
  WHERE series_date IS NOT NULL AND daily_consumption IS NOT NULL
),
daily AS (
  SELECT
    phc_id,
    medicine_id,
    series_date,
    AVG(daily_consumption) AS daily_consumption
  FROM clean
  GROUP BY phc_id, medicine_id, series_date
),
windowed AS (
  SELECT
    phc_id,
    medicine_id,
    daily_consumption,
    ROW_NUMBER() OVER (PARTITION BY phc_id, medicine_id ORDER BY series_date DESC) AS days_back
  FROM daily
),
recent AS (
  SELECT
    phc_id,
    medicine_id,
    AVG(daily_consumption)    AS avg_daily_demand,
    STDDEV(daily_consumption) AS std_daily_demand
  FROM windowed
  WHERE days_back <= 21
  GROUP BY phc_id, medicine_id
),
anchor AS (
  SELECT GREATEST(MAX(series_date), CURRENT_DATE()) AS anchor_date FROM daily
)
SELECT
  CONCAT(r.phc_id, '_', r.medicine_id)                                          AS phc_medicine_id,
  r.phc_id                                                                      AS phc_id,
  r.medicine_id                                                                 AS medicine_id,
  DATE_ADD(a.anchor_date, INTERVAL day_offset DAY)                              AS forecast_date,
  ROUND(r.avg_daily_demand, 2)                                                  AS forecast_value,
  GREATEST(0.0, ROUND(r.avg_daily_demand - 1.96 * IFNULL(r.std_daily_demand, 0), 2)) AS prediction_interval_lower_bound,
  ROUND(r.avg_daily_demand + 1.96 * IFNULL(r.std_daily_demand, 0), 2)           AS prediction_interval_upper_bound,
  CURRENT_TIMESTAMP()                                                           AS created_at
FROM recent r
CROSS JOIN anchor a
CROSS JOIN UNNEST(GENERATE_ARRAY(1, 14)) AS day_offset;


-- VERIFY: expected 1,680 rows / 120 series, forecast days in the future.
SELECT
  COUNT(*)                        AS forecast_rows,
  COUNT(DISTINCT phc_medicine_id) AS series,
  MIN(forecast_date)              AS first_forecast_day,
  MAX(forecast_date)              AS last_forecast_day
FROM `swasthya_ai.forecast_results`;
