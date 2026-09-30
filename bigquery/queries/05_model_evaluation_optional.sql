-- ============================================================================
-- SwasthyaSetu AI | STEP 5 (OPTIONAL) - MODEL QUALITY EVIDENCE FOR JUDGES
-- ----------------------------------------------------------------------------
-- Every statement here uses `SELECT *` on purpose: it cannot fail because of
-- unexpected output column names, whatever BigQuery ML returns.
-- ============================================================================

-- 5.1  Which ARIMA configuration won per time series, plus AIC / likelihood.
--      Use the AIC column to show the model is not a naive guess.
SELECT *
FROM ML.ARIMA_EVALUATE(MODEL `swasthya_ai.medicine_demand_forecast`)
LIMIT 200;


-- 5.2  Model coefficients / seasonality summary.
SELECT *
FROM ML.ARIMA_COEFFICIENTS(MODEL `swasthya_ai.medicine_demand_forecast`)
LIMIT 200;


-- 5.3  Decomposed explanation (trend / weekly seasonality / holiday effect /
--      spikes) for every series over the forecast horizon. Great for the demo:
--      it visually proves WHY ORS demand spikes (monsoon / outbreak component).
SELECT *
FROM ML.EXPLAIN_FORECAST(
  MODEL `swasthya_ai.medicine_demand_forecast`,
  STRUCT(14 AS horizon)
)
LIMIT 500;


-- 5.4  How many series were trained and what the global metrics look like.
SELECT
  COUNT(*)                     AS evaluated_series,
  ROUND(AVG(aic), 2)           AS avg_aic,
  ROUND(MIN(aic), 2)           AS best_aic,
  ROUND(MAX(aic), 2)           AS worst_aic
FROM ML.ARIMA_EVALUATE(MODEL `swasthya_ai.medicine_demand_forecast`);


-- 5.5  Model metadata (created / last modified / training options).
SELECT
  model_name,
  model_type,
  creation_time,
  last_modified_time,
  labels,
  optimal_trials
FROM `swasthya_ai`.INFORMATION_SCHEMA.MODELS
WHERE model_name = 'medicine_demand_forecast';
