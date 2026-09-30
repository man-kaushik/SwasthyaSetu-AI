-- Deterministic ORS redistribution demo using PHCs and medicines already seeded.
-- Run after 03_seed_current_inventory.sql and before 05_seed_forecast_results.sql.
-- This CTAS replacement avoids row-level DML and preserves every other inventory row.
-- MH-PUNE-PHC-003 is the deficit; PHC-011 is the nearest eligible donor;
-- PHC-002 is a farther eligible alternative; PHC-001 is deliberately insufficient.
CREATE OR REPLACE TABLE `swasthyasetu-ai-7b4e6.swasthya_ai.current_inventory`
CLUSTER BY phc_id, medicine_id
AS
SELECT * REPLACE (
  CASE
    WHEN phc_id = 'MH-PUNE-PHC-002' AND medicine_id = 'ORS' THEN 500
    WHEN phc_id = 'MH-PUNE-PHC-001' AND medicine_id = 'ORS' THEN 150
    ELSE current_stock
  END AS current_stock,
  CASE
    WHEN phc_id = 'MH-PUNE-PHC-002' AND medicine_id = 'ORS' THEN 12
    WHEN phc_id = 'MH-PUNE-PHC-001' AND medicine_id = 'ORS' THEN 20
    ELSE daily_consumption
  END AS daily_consumption
)
FROM `swasthyasetu-ai-7b4e6.swasthya_ai.current_inventory`;

-- Expected transfer decision after 05_seed_forecast_results.sql:
-- destination MH-PUNE-PHC-003 / ORS needs about 157 units for 10-day coverage;
-- MH-PUNE-PHC-011 qualifies and is nearer than the farther MH-PUNE-PHC-002;
-- MH-PUNE-PHC-001 must be excluded because its 10-day surplus is insufficient.
SELECT
  phc_id,
  medicine_id,
  current_stock,
  daily_consumption
FROM `swasthyasetu-ai-7b4e6.swasthya_ai.current_inventory`
WHERE medicine_id = 'ORS'
  AND phc_id IN ('MH-PUNE-PHC-001', 'MH-PUNE-PHC-002', 'MH-PUNE-PHC-003', 'MH-PUNE-PHC-011')
ORDER BY phc_id;
