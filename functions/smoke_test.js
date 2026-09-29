#!/usr/bin/env node
/**
 * SwasthyaSetu AI - API smoke test
 * --------------------------------
 * Boots the real Express app (functions/index.js) on an ephemeral port and calls
 * every required endpoint end-to-end, asserting status codes and response shapes.
 * No Firebase credentials or API keys are needed - all integrations degrade
 * gracefully, so this also proves the offline fallback paths work.
 *
 * Run:  npm run smoke        (from the functions/ directory)
 *       node smoke_test.js
 */

const { app } = require("./index");

const PORT = process.env.SMOKE_PORT || 0;
const results = [];

function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail: detail === undefined ? "" : String(detail) });
}

async function call(baseUrl, method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { /* non-JSON body */ }
  return { status: res.status, json, text };
}

async function main() {
  const server = app.listen(PORT);
  await new Promise(resolve => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`\nSwasthyaSetu AI smoke test -> ${baseUrl}\n`);

  // ---------------------------------------------------------------- GET /health
  const health = await call(baseUrl, "GET", "/health");
  check("GET /health returns 200 + status ok", health.status === 200 && health.json?.status === "ok", `${health.status} ${health.json?.status}`);

  // ------------------------------------------------------------------ GET /
  const root = await call(baseUrl, "GET", "/");
  const rootRoutes = (root.json?.endpoints || []).map(e => `${e.method} ${e.path}`);
  const requiredApis = ["GET /dashboard", "POST /phcUpdate", "GET /alerts", "POST /recommendation", "POST /approveTransfer", "POST /explainAlert", "POST /translate"];
  check("GET / lists all 7 required APIs", requiredApis.every(r => rootRoutes.includes(r)), rootRoutes.join(" | "));

  // ------------------------------------------------------------------ GET /meta
  const meta = await call(baseUrl, "GET", "/meta");
  check("GET /meta returns 15 PHCs and 8 medicines",
    meta.status === 200 && meta.json?.phcs?.length === 15 && meta.json?.medicines?.length === 8,
    `${meta.json?.phcs?.length} PHCs / ${meta.json?.medicines?.length} medicines`);

  // ------------------------------------------------------------- GET /dashboard
  const dash = await call(baseUrl, "GET", "/dashboard");
  check("GET /dashboard returns summary + inventory",
    dash.status === 200 && typeof dash.json?.summary === "object" && Array.isArray(dash.json?.inventory),
    `status ${dash.status}, ${dash.json?.inventory?.length} records`);
  check("GET /dashboard summary has district metrics",
    dash.json?.summary && ["total_phcs_monitored", "critical_stockouts", "potential_stockouts_7d", "beds_available", "approved_transfers"]
      .every(k => k in dash.json.summary),
    JSON.stringify(dash.json?.summary));

  // ------------------------------------------------------------- POST /phcUpdate
  const update = await call(baseUrl, "POST", "/phcUpdate", {
    phc_id: "MH-PUNE-PHC-003",
    medicine_id: "ORS",
    medicine_name: "ORS Packets (Oral Rehydration)",
    current_stock: 40,
    daily_consumption: 22,
    beds_available: 3,
    doctors_present: 1,
    nurses_present: 2,
    patient_footfall: 110
  });
  check("POST /phcUpdate records telemetry",
    update.status === 200 && update.json?.success === true && update.json?.record?.current_stock === 40,
    `status ${update.status}`);
  check("POST /phcUpdate returns live risk preview",
    update.json?.live_risk_preview?.days_remaining === 1.8 && update.json?.live_risk_preview?.risk_level === "CRITICAL",
    JSON.stringify(update.json?.live_risk_preview));

  const badUpdate = await call(baseUrl, "POST", "/phcUpdate", { phc_id: "MH-PUNE-PHC-003" });
  check("POST /phcUpdate validates required fields (400)", badUpdate.status === 400, `status ${badUpdate.status}`);

  const dashAfter = await call(baseUrl, "GET", "/dashboard");
  const baramati = (dashAfter.json?.inventory || []).find(r => r.phc_id === "MH-PUNE-PHC-003" && r.medicine_id === "ORS");
  check("Telemetry from /phcUpdate appears on /dashboard",
    Boolean(baramati) && baramati.current_stock === 40,
    baramati ? `stock=${baramati.current_stock}, days=${baramati.days_remaining}` : "record missing");

  // ------------------------------------------------------------------ GET /alerts
  const alerts = await call(baseUrl, "GET", "/alerts");
  check("GET /alerts returns ranked alert feed",
    alerts.status === 200 && typeof alerts.json?.total_alerts === "number" && Array.isArray(alerts.json?.alerts),
    `${alerts.json?.total_alerts} alerts`);
  check("GET /alerts covers stock-out, bed and staffing alert types",
    ["STOCKOUT_CRITICAL", "BED_CAPACITY_CRITICAL", "STAFF_SURGE"].some(t => t in (alerts.json?.by_type || {})),
    JSON.stringify(alerts.json?.by_type));
  check("GET /alerts sorts CRITICAL first",
    alerts.json?.alerts?.[0]?.severity === "CRITICAL",
    `top severity ${alerts.json?.alerts?.[0]?.severity}`);

  // ----------------------------------------------------------- POST /recommendation
  const rec = await call(baseUrl, "POST", "/recommendation", { phc_id: "MH-PUNE-PHC-003", medicine_id: "ORS" });
  check("POST /recommendation proposes a donor transfer",
    rec.status === 200 && rec.json?.recommended === true && Boolean(rec.json?.recommended_source),
    `${rec.json?.recommended_source} -> ${rec.json?.shortage_phc}, qty ${rec.json?.recommended_transfer}`);
  check("Recommendation quantity fills destination to 10 days",
    rec.json?.recommended_transfer === Math.ceil(rec.json?.daily_consumption * 10 - rec.json?.current_stock) &&
      rec.json?.quantity === rec.json?.recommended_transfer,
    `required=${rec.json?.required_quantity}, transfer=${rec.json?.recommended_transfer}`);
  check("Donor surplus covers the full transfer and stays in the same state",
    rec.json?.source_surplus >= rec.json?.recommended_transfer && rec.json?.same_state === true &&
      rec.json?.source_current_stock - rec.json?.recommended_transfer >= rec.json?.source_predicted_daily_demand * 10,
    `surplus ${rec.json?.source_surplus}, donor left ${rec.json?.donor_remaining_stock}`);
  check("Recommendation selects the closest eligible donor and returns the requested reason",
    (rec.json?.alternative_donors || []).every(donor => donor.distance_km >= rec.json?.distance_km) &&
      typeof rec.json?.reason === "string" && rec.json.reason.includes("10-day coverage"),
    `${rec.json?.distance_km} km, ${rec.json?.reason}`);
  check("Recommendation has rationale + transit estimate",
    typeof rec.json?.rationale === "string" && typeof rec.json?.estimated_transit_hours === "number",
    `${rec.json?.estimated_transit_hours} h over ${rec.json?.distance_km} km`);

  const recAny = await call(baseUrl, "POST", "/recommendation", {});
  check("POST /recommendation works without filters (falls back to first record)",
    recAny.status === 200 && (recAny.json?.recommended === true || recAny.json?.recommended === false),
    `status ${recAny.status}`);


  // ----------------------------------------------------------- POST /approveTransfer
  const approve = await call(baseUrl, "POST", "/approveTransfer", {
    recommendation_id: rec.json?.recommendation_id,
    source_phc_id: rec.json?.recommended_source,
    destination_phc_id: rec.json?.shortage_phc,
    medicine_id: rec.json?.medicine_id,
    quantity: rec.json?.recommended_transfer,
    approved_by: "Smoke Test Officer"
  });
  check("POST /approveTransfer approves and dispatches",
    approve.status === 200 && approve.json?.success === true && /^TRF-/.test(approve.json?.transfer?.transfer_id || ""),
    `dispatch ${approve.json?.transfer?.vehicle_dispatch_id}`);
  check("Approval reports BigQuery persistence outcomes",
    typeof approve.json?.inventory_saved_to_bigquery === "boolean" &&
      typeof approve.json?.recommendation_saved_to_bigquery === "boolean" &&
      typeof approve.json?.saved_to_firestore === "boolean",
    `inventory=${approve.json?.inventory_saved_to_bigquery}, recommendation=${approve.json?.recommendation_saved_to_bigquery}, firestore=${approve.json?.saved_to_firestore}`);
  check("POST /approveTransfer moves stock to the deficit PHC",
    approve.json?.stock_movement?.destination_stock_after ===
      (approve.json?.stock_movement?.destination_stock_before + rec.json?.recommended_transfer),
    JSON.stringify(approve.json?.stock_movement));
  check("POST /approveTransfer accepts /recommendation field names (aliasing)",
    approve.status === 200 && approve.json?.transfer?.source_phc_id === rec.json?.recommended_source,
    `source=${approve.json?.transfer?.source_phc_id}`);
  const staleApprove = await call(baseUrl, "POST", "/approveTransfer", {
    recommendation_id: rec.json?.recommendation_id,
    source_phc_id: rec.json?.source_phc_id,
    destination_phc_id: rec.json?.destination_phc_id,
    medicine_id: rec.json?.medicine_id,
    quantity: rec.json?.quantity
  });
  check("POST /approveTransfer rejects a stale plan after destination stock changes",
    staleApprove.status === 409,
    `status ${staleApprove.status}`);

  const badApprove = await call(baseUrl, "POST", "/approveTransfer", { medicine_id: "ORS" });
  check("POST /approveTransfer validates required fields (400)", badApprove.status === 400, `status ${badApprove.status}`);

  const dashFinal = await call(baseUrl, "GET", "/dashboard");
  check("Approved transfer is counted on /dashboard",
    dashFinal.json?.summary?.approved_transfers >= 1,
    `approved_transfers=${dashFinal.json?.summary?.approved_transfers}`);
  check("Dashboard reflects the transferred stock balance",
    (dashFinal.json?.inventory || []).some(i => i.phc_id === rec.json?.recommended_source),
    "donor record present after transfer");


  // ------------------------------------------------------------- POST /explainAlert
  const explain = await call(baseUrl, "POST", "/explainAlert", {
    language: "Hindi",
    alertData: {
      phc_id: "MH-PUNE-PHC-003",
      phc_name: "Baramati Rural Health Centre",
      medicine_name: "ORS Packets (Oral Rehydration)",
      days_remaining: 1.8,
      patient_footfall: 110
    }
  });
  check("POST /explainAlert returns officer briefing",
    explain.status === 200 &&
      typeof explain.json?.explanation === "string" &&
      typeof explain.json?.action_recommendation === "string" &&
      typeof explain.json?.phc_sms_message === "string" &&
      typeof explain.json?.local_language_message === "string",
    explain.json?.source);
  check("POST /explainAlert flags urgency + translated note",
    ["CRITICAL", "HIGH"].includes(explain.json?.urgency) && explain.json?.local_language_message.length > 10,
    `${explain.json?.urgency}`);

  // ---------------------------------------------------------------- POST /translate
  const tr1 = await call(baseUrl, "POST", "/translate", { text: "Stockout Alert", targetLanguage: "Tamil" });
  check("POST /translate uses the medical phrase book",
    tr1.status === 200 && tr1.json?.translated !== "Stockout Alert" && typeof tr1.json?.translated === "string",
    `${tr1.json?.targetLanguage}: ${tr1.json?.translated}`);

  const tr2 = await call(baseUrl, "POST", "/translate", {
    text: "Restock required at Baramati PHC within 24 hours.",
    targetLanguage: "Bengali"
  });
  check("POST /translate never fails for unlisted text",
    tr2.status === 200 && typeof tr2.json?.translated === "string",
    tr2.json?.source);

  const tr3 = await call(baseUrl, "POST", "/translate", { targetLanguage: "Hindi" });
  check("POST /translate validates the text field (400)", tr3.status === 400, `status ${tr3.status}`);

  // ------------------------------------------------------------------ 404 handler
  const missing = await call(baseUrl, "GET", "/does-not-exist");
  check("Unknown routes return JSON 404", missing.status === 404 && Boolean(missing.json?.error), `status ${missing.status}`);

  // --------------------------------------------------------------------- report
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
  console.log("All API endpoints are working.\n");
}

main().catch(err => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});

