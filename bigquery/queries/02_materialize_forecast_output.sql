-- ============================================================================
-- SwasthyaSetu AI | STEP 2 - MATERIALISE THE RAW ML.FORECAST OUTPUT
-- ----------------------------------------------------------------------------
-- WHY THIS EXTRA STEP EXISTS:
--   The BigQuery docs warn that "applying any additional computation on top of
--   ML.FORECAST's result columns might lead to an out of memory error".
--   So we first dump the untouched forecast output into its own table, and only
--   then transform / split it in STEP 3.
--
--   Bonus: this statement references NO output column names (SELECT *), so it
--   cannot fail because of column-name differences between model types.
--
-- Output: swasthya_ai.forecast_results_raw  (1 row per series per future day)
--         Expected row count = 120 series x 14 days = 1,680 rows
-- Runtime: a few seconds.
-- ============================================================================

DROP TABLE IF EXISTS `swasthya_ai.forecast_results_raw`;

CREATE TABLE `swasthya_ai.forecast_results_raw` AS
SELECT *
FROM ML.FORECAST(
  MODEL `swasthya_ai.medicine_demand_forecast`,
  STRUCT(14 AS horizon, 0.95 AS confidence_level)
);


-- Inspect the exact schema produced by ML.FORECAST (useful for auditing):
SELECT column_name, data_type, ordinal_position
FROM `swasthya_ai`.INFORMATION_SCHEMA.COLUMNS
WHERE table_name = 'forecast_results_raw'
ORDER BY ordinal_position;


-- Sanity check: row count + preview.
SELECT COUNT(*) AS raw_forecast_rows FROM `swasthya_ai.forecast_results_raw`;

SELECT * FROM `swasthya_ai.forecast_results_raw` LIMIT 10;
