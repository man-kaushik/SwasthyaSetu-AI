#!/usr/bin/env node
/**
 * SwasthyaSetu AI - POST /phcUpdate -> BigQuery write test
 * --------------------------------------------------------
 * Stubs `@google-cloud/bigquery` BEFORE index.js loads it, then submits the
 * sample PHC payload and asserts the exact SQL, named parameters and table
 * targets that would run against `swasthya_ai.current_inventory`.
 *
 * Scenarios:
 *   1. upsert succeeds  -> DELETE + INSERT with correct params
 *   2. DML rejected      -> streaming insert fallback
 *   3. both rejected     -> endpoint still 200 with inserted=false
 *
 * Run:  node test_phc_update_bigquery.js      (or: npm run test:bq)
 */

// Env must be set BEFORE index.js is required (it reads env at module load).
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "test-project";
process.env.BQ_DATASET = process.env.BQ_DATASET || "swasthya_ai";

const bqModulePath = require.resolve("@google-cloud/bigquery", { paths: [__dirname] });

const captured = { queries: [], inserts: [], failMode: "none" };

class FakeBigQuery {
  async query(request) {
    if (captured.failMode === "query" || captured.failMode === "both") {
      throw new Error("simulated DML permission error");
    }
    captured.queries.push(request);
    return [[]];
  }

  dataset(name) {
    return {
      table: (tableName) => ({
        insert: async (row) => {
          if (captured.failMode === "insert" || captured.failMode === "both") {
            throw new Error("simulated streaming insert error");
          }
          captured.inserts.push({ dataset: name, table: tableName, row });
          return [{ insertErrors: [] }];
        }
      })
    };
  }
}

require.cache[bqModulePath] = {
  id: bqModulePath,
  filename: bqModulePath,
  loaded: true,
  exports: { BigQuery: FakeBigQuery }
};

const { app } = require("./index");

const SAMPLE_PAYLOAD = {
  phc_id: "MH-PUNE-PHC-003",
  medicine_id: "ORS",
  medicine_name: "ORS Packets",
  current_stock: 40,
  daily_consumption: 22,
  beds_available: 3,
  doctors_present: 1,
  nurses_present: 2,
  patient_footfall: 110
};

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail: detail === undefined ? "" : String(detail) });
}

async function post(baseUrl, payload) {
  const res = await fetch(`${baseUrl}/phcUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`\nPHC update -> BigQuery write test at ${baseUrl}\n`);

  // ------------------------------------------------------ scenario 1: upsert path
  const ok = await post(baseUrl, SAMPLE_PAYLOAD);
  const upsert = captured.queries[0];
  const history = captured.queries[1];

  check("POST /phcUpdate returns 200 with bigquery_inserted=true",
    ok.status === 200 && ok.json.bigquery_inserted === true,
    JSON.stringify(ok.json.bigquery));
  check("Reports target table as project.dataset.table",
    ok.json.bigquery?.table === `${process.env.GOOGLE_CLOUD_PROJECT}.swasthya_ai.current_inventory`,
    ok.json.bigquery?.table);
  check("Snapshot write is an UPSERT (DELETE then INSERT on the same key)",
    Boolean(upsert) && /DELETE FROM[\s\S]*current_inventory[\s\S]*WHERE phc_id = @phc_id[\s\S]*INSERT INTO[\s\S]*current_inventory/.test(upsert.query),
    upsert ? "delete+insert captured" : "no query captured");
  check("UPSERT targets swasthya_ai.current_inventory",
    Boolean(upsert) && upsert.query.includes(`${process.env.GOOGLE_CLOUD_PROJECT}.swasthya_ai.current_inventory`),
    upsert ? "table name ok" : "-");
  check("UPSERT column list matches the BigQuery table schema",
    Boolean(upsert) &&
      ["updated_at", "phc_id", "medicine_id", "medicine_name", "current_stock", "daily_consumption",
       "beds_available", "doctors_present", "nurses_present", "patient_footfall"]
        .every(col => upsert.query.includes(col)),
    "10 columns expected");

  const p = upsert?.params || {};
  check("UPSERT named params match the sample request payload",
    p.phc_id === "MH-PUNE-PHC-003" && p.medicine_id === "ORS" && p.current_stock === 40 &&
      p.daily_consumption === 22 && p.beds_available === 3 && p.doctors_present === 1 &&
      p.nurses_present === 2 && p.patient_footfall === 110 && typeof p.updated_at === "string",
    `stock=${p.current_stock}, consumption=${p.daily_consumption}, beds=${p.beds_available}`);
  check("UPSERT sends only params that exist in the SQL",
    upsert && Object.keys(p).sort().join(",") ===
      ["beds_available", "current_stock", "daily_consumption", "doctors_present", "medicine_id",
       "medicine_name", "nurses_present", "patient_footfall", "phc_id", "updated_at"].sort().join(","),
    upsert ? Object.keys(p).join(",") : "-");
  check("UPSERT runs in the dataset location (US)",
    Boolean(upsert) && upsert.location === "US",
    upsert ? upsert.location : "-");

  check("History row appended for the ML training table",
    Boolean(history) && history.query.includes("inventory_history"),
    history ? "inventory_history insert captured" : "missing");
  check("History params match its placeholders exactly",
    Boolean(history) && Object.keys(history.params).sort().join(",") ===
      ["current_stock", "daily_consumption", "medicine_id", "medicine_name", "patient_footfall", "phc_id"].sort().join(","),
    history ? Object.keys(history.params).join(",") : "-");
  check("History insert uses CURRENT_DATE()",
    Boolean(history) && history.query.includes("CURRENT_DATE()"),
    history ? "CURRENT_DATE()" : "-");

  check("Response carries success + firestore status keys",
    ok.json.success === true && typeof ok.json.saved_to_firestore === "boolean",
    `saved_to_firestore=${ok.json.saved_to_firestore}`);
  check("Response carries live risk preview (1.8 days, CRITICAL)",
    ok.json.live_risk_preview?.days_remaining === 1.8 && ok.json.live_risk_preview?.risk_level === "CRITICAL",
    JSON.stringify(ok.json.live_risk_preview));
  check("Persistence message names the stores it wrote to",
    /BigQuery/.test(ok.json.message || ""),
    ok.json.message);


  // --------------------------------------- scenario 2: DML denied -> stream insert
  captured.failMode = "query";
  const stream = await post(baseUrl, { ...SAMPLE_PAYLOAD, current_stock: 35 });
  const insert = captured.inserts[0];

  check("When DML is denied the endpoint falls back to a streaming insert",
    stream.status === 200 && stream.json.bigquery_inserted === true && stream.json.bigquery?.mode === "stream_insert",
    `mode=${stream.json.bigquery?.mode}`);
  check("Streaming insert targets the current_inventory table",
    Boolean(insert) && insert.table === "current_inventory" && insert.dataset === "swasthya_ai",
    insert ? `${insert.dataset}.${insert.table}` : "no insert captured");
  check("Streaming insert carries the submitted values",
    Boolean(insert) && insert.row.phc_id === "MH-PUNE-PHC-003" && insert.row.current_stock === 35,
    insert ? `stock=${insert.row.current_stock}` : "-");

  // -------------------------------------- scenario 3: everything denied -> 200 + false
  captured.failMode = "both";
  const denied = await post(baseUrl, { ...SAMPLE_PAYLOAD, current_stock: 30 });
  check("When both writes are denied the endpoint still returns 200",
    denied.status === 200 && denied.json.success === true,
    `status ${denied.status}`);
  check("...and reports bigquery_inserted=false with a reason",
    denied.json.bigquery_inserted === false && typeof denied.json.bigquery?.reason === "string" && denied.json.bigquery.reason.length > 0,
    denied.json.bigquery?.reason?.slice(0, 90));

  // ----------------------------------------------------------------------- report
  console.log("---------------------------------------------------------------");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  }
  const failed = results.filter(r => !r.pass);
  console.log("---------------------------------------------------------------");
  console.log(`Result: ${results.length - failed.length}/${results.length} checks passed.`);

  server.close();

  if (failed.length > 0) {
    console.log("\nFAILED CHECKS:");
    failed.forEach(f => console.log(` - ${f.name} ${f.detail ? `[${f.detail}]` : ""}`));
    process.exit(1);
  }
  console.log("POST /phcUpdate -> BigQuery write path verified.\n");
}

main().catch(err => {
  console.error("Test crashed:", err);
  process.exit(1);
});

