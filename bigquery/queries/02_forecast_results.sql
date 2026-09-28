-- ============================================================================
-- SwasthyaSetu AI: Step 2 - Generate 14-Day Demand Forecast via ML.FORECAST
-- Stores confidence intervals (lower/upper bound) & splits ID into phc_id, medicine_id
-- ============================================================================

CREATE OR REPLACE TABLE `swasthya_ai.forecast_results` AS
SELECT
  SPLIT(phc_medicine_id, '_')[OFFSET(0)] AS phc_id,
  SPLIT(phc_medicine_id, '_')[OFFSET(1)] AS medicine_id,
  phc_medicine_id,
  CAST(forecast_timestamp AS DATE) AS forecast_date,
  ROUND(forecast_value, 2) AS forecast_value,
  ROUND(prediction_interval_lower_bound, 2) AS prediction_interval_lower_bound,
  ROUND(prediction_interval_upper_bound, 2) AS prediction_interval_upper_bound,
  CURRENT_TIMESTAMP() AS created_at
FROM ML.FORECAST(
  MODEL `swasthya_ai.medicine_demand_forecast`,
  STRUCT(
    14 AS horizon,
    0.95 AS confidence_level
  )
);
