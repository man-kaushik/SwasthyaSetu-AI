const fs = require("fs");
const path = require("path");

const dataDir = path.resolve(__dirname, "../data");
const outDir = path.resolve(__dirname, "seed_sql");

// 1. seed_phcs.sql
const phcs = JSON.parse(fs.readFileSync(path.join(dataDir, "phcs.json"), "utf8"));
const phcRows = phcs.map(p => 
  `('${p.phc_id}', '${p.name.replace(/'/g, "\\'")}', '${p.state}', '${p.district}', ${p.lat}, ${p.lng}, ${p.population_served})`
).join(",\n  ");

const phcSql = `-- ==========================================================
-- SwasthyaSetu AI: Direct Seed for PHCs (No CSV Upload Required)
-- Paste and run this directly in BigQuery Query Editor
-- ==========================================================
CREATE OR REPLACE TABLE \`swasthya_ai.phcs\` AS
SELECT * FROM UNNEST([
  STRUCT<phc_id STRING, name STRING, state STRING, district STRING, lat FLOAT64, lng FLOAT64, population_served INT64>
  ${phcRows}
]);
`;
fs.writeFileSync(path.join(outDir, "01_seed_phcs.sql"), phcSql, "utf8");

// 2. seed_medicines.sql
const medicines = JSON.parse(fs.readFileSync(path.join(dataDir, "medicines.json"), "utf8"));
const medRows = medicines.map(m => 
  `('${m.medicine_id}', '${m.medicine_name.replace(/'/g, "\\'")}', '${m.category.replace(/'/g, "\\'")}', '${m.unit.replace(/'/g, "\\'")}', ${m.safety_stock}, ${m.standard_daily_consumption})`
).join(",\n  ");

const medSql = `-- ==========================================================
-- SwasthyaSetu AI: Direct Seed for Medicines (No CSV Upload Required)
-- Paste and run this directly in BigQuery Query Editor
-- ==========================================================
CREATE OR REPLACE TABLE \`swasthya_ai.medicines\` AS
SELECT * FROM UNNEST([
  STRUCT<medicine_id STRING, medicine_name STRING, category STRING, unit STRING, safety_stock INT64, standard_daily_consumption INT64>
  ${medRows}
]);
`;
fs.writeFileSync(path.join(outDir, "02_seed_medicines.sql"), medSql, "utf8");

// 3. seed_current_inventory.sql
const curr = JSON.parse(fs.readFileSync(path.join(dataDir, "current_inventory.json"), "utf8"));
const currRows = curr.map(c => 
  `(TIMESTAMP('${c.updated_at}'), '${c.phc_id}', '${c.medicine_id}', '${c.medicine_name.replace(/'/g, "\\'")}', ${c.current_stock}, ${c.daily_consumption}, ${c.beds_available}, ${c.doctors_present}, ${c.nurses_present}, ${c.patient_footfall})`
).join(",\n  ");

const currSql = `-- ==========================================================
-- SwasthyaSetu AI: Direct Seed for Current Inventory (No CSV Upload Required)
-- Paste and run this directly in BigQuery Query Editor
-- ==========================================================
CREATE OR REPLACE TABLE \`swasthya_ai.current_inventory\`
CLUSTER BY phc_id, medicine_id
AS
SELECT * FROM UNNEST([
  STRUCT<updated_at TIMESTAMP, phc_id STRING, medicine_id STRING, medicine_name STRING, current_stock INT64, daily_consumption INT64, beds_available INT64, doctors_present INT64, nurses_present INT64, patient_footfall INT64>
  ${currRows}
]);
`;
fs.writeFileSync(path.join(outDir, "03_seed_current_inventory.sql"), currSql, "utf8");

// 4. seed_inventory_history.sql
const historyCsv = fs.readFileSync(path.join(dataDir, "inventory_history.csv"), "utf8")
  .replace(/^\uFEFF/, "")
  .replace(/\r\n/g, "\n")
  .trimEnd();
const historyLines = historyCsv.split("\n");
const expectedHistoryHeader = "date,phc_id,medicine_id,medicine_name,daily_consumption,current_stock,patient_footfall";

if (historyLines[0] !== expectedHistoryHeader) {
  throw new Error("inventory_history.csv has an unexpected column header");
}
if (historyLines.some((line, index) => index > 0 && (line.split(",").length !== 7 || line.includes('"')))) {
  throw new Error("inventory_history.csv contains CSV quoting or delimiters that this seed query cannot parse");
}
if (historyCsv.includes("'''")) {
  throw new Error("inventory_history.csv contains the raw SQL string delimiter");
}
const historyData = historyLines.slice(1).join("\n");

const historySql = [
  "-- SwasthyaSetu AI: Seed inventory history from data/inventory_history.csv",
  "-- Run after creating the dataset/schema and before 01_train_model.sql.",
  "-- Recreates the history table with the same partitioning and clustering as schema.sql.",
  "CREATE OR REPLACE TABLE `swasthya_ai.inventory_history`",
  "PARTITION BY date",
  "CLUSTER BY phc_id, medicine_id",
  "AS",
  "WITH source AS (",
  "  SELECT r'''",
  historyData,
  "''' AS csv_text",
  "), csv_lines AS (",
  "  SELECT line",
  "  FROM source",
  "  CROSS JOIN UNNEST(SPLIT(csv_text, '\\n')) AS line",
  "  WHERE line != ''",
  "), parsed AS (",
  "  SELECT SPLIT(line, ',') AS fields",
  "  FROM csv_lines",
  ")",
  "SELECT",
  "  PARSE_DATE('%Y-%m-%d', fields[OFFSET(0)]) AS date,",
  "  fields[OFFSET(1)] AS phc_id,",
  "  fields[OFFSET(2)] AS medicine_id,",
  "  fields[OFFSET(3)] AS medicine_name,",
  "  SAFE_CAST(fields[OFFSET(4)] AS INT64) AS daily_consumption,",
  "  SAFE_CAST(fields[OFFSET(5)] AS INT64) AS current_stock,",
  "  SAFE_CAST(fields[OFFSET(6)] AS INT64) AS patient_footfall",
  "FROM parsed;",
  "",
  "SELECT COUNT(*) AS rows_loaded FROM `swasthya_ai.inventory_history`;"
].join("\n");
fs.writeFileSync(path.join(outDir, "04_seed_inventory_history.sql"), historySql, "utf8");

console.log("Successfully generated BigQuery seed SQL files in bigquery/seed_sql/");
