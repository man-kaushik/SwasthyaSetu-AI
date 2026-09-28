-- ============================================================================
-- SwasthyaSetu AI: Step 1 - Train BigQuery ML Multi-Time-Series Model
-- Model Type: ARIMA_PLUS (Google-native automated forecasting)
-- Trains multiple time series simultaneously partitioned by `phc_medicine_id`
-- ============================================================================

CREATE OR REPLACE MODEL `swasthya_ai.medicine_demand_forecast`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'date',
  time_series_data_col = 'daily_consumption',
  time_series_id_col = 'phc_medicine_id',
  horizon = 14,
  auto_arima = TRUE,
  data_frequency = 'AUTO_FREQUENCY',
  clean_spikes_and_dips = TRUE
) AS
SELECT
  PARSE_DATE('%Y-%m-%d', CAST(date AS STRING)) AS date,
  CAST(daily_consumption AS FLOAT64) AS daily_consumption,
  CONCAT(phc_id, '_', medicine_id) AS phc_medicine_id
FROM `swasthya_ai.inventory_history`
WHERE date IS NOT NULL AND daily_consumption IS NOT NULL;
