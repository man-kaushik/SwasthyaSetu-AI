#!/usr/bin/env node
/**
 * SwasthyaSetu AI - BigQuery connectivity + data probe
 * ----------------------------------------------------
 * Answers with REAL data: which tables exist, exact row counts, column
 * schemas, and sample rows - so every read endpoint can be wired to the
 * columns that actually exist.
 *
 * Usage (from the functions/ directory):
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\keys\swasthyasetu-ai-7b4e6-a5583ef6e109.json
 *   set GOOGLE_CLOUD_PROJECT=swasthyasetu-ai-7b4e6
 *   node bq_probe.js
 */

const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (err) {
  console.warn("dotenv unavailable:", err.message);
}
const { BigQuery } = require("@google-cloud/bigquery");

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "swasthyasetu-ai-7b4e6";
const DATASET = process.env.BQ_DATASET || "swasthya_ai";
const LOCATION = process.env.BQ_LOCATION || "US";
const FQT = (table) => `\`${PROJECT}.${DATASET}.${table}\``;

function shortRow(row) {
  return JSON.stringify(row);
}

async function run() {
  console.log(`Project: ${PROJECT}  Dataset: ${DATASET}  Location: ${LOCATION}\n`);
  const bq = new BigQuery({ projectId: PROJECT });

  const ask = async (label, sql, params) => {
    try {
      const [rows] = await bq.query({ query: sql, params, location: LOCATION });
      console.log(`--- ${label} (${rows.length} row${rows.length === 1 ? "" : "s"})`);
      rows.slice(0, 8).forEach(r => console.log("    " + shortRow(r)));
      if (rows.length > 8) console.log(`    ... and ${rows.length - 8} more`);
      console.log("");
      return rows;
    } catch (err) {
      console.log(`--- ${label} FAILED: ${err.message}\n`);
      return null;
    }
  };

  await ask("tables in dataset",
    `SELECT table_name, table_type FROM \`${PROJECT}.${DATASET}\`.INFORMATION_SCHEMA.TABLES ORDER BY table_name`);

  for (const table of ["phcs", "medicines", "current_inventory", "inventory_history", "alerts", "recommendations", "forecast_results", "stockout_risk"]) {
    await ask(`row count: ${table}`,
      `SELECT @table AS table_name, COUNT(*) AS total_rows FROM ${FQT(table)}`,
      { table });
  }

  await ask("columns of key tables",
    `SELECT table_name, column_name, data_type
     FROM \`${PROJECT}.${DATASET}\`.INFORMATION_SCHEMA.COLUMNS
     WHERE table_name IN ('phcs','medicines','current_inventory','inventory_history','forecast_results','stockout_risk','alerts','recommendations')
     ORDER BY table_name, ordinal_position`);

  const inv = await ask("sample current_inventory rows",
    `SELECT * FROM ${FQT("current_inventory")} LIMIT 5`);

  if (inv && inv.length > 0) {
    const first = inv[0];
    const phc = first.phc_id ? String(first.phc_id) : null;
    const med = first.medicine_id ? String(first.medicine_id) : null;
    console.log(`First composite key seen: phc_id=${phc} medicine_id=${med}\n`);

    await ask("same row refetched by key (proves the app key works)",
      `SELECT * FROM ${FQT("current_inventory")} WHERE phc_id = @phc AND medicine_id = @med LIMIT 1`,
      { phc, med });
  }

  await ask("sample phcs rows",
    `SELECT * FROM ${FQT("phcs")} LIMIT 5`);

  await ask("sample medicines rows",
    `SELECT * FROM ${FQT("medicines")} LIMIT 8`);

  const probeAlertCols = await ask("columns of alerts table (for server-side alert writes)",
    `SELECT column_name, data_type
     FROM \`${PROJECT}.${DATASET}\`.INFORMATION_SCHEMA.COLUMNS
     WHERE table_name = 'alerts'
     ORDER BY ordinal_position`);

  if (probeAlertCols !== null) {
    await ask("sample alerts rows", `SELECT * FROM ${FQT("alerts")} LIMIT 3`);
  }

  const probeRecCols = await ask("columns of recommendations table",
    `SELECT column_name, data_type
     FROM \`${PROJECT}.${DATASET}\`.INFORMATION_SCHEMA.COLUMNS
     WHERE table_name = 'recommendations'
     ORDER BY ordinal_position`);

  if (probeRecCols !== null) {
    await ask("sample recommendations rows", `SELECT * FROM ${FQT("recommendations")} LIMIT 3`);
  }

  console.log("Probe complete.");
}

run().catch(err => {
  console.error("Probe crashed:", err.message);
  process.exit(1);
});
