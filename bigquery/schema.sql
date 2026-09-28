-- ============================================================================
-- SwasthyaSetu AI: BigQuery Setup Script (Clean Recreate & Table Definitions)
-- Dataset: swasthya_ai
--
-- Why DROP TABLE?
-- Tables previously created with `NOT NULL` (REQUIRED mode) will reject CSV data
-- because CSV imports default all columns to NULLABLE.
-- Running this script drops the old tables with REQUIRED columns and recreates
-- them with NULLABLE columns so CSV loads work immediately without error.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS `swasthya_ai`
OPTIONS (
  location = 'US',
  description = 'SwasthyaSetu AI healthcare resource allocation, demand forecasting and redistribution dataset'
);

DROP TABLE IF EXISTS `swasthya_ai.phcs`;
DROP TABLE IF EXISTS `swasthya_ai.medicines`;
DROP TABLE IF EXISTS `swasthya_ai.inventory_history`;
DROP TABLE IF EXISTS `swasthya_ai.current_inventory`;
DROP TABLE IF EXISTS `swasthya_ai.forecast_results`;
DROP TABLE IF EXISTS `swasthya_ai.alerts`;
DROP TABLE IF EXISTS `swasthya_ai.recommendations`;

-- 2. Table: phcs (Primary Health Centres directory)
CREATE TABLE IF NOT EXISTS `swasthya_ai.phcs` (
  phc_id STRING OPTIONS(description="Unique PHC facility code"),
  name STRING OPTIONS(description="Primary Health Centre Name"),
  state STRING OPTIONS(description="State Name"),
  district STRING OPTIONS(description="District Name"),
  lat FLOAT64 OPTIONS(description="Geographic latitude"),
  lng FLOAT64 OPTIONS(description="Geographic longitude"),
  population_served INT64 OPTIONS(description="Catchment population size")
);

-- 3. Table: medicines (Essential Medicines Formulary)
CREATE TABLE IF NOT EXISTS `swasthya_ai.medicines` (
  medicine_id STRING OPTIONS(description="Standard medicine ID"),
  medicine_name STRING OPTIONS(description="Medicine brand/generic name"),
  category STRING OPTIONS(description="Pharmacological / supply chain category"),
  unit STRING OPTIONS(description="Packaging unit (e.g. Strips, Packets, Vials)"),
  safety_stock INT64 OPTIONS(description="Minimum safety buffer quantity"),
  standard_daily_consumption INT64 OPTIONS(description="Baseline average daily consumption rate")
);

-- 4. Table: inventory_history (Telemetry Time-Series)
CREATE TABLE IF NOT EXISTS `swasthya_ai.inventory_history` (
  date DATE OPTIONS(description="Telemetry recording date"),
  phc_id STRING OPTIONS(description="Facility ID"),
  medicine_id STRING OPTIONS(description="Medicine ID"),
  medicine_name STRING OPTIONS(description="Medicine name"),
  daily_consumption INT64 OPTIONS(description="Units consumed on this date"),
  current_stock INT64 OPTIONS(description="Closing stock on this date"),
  patient_footfall INT64 OPTIONS(description="OPD / in-patient footfall count")
)
PARTITION BY date
CLUSTER BY phc_id, medicine_id;

-- 5. Table: current_inventory (Live snapshot)
CREATE TABLE IF NOT EXISTS `swasthya_ai.current_inventory` (
  updated_at TIMESTAMP OPTIONS(description="Timestamp of telemetry sync"),
  phc_id STRING OPTIONS(description="Facility ID"),
  medicine_id STRING OPTIONS(description="Medicine ID"),
  medicine_name STRING OPTIONS(description="Medicine Name"),
  current_stock INT64 OPTIONS(description="Current real-time stock units"),
  daily_consumption INT64 OPTIONS(description="Reported daily consumption rate"),
  beds_available INT64 OPTIONS(description="Vacant beds currently available"),
  doctors_present INT64 OPTIONS(description="Doctors on duty"),
  nurses_present INT64 OPTIONS(description="Nurses and ANM staff on duty"),
  patient_footfall INT64 OPTIONS(description="Current daily patient visit count")
)
CLUSTER BY phc_id, medicine_id;

-- 6. Table: forecast_results (14-day demand forecasts)
-- IMPORTANT: this is the EXACT spec produced by
--   bigquery/queries/03_build_forecast_results.sql  (BigQuery ML ARIMA_PLUS path)
--   bigquery/queries/03b_forecast_fallback.sql      (moving-average fallback)
-- NOTE: If a table with a different partitioning spec already exists, BigQuery
-- refuses CREATE OR REPLACE with "Cannot replace a table with a different
-- partitioning spec". The pipeline queries therefore DROP this table first, so
-- it is also safe to skip this DDL and let STEP 3 create the table.
CREATE TABLE IF NOT EXISTS `swasthya_ai.forecast_results` (
  phc_medicine_id STRING OPTIONS(description="Composite key: PHC_ID + '_' + MEDICINE_ID"),
  phc_id STRING OPTIONS(description="Facility ID parsed out of phc_medicine_id"),
  medicine_id STRING OPTIONS(description="Medicine ID parsed out of phc_medicine_id"),
  forecast_date DATE OPTIONS(description="Forecast day"),
  forecast_value FLOAT64 OPTIONS(description="Predicted daily consumption"),
  prediction_interval_lower_bound FLOAT64 OPTIONS(description="95% interval lower bound"),
  prediction_interval_upper_bound FLOAT64 OPTIONS(description="95% interval upper bound"),
  created_at TIMESTAMP OPTIONS(description="Model inference timestamp")
)
PARTITION BY forecast_date
CLUSTER BY phc_id, medicine_id;

-- 7. Table: alerts (Automated operational stockout and surge notifications)
CREATE TABLE IF NOT EXISTS `swasthya_ai.alerts` (
  alert_id STRING,
  phc_id STRING,
  phc_name STRING,
  district STRING,
  state STRING,
  alert_type STRING OPTIONS(description="CRITICAL_STOCKOUT, IMMINENT_DEPLETION, BED_SHORTAGE, STAFF_SURGE"),
  severity STRING OPTIONS(description="CRITICAL, HIGH, MEDIUM, LOW"),
  medicine_id STRING,
  current_stock INT64,
  daily_consumption INT64,
  days_remaining FLOAT64,
  message STRING,
  status STRING OPTIONS(description="ACTIVE, ACKNOWLEDGED, RESOLVED"),
  created_at TIMESTAMP
)
CLUSTER BY severity, district;

-- 8. Table: recommendations (AI redistribution and transfer proposals)
CREATE TABLE IF NOT EXISTS `swasthya_ai.recommendations` (
  recommendation_id STRING,
  alert_id STRING,
  target_phc_id STRING OPTIONS(description="Deficit facility"),
  donor_phc_id STRING OPTIONS(description="Surplus donor facility"),
  medicine_id STRING,
  medicine_name STRING,
  recommended_quantity INT64,
  distance_km FLOAT64,
  estimated_transit_hours FLOAT64,
  donor_remaining_stock INT64,
  target_extended_days FLOAT64,
  status STRING OPTIONS(description="PROPOSED, APPROVED, IN_TRANSIT, DELIVERED, REJECTED"),
  created_at TIMESTAMP
)
CLUSTER BY status, target_phc_id;

