-- ============================================================================
-- SwasthyaSetu AI | STEP 4 - TURN FORECASTS INTO ACTIONABLE STOCK-OUT RISK
-- ----------------------------------------------------------------------------
-- Joins the 14-day predicted demand with live inventory to rank every
-- (PHC x medicine) pair by days-of-stock-remaining.
--
-- Hardening: `current_inventory` is de-duplicated with GROUP BY first, so a
-- CSV that was uploaded/appended twice cannot multiply the risk rows.
--
-- Verified demo scenario (see bigquery/validate_pipeline.js):
--   MH-PUNE-PHC-003 / ORS -> current_stock 40
--       reported 22/day  => 1.8 days  (days_remaining_reported)
--       forecast 37/day  => 1.1 days  (days_remaining) -> risk_tier CRITICAL
--   MH-PUNE-PHC-011 / ORS -> current_stock 620 -> SAFE = surplus donor for
--       the redistribution engine in functions/index.js (POST /recommendation).
-- ============================================================================

CREATE OR REPLACE TABLE `swasthya_ai.stockout_risk` AS
WITH fc AS (
  SELECT
    phc_id,
    medicine_id,
    AVG(forecast_value)                       AS avg_daily_demand,
    SUM(forecast_value)                       AS demand_next_14d,
    MAX(prediction_interval_upper_bound)      AS worst_case_daily_demand
  FROM `swasthya_ai.forecast_results`
  GROUP BY phc_id, medicine_id
),
inv AS (
  SELECT
    phc_id,
    medicine_id,
    ANY_VALUE(medicine_name)  AS medicine_name,
    MAX(current_stock)        AS current_stock,
    MAX(daily_consumption)    AS reported_daily_consumption,
    MAX(beds_available)       AS beds_available,
    MAX(doctors_present)      AS doctors_present,
    MAX(nurses_present)       AS nurses_present,
    MAX(patient_footfall)     AS patient_footfall
  FROM `swasthya_ai.current_inventory`
  GROUP BY phc_id, medicine_id
)
SELECT
  i.phc_id,
  IFNULL(p.name, i.phc_id)                          AS phc_name,
  p.district,
  p.state,
  i.medicine_id,
  i.medicine_name,
  i.current_stock,
  i.reported_daily_consumption,
  ROUND(f.avg_daily_demand, 2)                      AS forecast_daily_demand,
  ROUND(f.demand_next_14d, 1)                       AS forecast_demand_14d,
  ROUND(i.current_stock / NULLIF(i.reported_daily_consumption, 0), 1) AS days_remaining_reported,
  ROUND(i.current_stock / NULLIF(f.avg_daily_demand, 0), 1) AS days_remaining,
  CASE
    WHEN i.current_stock <= 0 THEN 'STOCKED_OUT'
    WHEN i.current_stock / NULLIF(f.avg_daily_demand, 0) <= 2  THEN 'CRITICAL'
    WHEN i.current_stock / NULLIF(f.avg_daily_demand, 0) <= 7  THEN 'HIGH'
    WHEN i.current_stock / NULLIF(f.avg_daily_demand, 0) <= 14 THEN 'MEDIUM'
    ELSE 'SAFE'
  END                                               AS risk_tier,
  CURRENT_TIMESTAMP()                               AS scored_at
FROM inv i
JOIN fc f
  ON i.phc_id = f.phc_id AND i.medicine_id = f.medicine_id
LEFT JOIN `swasthya_ai.phcs` p
  ON i.phc_id = p.phc_id;


-- 4.1  Everything that needs action in the next 7 days (the alert feed).
--      `days_remaining`         = live stock / MODEL-predicted daily demand
--      `days_remaining_reported`= live stock / PHC-reported daily consumption
--      (For the demo case MH-PUNE-PHC-003 / ORS: 40 / 37 = 1.1 days,
--       while the reported number gives 40 / 22 = 1.8 days - the model is
--       more pessimistic because it has learned the ORS outbreak surge.)
SELECT
  phc_id, phc_name, district, state, medicine_id, medicine_name,
  current_stock, reported_daily_consumption, forecast_daily_demand,
  days_remaining_reported, days_remaining, risk_tier
FROM `swasthya_ai.stockout_risk`
WHERE risk_tier IN ('STOCKED_OUT', 'CRITICAL', 'HIGH')
ORDER BY days_remaining ASC;

-- 4.2  State/district rollup for the officer dashboard.
SELECT
  state,
  district,
  COUNTIF(risk_tier = 'CRITICAL')     AS critical_alerts,
  COUNTIF(risk_tier = 'HIGH')         AS high_alerts,
  COUNTIF(risk_tier = 'STOCKED_OUT')  AS stockout_alerts,
  COUNT(*)                            AS monitored_phc_medicine_pairs
FROM `swasthya_ai.stockout_risk`
GROUP BY state, district
ORDER BY critical_alerts DESC, high_alerts DESC;
