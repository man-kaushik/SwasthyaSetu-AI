-- Create a small deterministic 14-day forecast set from the live inventory
-- snapshot. This is demo data, not a trained model prediction. Re-run whenever
-- current_inventory changes to refresh the forecast baseline.
CREATE OR REPLACE TABLE `swasthyasetu-ai-7b4e6.swasthya_ai.forecast_results`
PARTITION BY forecast_date
CLUSTER BY phc_id, medicine_id
AS
WITH inventory AS (
  SELECT
    CAST(phc_id AS STRING) AS phc_id,
    CAST(medicine_id AS STRING) AS medicine_id,
    GREATEST(0, COALESCE(SAFE_CAST(daily_consumption AS FLOAT64), 0)) AS daily_demand
  FROM `swasthyasetu-ai-7b4e6.swasthya_ai.current_inventory`
  WHERE phc_id IS NOT NULL AND medicine_id IS NOT NULL
),
forecast_days AS (
  SELECT day_offset
  FROM UNNEST(GENERATE_ARRAY(0, 13)) AS day_offset
),
forecast AS (
  SELECT
    i.phc_id,
    i.medicine_id,
    i.daily_demand,
    d.day_offset,
    ROUND(i.daily_demand * (0.86 + MOD(d.day_offset, 5) * 0.02), 2) AS forecast_value
  FROM inventory AS i
  CROSS JOIN forecast_days AS d
)
SELECT
  CONCAT(phc_id, '_', medicine_id) AS phc_medicine_id,
  phc_id,
  medicine_id,
  DATE_ADD(CURRENT_DATE(), INTERVAL day_offset DAY) AS forecast_date,
  forecast_value,
  GREATEST(0, ROUND(forecast_value * 0.8, 2)) AS prediction_interval_lower_bound,
  ROUND(forecast_value * 1.2, 2) AS prediction_interval_upper_bound,
  CURRENT_TIMESTAMP() AS created_at
FROM forecast;

SELECT
  COUNT(*) AS forecast_rows,
  COUNT(DISTINCT phc_medicine_id) AS facility_medicine_pairs,
  MIN(forecast_date) AS first_forecast_day,
  MAX(forecast_date) AS last_forecast_day
FROM `swasthyasetu-ai-7b4e6.swasthya_ai.forecast_results`;
