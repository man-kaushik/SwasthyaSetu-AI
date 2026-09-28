#!/usr/bin/env node
/**
 * SwasthyaSetu AI - BigQuery-first READ path test
 * ------------------------------------------------
 * Stubs `@google-cloud/bigquery` BEFORE index.js loads it, then asserts that
 * GET /dashboard, GET /meta and GET /alerts serve rows from
 * `swasthya_ai.current_inventory`, `swasthya_ai.phcs`, `swasthya_ai.medicines`
 * and enrich stock-out risk from `swasthya_ai.stockout_risk`.
 *
 * Scenarios:
 *   A. BigQuery healthy  -> all reads answered from BQ rows (+ ML forecast)
 *   B. POST /phcUpdate   -> session override visible instantly over BQ rows
 *   C. Fresh instance with every BQ query throwing -> graceful memory fallback
 *
 * Run:  node test_read_bigquery.js      (or: npm run test:bq-read)
 */

// Env must be set BEFORE index.js is required (it reads env at module load).
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "test-project";
process.env.BQ_DATASET = process.env.BQ_DATASET || "swasthya_ai";

const bqModulePath = require.resolve("@google-cloud/bigquery", { paths: [__dirname] });

// ------------------------------------------------------------------ fake rows
const BQ_INVENTORY = [
  { updated_at: { value: "2026-09-28 06:00:00 UTC" }, phc_id: "MH-PUNE-PHC-001", medicine_id: "PARA", medicine_name: "Paracetamol 500mg", current_stock: "120", daily_consumption: "30", beds_available: "6", doctors_present: "2", nurses_present: "4", patient_footfall: "85" },
  { updated_at: { value: "2026-09-28 06:00:00 UTC" }, phc_id: "MH-PUNE-PHC-002", medicine_id: "AZI", medicine_name: "Azithromycin 500mg", current_stock: "300", daily_consumption: "10", beds_available: "10", doctors_present: "3", nurses_present: "5", patient_footfall: "60" },
  { updated_at: { value: "2026-09-28 06:00:00 UTC" }, phc_id: "MH-PUNE-PHC-003", medicine_id: "ACZ", medicine_name: "Amoxicillin 250mg", current_stock: "15", daily_consumption: "10", beds_available: "2", doctors_present: "0", nurses_present: "1", patient_footfall: "120" }
];
const BQ_PHCS = [
  { phc_id: "MH-PUNE-PHC-001", name: "BQ PHC Akurdi", district: "Pune", state: "Maharashtra", lat: 18.6, lng: 73.7, population: 45000 },
  { phc_id: "MH-PUNE-PHC-002", name: "BQ PHC Hadapsar", district: "Pune", state: "Maharashtra", lat: 18.5, lng: 73.9, population: 60000 },
  { phc_id: "MH-PUNE-PHC-003", name: "BQ PHC Manikdaohole", district: "Pune", state: "Maharashtra", lat: 18.68, lng: 73.82, population: 30000 }
];
const BQ_MEDICINES = [
  { medicine_id: "PARA", medicine_name: "Paracetamol 500mg", units: "Tablets", safety_stock: 250 },
  { medicine_id: "AZI", medicine_name: "Azithromycin 500mg", units: "Tablets", safety_stock: 120 },
  { medicine_id: "ACZ", medicine_name: "Amoxicillin 250mg", units: "Capsules", safety_stock: 150 }
];
const BQ_RISK = [
  { phc_id: "MH-PUNE-PHC-001", medicine_id: "PARA", forecast_daily_demand: 34, days_remaining: 3.5, risk_tier: "WARNING" },
  { phc_id: "MH-PUNE-PHC-003", medicine_id: "ACZ", forecast_daily_demand: 12, days_remaining: 1.5, risk_tier: "CRITICAL" }
];

const captured = { queries: [], broken: false };

class FakeBigQuery {
  constructor(options) {
    this.options = options || {};
  }

  async query(request) {
    captured.queries.push(request);
    if (captured.broken || this.options.broken) throw new Error("simulated BigQuery outage");
    const sql = request.query || "";
    if (sql.includes("stockout_risk")) return [BQ_RISK];
    if (sql.includes(".phcs")) return [BQ_PHCS];
    if (sql.includes(".medicines")) return [BQ_MEDICINES];
    if (sql.includes("current_inventory")) return [captured.inventoryOverride || BQ_INVENTORY];
    return [[]];
  }

  dataset() {
    return {
      table: () => ({
        insert: async () => {
          if (captured.broken) throw new Error("simulated insert outage");
          return [{ insertErrors: [] }];
        }
      })
    };
  }
}

function installFakeBigQuery() {
  require.cache[bqModulePath] = {
    id: bqModulePath,
    filename: bqModulePath,
    loaded: true,
    exports: { BigQuery: FakeBigQuery }
  };
}

installFakeBigQuery();
const { app: bqApp } = require("./index");

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail: detail === undefined ? "" : String(detail) });
}

async function get(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, json: await res.json() };
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function scenarioAB() {
  const { server, baseUrl } = await listen(bqApp);
  console.log(`\nBigQuery-first read test at ${baseUrl}\n`);

  const dash = await get(baseUrl, "/dashboard");
  const inv = dash.json.inventory || [];
  const summary = dash.json.summary || {};

  check("GET /dashboard answers 200", dash.status === 200, `status=${dash.status}`);
  check("Dashboard reports inventory_source=bigquery",
    summary.data_source?.bigquery === true && summary.data_source?.inventory_source === "bigquery",
    JSON.stringify(summary.data_source));
  check("Inventory rows come from current_inventory (3 BQ rows)",
    inv.length === 3, `rows=${inv.length}`);
  check("BigQuery scalar wrappers unwrapped + numerics coerced",
    inv.every(r => typeof r.current_stock === "number" && typeof r.beds_available === "number" &&
      typeof r.updated_at === "string"),
    JSON.stringify(inv.map(r => [typeof r.current_stock, typeof r.updated_at])));
  check("PHC metadata (name/district/lat) served from BQ phcs table",
    inv.every(r => String(r.phc_name).startsWith("BQ PHC") && r.district === "Pune" && typeof r.lat === "number"),
    inv.map(r => r.phc_name).join(", "));
  check("PHC directory size comes from BQ phcs table",
    summary.total_phc_directory === 3, `directory=${summary.total_phc_directory}`);
  check("stockout_risk forecast merges into rows (2 rows scored by BQ ML)",
    summary.records_scored_by_bigquery_ml === 2 && summary.data_source.bigquery_forecast === true,
    `scored=${summary.records_scored_by_bigquery_ml}`);

  const acz = inv.find(r => r.medicine_id === "ACZ");
  check("CRITICAL risk tier + forecast days flow through to the row",
    acz && acz.risk_level === "CRITICAL" && acz.forecast_days_remaining === 1.5 && acz.forecast_daily_demand === 12,
    JSON.stringify(acz && [acz.risk_level, acz.forecast_days_remaining, acz.forecast_daily_demand]));
  check("Summary aggregates only BigQuery telemetry rows",
    summary.beds_available === 18 && summary.doctors_on_duty === 5 && summary.patient_footfall_today === 265,
    `beds=${summary.beds_available}, docs=${summary.doctors_on_duty}, footfall=${summary.patient_footfall_today}`);

  const meta = await get(baseUrl, "/meta");
  check("GET /meta serves BQ phcs with normalized keys (id, population_served)",
    meta.status === 200 && meta.json.phcs.length === 3 && meta.json.phcs[0].id === "MH-PUNE-PHC-001" &&
      meta.json.phcs[0].population_served === 45000,
    JSON.stringify(meta.json.phcs?.[0]));
  check("GET /meta serves BQ medicines with safetyStock + unit aliases",
    meta.json.medicines.length === 3 && meta.json.medicines.every(m => m.id && m.name &&
      typeof m.safetyStock === "number" && typeof m.unit === "string"),
    JSON.stringify(meta.json.medicines?.[0]));
  check("GET /meta flags bigquery directory source",
    meta.json.directory_source?.bigquery === true,
    JSON.stringify(meta.json.directory_source));

  const alerts = await get(baseUrl, "/alerts");
  check("GET /alerts serves BQ inventory tagged inventory_source=bigquery",
    alerts.status === 200 && alerts.json.inventory_source === "bigquery" &&
      alerts.json.alerts.every(a => String(a.phc_name).startsWith("BQ PHC")),
    `alerts=${alerts.json.total_alerts}`);
  check("ACZ row surfaces a CRITICAL stock alert",
    alerts.json.alerts.some(a => a.medicine_id === "ACZ" && a.severity === "CRITICAL"),
    JSON.stringify(alerts.json.alerts?.filter(a => a.medicine_id === "ACZ").map(a => a.severity)));

  const queriesSoFar = captured.queries.length;
  await get(baseUrl, "/dashboard");
  await get(baseUrl, "/meta");
  check("Directory queries cached for repeat calls (max 2 new queries: inventory + risk)",
    captured.queries.length - queriesSoFar <= 2,
    `new queries=${captured.queries.length - queriesSoFar}`);

  // ============================ scenario B: session override over BQ rows ====
  const post = await fetch(`${baseUrl}/phcUpdate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phc_id: "MH-PUNE-PHC-002", medicine_id: "AZI", medicine_name: "Azithromycin 500mg", current_stock: 77, daily_consumption: 10 })
  });
  check("POST /phcUpdate accepted while BigQuery is primary", post.status === 200, `status=${post.status}`);
  const dashAfter = await get(baseUrl, "/dashboard");
  const azi = dashAfter.json.inventory.find(r => r.medicine_id === "AZI");
  check("Updated stock (77) visible instantly even before BQ converges",
    azi && azi.current_stock === 77 && dashAfter.json.summary.data_source.inventory_source === "bigquery",
    `stock=${azi?.current_stock}`);

  // Scenario D (recommendation + approval loop) runs in its own module instance
  // with donor-rich inventory rows.
  server.close();
}

const BQ_INVENTORY_D = [
  ...BQ_INVENTORY,
  { updated_at: { value: "2026-09-28 06:00:00 UTC" }, phc_id: "MH-PUNE-PHC-002", medicine_id: "ACZ", medicine_name: "Amoxicillin 250mg", current_stock: "300", daily_consumption: "8", beds_available: "10", doctors_present: "3", nurses_present: "5", patient_footfall: "60" }
];

async function scenarioD() {
  captured.broken = false;
  captured.inventoryOverride = BQ_INVENTORY_D;
  captured.queries = [];
  delete require.cache[require.resolve("./index")];
  const { app: loopApp } = require("./index");
  const { server, baseUrl } = await listen(loopApp);
  console.log(`\nRecommendation/approval loop test at ${baseUrl}\n`);

  const recRes = await fetch(`${baseUrl}/recommendation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phc_id: "MH-PUNE-PHC-003", medicine_id: "ACZ" })
  });
  const rec = await recRes.json();
  check("POST /recommendation answers 200 tagged with BQ inventory source",
    recRes.status === 200 && rec.recommended === true && rec.inventory_source === "bigquery",
    `status=${recRes.status}, src=${rec.inventory_source}, donor=${rec.recommended_source}`);
  check("Donor ranking uses BQ phcs directory (BQ PHC name on the donor)",
    String(rec.source_phc_name).startsWith("BQ PHC") && rec.source_phc_id === "MH-PUNE-PHC-002",
    `donor=${rec.source_phc_name}`);
  check("Recommendation row upserted into swasthya_ai.recommendations",
    captured.queries.some(q => q.query.includes("INSERT INTO `test-project.swasthya_ai.recommendations`")),
    captured.queries.map(q => (q.query.match(/`([^`]+recommendations)`/) || [])[1]).filter(Boolean).join(" | "));

  captured.queries = [];
  const apprRes = await fetch(`${baseUrl}/approveTransfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source_phc_id: rec.source_phc_id,
      destination_phc_id: rec.shortage_phc,
      medicine_id: "ACZ",
      quantity: 50
    })
  });
  const appr = await apprRes.json();
  check("POST /approveTransfer persists both stock movements to BigQuery",
    apprRes.status === 200 && appr.saved_to_bigquery === true &&
      appr.stock_movement.source_stock_after === 250 && appr.stock_movement.destination_stock_after === 65,
    JSON.stringify(appr.stock_movement));
  check("Approval re-upserts current_inventory for donor and recipient",
    captured.queries.filter(q => q.query.includes("INSERT INTO `test-project.swasthya_ai.current_inventory`")).length === 2,
    `upserts=${captured.queries.filter(q => q.query.includes("current_inventory") && q.query.includes("INSERT")).length}`);

  const dash = await get(baseUrl, "/dashboard");
  const destRow = dash.json.inventory.find(r => r.phc_id === "MH-PUNE-PHC-003" && r.medicine_id === "ACZ");
  const donorRow = dash.json.inventory.find(r => r.phc_id === "MH-PUNE-PHC-002" && r.medicine_id === "ACZ");
  check("Approved transfer visible on the next BigQuery-sourced dashboard",
    destRow?.current_stock === 65 && donorRow?.current_stock === 250 &&
      dash.json.summary.data_source.inventory_source === "bigquery",
    `dest=${destRow?.current_stock}, donor=${donorRow?.current_stock}`);
  check("Dashboard PHC names still come from the BQ phcs table after writes",
    dash.json.inventory.every(r => String(r.phc_name).startsWith("BQ PHC")),
    dash.json.inventory.map(r => r.phc_name).slice(0, 4).join(", "));

  server.close();
  captured.inventoryOverride = null;
}

async function scenarioC() {
  // Fresh module instance with every BigQuery call throwing: must fall back
  // to the local seed store and still answer 200 on every read endpoint.
  captured.broken = true;
  captured.queries = [];
  delete require.cache[require.resolve("./index")];
  const { app: brokenApp } = require("./index");
  const { server, baseUrl } = await listen(brokenApp);
  console.log(`\nBigQuery-outage fallback test at ${baseUrl}\n`);

  const dash = await get(baseUrl, "/dashboard");
  check("Dashboard survives full BigQuery outage (200 + memory fallback)",
    dash.status === 200 && Array.isArray(dash.json.inventory) && dash.json.inventory.length > 0 &&
      dash.json.summary.data_source.inventory_source === "memory" &&
      dash.json.summary.data_source.bigquery === false,
    `status=${dash.status}, source=${dash.json.summary?.data_source?.inventory_source}`);
  check("Outage is reported through data_source for the UI badge",
    dash.json.summary?.data_source?.memory_fallback === true,
    JSON.stringify(dash.json.summary?.data_source));

  const meta = await get(baseUrl, "/meta");
  check("Meta survives outage and serves the local seed directory",
    meta.status === 200 && meta.json.phcs.length > 0 && meta.json.medicines.length > 0 &&
      meta.json.directory_source?.bigquery === false,
    `phcs=${meta.json.phcs?.length}, medicines=${meta.json.medicines?.length}`);

  const alerts = await get(baseUrl, "/alerts");
  check("Alerts survive outage and still compute severities",
    alerts.status === 200 && alerts.json.inventory_source === "memory" && alerts.json.total_alerts > 0,
    `alerts=${alerts.json.total_alerts}`);

  const health = await get(baseUrl, "/health");
  check("Health reports bigquery_configured with a surfaced error message",
    health.status === 200 && health.json.data_source.bigquery_configured === true &&
      typeof health.json.data_source.bigquery_error === "string" &&
      health.json.data_source.bigquery_error.includes("simulated BigQuery outage"),
    JSON.stringify(health.json.data_source));

  server.close();
}

async function main() {
  await scenarioAB();
  await scenarioD();
  await scenarioC();

  const passed = results.filter(r => r.pass).length;
  console.log("=".repeat(68));
  results.forEach(r => console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name}${r.pass ? "" : `  -> ${r.detail}`}`));
  console.log("=".repeat(68));
  console.log(`${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
