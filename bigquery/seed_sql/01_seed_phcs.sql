-- ==========================================================
-- SwasthyaSetu AI: Direct Seed for PHCs (No CSV Upload Required)
-- Paste and run this directly in BigQuery Query Editor
-- ==========================================================
CREATE OR REPLACE TABLE `swasthya_ai.phcs` AS
SELECT * FROM UNNEST([
  STRUCT<phc_id STRING, name STRING, state STRING, district STRING, lat FLOAT64, lng FLOAT64, population_served INT64>
  ('MH-PUNE-PHC-001', 'Haveli Primary Health Centre', 'Maharashtra', 'Pune', 18.5204, 73.8567, 28500),
  ('MH-PUNE-PHC-002', 'Shirur Community Health Post', 'Maharashtra', 'Pune', 18.8268, 74.3789, 21400),
  ('MH-PUNE-PHC-003', 'Baramati Rural Health Centre', 'Maharashtra', 'Pune', 18.1517, 74.5771, 34200),
  ('MH-PUNE-PHC-004', 'Junnar Valley PHC', 'Maharashtra', 'Pune', 19.2083, 73.8767, 19800),
  ('MH-PUNE-PHC-011', 'Daund Sub-District Health Depot', 'Maharashtra', 'Pune', 18.4636, 74.5804, 45000),
  ('MH-NSK-PHC-001', 'Dindori Primary Health Post', 'Maharashtra', 'Nashik', 20.2012, 73.8344, 23100),
  ('MH-NSK-PHC-002', 'Sinnar Rural Health Centre', 'Maharashtra', 'Nashik', 19.8456, 74.0023, 26800),
  ('BR-PATNA-PHC-001', 'Danapur Primary Health Centre', 'Bihar', 'Patna', 25.6322, 85.0427, 39000),
  ('BR-PATNA-PHC-004', 'Phulwari Sharif Health Post', 'Bihar', 'Patna', 25.5786, 85.0782, 48500),
  ('BR-PATNA-PHC-009', 'Fatuha Rural Health Centre', 'Bihar', 'Patna', 25.5097, 85.3129, 32700),
  ('BR-GAYA-PHC-001', 'Bodh Gaya Primary Health Post', 'Bihar', 'Gaya', 24.6961, 84.9869, 31200),
  ('TN-MDU-PHC-001', 'Vadipatti Primary Health Centre', 'Tamil Nadu', 'Madurai', 10.0574, 77.9628, 27900),
  ('TN-MDU-PHC-002', 'Usilampatti Community Health Post', 'Tamil Nadu', 'Madurai', 9.9678, 77.7942, 24600),
  ('TN-MDU-PHC-005', 'Melur Health Sub-Center', 'Tamil Nadu', 'Madurai', 10.05, 78.33, 29300),
  ('TN-TNV-PHC-001', 'Ambasamudram Health Post', 'Tamil Nadu', 'Tirunelveli', 8.7061, 77.4589, 25100)
]);
