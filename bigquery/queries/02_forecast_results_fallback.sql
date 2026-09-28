-- ============================================================================
-- SwasthyaSetu AI: Step 2 (Fallback) - Fast Rolling Moving Average Projections
-- Use this query if BigQuery ML training is unavailable or takes too long.
-- Projects average daily consumption for the upcoming 14 days per PHC + Medicine.
-- ============================================================================

DROP TABLE IF EXISTS `swasthya_ai.forecast_results`;

CREATE TABLE `swasthya_ai.forecast_results`
PARTITION BY forecast_date
CLUSTER BY phc_id, medicine_id
AS
WITH recent_moving_avg AS (
  SELECT
    phc_id,
    medicine_id,
    CONCAT(phc_id, '_', medicine_id) AS phc_medicine_id,
    ROUND(AVG(daily_consumption), 2) AS avg_daily,
    ROUND(STDDEV(daily_consumption), 2) AS std_daily
  FROM `swasthya_ai.inventory_history`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
  GROUP BY phc_id, medicine_id
)
SELECT
  r.phc_id,
  r.medicine_id,
  r.phc_medicine_id,
  DATE_ADD(CURRENT_DATE(), INTERVAL day_offset DAY) AS forecast_date,
  r.avg_daily AS forecast_value,
  GREATEST(0.0, ROUND(r.avg_daily - COALESCE(r.std_daily, 0) * 1.96, 2)) AS prediction_interval_lower_bound,
  ROUND(r.avg_daily + COALESCE(r.std_daily, 0) * 1.96, 2) AS prediction_interval_upper_bound,
  CURRENT_TIMESTAMP() AS created_at
FROM recent_moving_avg r
CROSS JOIN UNNEST(GENERATE_ARRAY(1, 14)) AS day_offset;

