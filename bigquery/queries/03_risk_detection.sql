-- ============================================================================
-- SwasthyaSetu AI: Step 3 - Imminent Stock-Out Risk Detection
-- Cross-joins forecast_results with current_inventory to identify facilities
-- that will deplete essential supplies within 7 days.
-- ============================================================================

SELECT
  f.phc_id,
  p.name AS phc_name,
  p.district,
  p.state,
  f.medicine_id,
  c.current_stock,
  ROUND(SUM(f.forecast_value), 1) AS expected_demand_14d,
  ROUND(c.current_stock / NULLIF(AVG(f.forecast_value), 0), 1) AS estimated_days_to_stockout,
  CASE
    WHEN (c.current_stock / NULLIF(AVG(f.forecast_value), 0)) <= 2 THEN 'CRITICAL (Immediate Stockout < 2 Days)'
    WHEN (c.current_stock / NULLIF(AVG(f.forecast_value), 0)) <= 7 THEN 'HIGH RISK (Stockout < 7 Days)'
    ELSE 'SUFFICIENT BUFFER'
  END AS risk_tier
FROM `swasthya_ai.forecast_results` f
JOIN `swasthya_ai.current_inventory` c
  ON f.phc_id = c.phc_id AND f.medicine_id = c.medicine_id
JOIN `swasthya_ai.phcs` p
  ON f.phc_id = p.phc_id
GROUP BY f.phc_id, p.name, p.district, p.state, f.medicine_id, c.current_stock
HAVING estimated_days_to_stockout <= 7
ORDER BY estimated_days_to_stockout ASC;
