-- ============================================================================
-- SwasthyaSetu AI | STEP 3 - BUILD THE FINAL `forecast_results` TABLE
-- ----------------------------------------------------------------------------
-- This is a BigQuery SCRIPT (multiple statements). Run it as-is: do NOT run
-- only the last statement.
--
-- WHAT IT SOLVES:
--   A) The pre-created `forecast_results` table had a DIFFERENT partitioning /
--      column spec, which is what produced:
--      "Cannot replace a table with a different partitioning spec".
--      -> We DROP it first, then recreate it with the exact right spec.
--   B) `SPLIT(phc_medicine_id, '_')[OFFSET(1)]` is WRONG for medicine IDs that
--      contain underscores (PARACETAMOL_500, AMOXICILLIN_500, METFORMIN_500,
--      AZITHROMYCIN_500, INSULIN_REGULAR, RABIES_VACCINE, OXYGEN_CYLINDER).
--      -> We use anchored regex on the `XX-YYY-PHC-NNN` prefix instead.
--   C) The ML.FORECAST time-series id column is named either `time_series_id`
--      or `phc_medicine_id` depending on the model. Referencing the wrong name
--      is a hard "Unrecognized name" error -> we auto-detect it and build the
--      statement dynamically, so this step cannot break on naming.
--
-- Output: swasthya_ai.forecast_results
--   phc_medicine_id STRING, phc_id STRING, medicine_id STRING,
--   forecast_date DATE, forecast_value FLOAT64,
--   prediction_interval_lower_bound FLOAT64, prediction_interval_upper_bound FLOAT64,
--   created_at TIMESTAMP
-- ============================================================================

DECLARE series_id_col STRING;

SET series_id_col = (
  SELECT column_name
  FROM `swasthya_ai`.INFORMATION_SCHEMA.COLUMNS
  WHERE table_name = 'forecast_results_raw'
    AND column_name IN ('time_series_id', 'phc_medicine_id')
  ORDER BY IF(column_name = 'time_series_id', 1, 2)
  LIMIT 1
);

ASSERT series_id_col IS NOT NULL
  AS 'forecast_results_raw has no time-series id column. Re-run STEP 1 (01_train_model.sql) then STEP 2.';

DROP TABLE IF EXISTS `swasthya_ai.forecast_results`;

EXECUTE IMMEDIATE FORMAT("""
CREATE TABLE `swasthya_ai.forecast_results`
PARTITION BY forecast_date
CLUSTER BY phc_id, medicine_id
AS
SELECT
  %s AS phc_medicine_id,
  REGEXP_EXTRACT(%s, r'^[A-Z]{2}-[A-Z]+-PHC-[0-9]+')             AS phc_id,
  REGEXP_REPLACE(%s, r'^[A-Z]{2}-[A-Z]+-PHC-[0-9]+_', '')       AS medicine_id,
  DATE(forecast_timestamp)                                      AS forecast_date,
  ROUND(CAST(forecast_value AS FLOAT64), 2)                     AS forecast_value,
  ROUND(CAST(prediction_interval_lower_bound AS FLOAT64), 2)    AS prediction_interval_lower_bound,
  ROUND(CAST(prediction_interval_upper_bound AS FLOAT64), 2)    AS prediction_interval_upper_bound,
  CURRENT_TIMESTAMP()                                           AS created_at
FROM `swasthya_ai.forecast_results_raw`
""", series_id_col, series_id_col, series_id_col);


-- VERIFY 1: expected 1,680 rows over 120 series, dates = the next 14 days.
SELECT
  COUNT(*)                    AS forecast_rows,
  COUNT(DISTINCT phc_id)      AS phcs,
  COUNT(DISTINCT medicine_id) AS medicines,
  COUNT(DISTINCT phc_medicine_id) AS series,
  MIN(forecast_date)          AS first_forecast_day,
  MAX(forecast_date)          AS last_forecast_day,
  COUNTIF(phc_id IS NULL OR medicine_id IS NULL) AS rows_failed_to_parse_id
FROM `swasthya_ai.forecast_results`;

-- VERIFY 2: predicted demand for the critical demo scenario (Baramati ORS).
SELECT phc_id, medicine_id, forecast_date, forecast_value,
       prediction_interval_lower_bound AS lower_bound,
       prediction_interval_upper_bound AS upper_bound
FROM `swasthya_ai.forecast_results`
WHERE phc_id = 'MH-PUNE-PHC-003' AND medicine_id = 'ORS'
ORDER BY forecast_date;
