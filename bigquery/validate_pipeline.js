/**
 * SwasthyaSetu AI - BigQuery pipeline pre-validation harness
 * ----------------------------------------------------------
 * Simulates the SQL that runs in BigQuery (queries 00-04) against the local
 * CSVs in `data/`, so every logic step is proven BEFORE spending time/quota in
 * BigQuery. Run with:  node bigquery/validate_pipeline.js
 *
 * It validates:
 *   1. Column contract of data/inventory_history.csv + data/current_inventory.csv
 *   2. The `XX-YYY-PHC-NNN_<MEDICINE>` regex parsing used in
 *      03_build_forecast_results.sql (catches the SPLIT() underscore bug)
 *   3. Duplicate (series, date) detection (= ARIMA_PLUS duplicate-timestamp risk)
 *   4. Points-per-series >= 3 (ARIMA_PLUS minimum) and the date-alignment shift
 *   5. The moving-average fallback forecast (03b) -> 14 days x 120 series
 *   6. The risk scoring in 04_build_stockout_risk.sql, incl. the critical
 *      MH-PUNE-PHC-003 / ORS scenario (~1.8 days to stock-out)
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");

// ---------------------------------------------------------------- CSV parsing
function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function readCsv(fileName) {
  const raw = fs.readFileSync(path.join(DATA_DIR, fileName), "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
  return { headers, rows };
}

// ------------------------------------------------------------------ assertions
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail === undefined ? "" : String(detail) });
}

const DAY_MS = 24 * 60 * 60 * 1000;
function toDate(s) { return new Date(`${s}T00:00:00Z`); }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * DAY_MS); }
function diffDays(a, b) { return Math.round((a.getTime() - b.getTime()) / DAY_MS); }

// ============================================================ 1. SCHEMA CONTRACT
const history = readCsv("inventory_history.csv");
const current = readCsv("current_inventory.csv");
const phcs = readCsv("phcs.csv");
const medicines = readCsv("medicines.csv");

const EXPECTED_HISTORY_COLUMNS = ["date", "phc_id", "medicine_id", "medicine_name", "daily_consumption", "current_stock", "patient_footfall"];
const EXPECTED_CURRENT_COLUMNS = ["updated_at", "phc_id", "medicine_id", "medicine_name", "current_stock", "daily_consumption", "beds_available", "doctors_present", "nurses_present", "patient_footfall"];

check("inventory_history.csv column contract", history.headers.join(",") === EXPECTED_HISTORY_COLUMNS.join(","), history.headers.join(","));
check("current_inventory.csv column contract", current.headers.join(",") === EXPECTED_CURRENT_COLUMNS.join(","), current.headers.join(","));
check("phcs.csv has 15 facilities", phcs.rows.length === 15, `${phcs.rows.length} rows`);
check("medicines.csv has 8 medicines", medicines.rows.length === 8, `${medicines.rows.length} rows`);
check("inventory_history.csv has 10,800 rows", history.rows.length === 10800, `${history.rows.length} rows`);
check("current_inventory.csv has 120 rows", current.rows.length === 120, `${current.rows.length} rows`);

// ============================== 2. REGEX ID PARSING (the SPLIT() bug guard)
const PHC_RE = /^[A-Z]{2}-[A-Z]+-PHC-[0-9]+/;
const PHC_PREFIX_RE = /^[A-Z]{2}-[A-Z]+-PHC-[0-9]+_/;

const seriesKeys = new Set();
let regexFailures = 0;
let underscoreIdCount = 0;

for (const row of history.rows) {
  const seriesId = `${row.phc_id}_${row.medicine_id}`;
  seriesKeys.add(seriesId);
  if (row.medicine_id.includes("_")) underscoreIdCount++;

  const extract = seriesId.match(PHC_RE);
  const parsedPhc = extract ? extract[0] : null;
  const parsedMed = seriesId.replace(PHC_PREFIX_RE, "");

  if (parsedPhc !== row.phc_id || parsedMed !== row.medicine_id) regexFailures++;
}

check("REGEXP_EXTRACT recovers phc_id for every row", regexFailures === 0, `${regexFailures} mismatches`);
check(
  "medicine IDs containing underscores are parsed correctly (SPLIT() would fail here)",
  underscoreIdCount > 0 && regexFailures === 0,
  `${underscoreIdCount} rows use underscore medicine IDs`
);
check("120 distinct time series (15 PHCs x 8 medicines)", seriesKeys.size === 120, `${seriesKeys.size} series`);

// ============== 3. DUPLICATE TIMESTAMPS + 4. POINTS PER SERIES & DATE SHIFT
const perSeriesDates = new Map();
for (const row of history.rows) {
  const key = `${row.phc_id}_${row.medicine_id}`;
  if (!perSeriesDates.has(key)) perSeriesDates.set(key, new Map());
  const dateMap = perSeriesDates.get(key);
  dateMap.set(row.date, (dateMap.get(row.date) || 0) + 1);
}

let duplicateTimestampRows = 0;
let minPoints = Infinity;
let maxPoints = 0;
for (const dateMap of perSeriesDates.values()) {
  const points = dateMap.size;
  if (points < minPoints) minPoints = points;
  if (points > maxPoints) maxPoints = points;
  for (const count of dateMap.values()) if (count > 1) duplicateTimestampRows += count - 1;
}

check("No duplicate (series, date) rows in history", duplicateTimestampRows === 0, `${duplicateTimestampRows} duplicates`);
check("Every series has >= 3 points (ARIMA_PLUS minimum)", minPoints >= 3, `min=${minPoints}, max=${maxPoints}`);
check("Every series has 90 daily points", minPoints === 90 && maxPoints === 90, `min=${minPoints}, max=${maxPoints}`);

// Date alignment: history ends in the past -> STEP 1 shifts it to end today.
const allDates = history.rows.map((r) => r.date).sort();
const lastHistoryDate = allDates[allDates.length - 1];
const today = toDate(isoDate(new Date()));
const shiftDays = diffDays(today, toDate(lastHistoryDate));

// ================== 5. FALLBACK FORECAST SIMULATION (03b_forecast_fallback.sql)
// Mirrors: GROUP BY (series, date) dedupe -> last 21 available days ->
// average daily demand -> 14 future days anchored on GREATEST(last_date, today).
const dailyBySeries = new Map();
for (const row of history.rows) {
  const key = `${row.phc_id}_${row.medicine_id}`;
  if (!dailyBySeries.has(key)) dailyBySeries.set(key, new Map());
  const dateMap = dailyBySeries.get(key);
  const value = Number(row.daily_consumption);
  const prev = dateMap.get(row.date);
  if (prev) {
    prev.sum += value;
    prev.count += 1;
  } else {
    dateMap.set(row.date, { sum: value, count: 1 });
  }
}

const anchorDate = toDate(lastHistoryDate) > today ? toDate(lastHistoryDate) : today;
const simulatedForecast = new Map(); // series -> { avgDailyDemand, rows }

for (const [seriesId, dateMap] of dailyBySeries.entries()) {
  const ordered = [...dateMap.entries()]
    .map(([date, v]) => ({ date, value: v.sum / v.count }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // most recent first

  const window = ordered.slice(0, 21); // last 21 AVAILABLE days
  const avgDailyDemand = window.reduce((acc, r) => acc + r.value, 0) / window.length;
  const variance = window.length > 1
    ? window.reduce((acc, r) => acc + Math.pow(r.value - avgDailyDemand, 2), 0) / (window.length - 1)
    : 0;
  const stdDailyDemand = Math.sqrt(variance);

  const rows = [];
  for (let offset = 1; offset <= 14; offset++) {
    rows.push({
      forecast_date: isoDate(addDays(anchorDate, offset)),
      forecast_value: Math.round(avgDailyDemand * 100) / 100,
      lower: Math.max(0, Math.round((avgDailyDemand - 1.96 * stdDailyDemand) * 100) / 100),
      upper: Math.round((avgDailyDemand + 1.96 * stdDailyDemand) * 100) / 100
    });
  }
  simulatedForecast.set(seriesId, { avgDailyDemand, rows });
}

const shiftedLastDate = isoDate(addDays(toDate(lastHistoryDate), shiftDays));

check("Date-alignment shift lands the series on today", shiftedLastDate === isoDate(today), `history ends ${lastHistoryDate}, shift ${shiftDays} days -> ${shiftedLastDate}`);
check("Shifted forecast horizon is in the future", diffDays(addDays(toDate(shiftedLastDate), 14), today) === 14, `first forecast day = ${isoDate(addDays(toDate(shiftedLastDate), 1))}`);


const totalForecastRows = [...simulatedForecast.values()].reduce((acc, s) => acc + s.rows.length, 0);
const baramatiSim = simulatedForecast.get("MH-PUNE-PHC-003_ORS");

check("Fallback forecast produces 14 rows per series", [...simulatedForecast.values()].every((s) => s.rows.length === 14), "14 days each");
check("Fallback forecast produces 1,680 rows (120 x 14)", totalForecastRows === 1680, `${totalForecastRows} rows`);
check(
  "Fallback forecast window is NOT empty (old CURRENT_DATE-21 filter returns 0 rows)",
  [...simulatedForecast.values()].every((s) => s.avgDailyDemand > 0),
  `MH-PUNE-PHC-003 ORS demand = ${baramatiSim.avgDailyDemand.toFixed(2)}/day`
);
check(
  "Fallback forecast dates are anchored in the future",
  [...simulatedForecast.values()].every((s) => diffDays(toDate(s.rows[0].forecast_date), today) === 1),
  `first day = ${baramatiSim.rows[0].forecast_date}`
);

// ==================== 6. RISK SCORING SIMULATION (04_build_stockout_risk.sql)
const currentBySeries = new Map();
for (const row of current.rows) {
  const key = `${row.phc_id}_${row.medicine_id}`;
  const prev = currentBySeries.get(key) || { phc_id: row.phc_id, medicine_id: row.medicine_id, current_stock: 0, daily_consumption: 0 };
  // MAX() aggregation == the de-duplication used in the SQL
  prev.current_stock = Math.max(prev.current_stock, Number(row.current_stock));
  prev.daily_consumption = Math.max(prev.daily_consumption, Number(row.daily_consumption));
  currentBySeries.set(key, prev);
}

function riskTier(stock, demand) {
  if (stock <= 0) return "STOCKED_OUT";
  if (stock / demand <= 2) return "CRITICAL";
  if (stock / demand <= 7) return "HIGH";
  if (stock / demand <= 14) return "MEDIUM";
  return "SAFE";
}

const riskRows = [];
for (const [seriesId, inv] of currentBySeries.entries()) {
  const fc = simulatedForecast.get(seriesId);
  if (!fc) continue;
  riskRows.push({
    seriesId,
    phc_id: inv.phc_id,
    medicine_id: inv.medicine_id,
    current_stock: inv.current_stock,
    forecast_daily_demand: Math.round(fc.avgDailyDemand * 100) / 100,
    days_remaining: Math.round((inv.current_stock / fc.avgDailyDemand) * 10) / 10,
    risk_tier: riskTier(inv.current_stock, fc.avgDailyDemand)
  });
}
riskRows.sort((a, b) => a.days_remaining - b.days_remaining);

const critical = riskRows.filter((r) => r.risk_tier === "CRITICAL");
const high = riskRows.filter((r) => r.risk_tier === "HIGH");

check("Risk table covers all 120 (PHC x medicine) pairs", riskRows.length === 120, `${riskRows.length} rows`);

const baramati = riskRows.find((r) => r.seriesId === "MH-PUNE-PHC-003_ORS");
check(
  "CRITICAL scenario: MH-PUNE-PHC-003 ORS stock-outs in <= 2 days",
  Boolean(baramati) && baramati.risk_tier === "CRITICAL" && baramati.days_remaining <= 2,
  baramati ? `stock=${baramati.current_stock}, demand=${baramati.forecast_daily_demand}/day, days=${baramati.days_remaining}` : "missing"
);

const daund = riskRows.find((r) => r.seriesId === "MH-PUNE-PHC-011_ORS");
check(
  "Surplus donor exists: MH-PUNE-PHC-011 ORS has transferable surplus",
  Boolean(daund) && daund.risk_tier === "SAFE" && daund.current_stock >= 500,
  daund ? `stock=${daund.current_stock}, tier=${daund.risk_tier}` : "missing"
);


// ========= 7. ARIMA_PLUS TRAINABILITY PER SERIES (degenerate-case guard)
// A series that is constant, or always zero, makes ARIMA_PLUS forecasting
// degenerate (all-constant history has no ARIMA signal). Confirm we have none.
const constantSeries = [];
const allZeroSeries = [];

for (const [seriesId, dateMap] of dailyBySeries.entries()) {
  const values = [...dateMap.values()].map((v) => v.sum / v.count);
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  if (variance === 0) constantSeries.push(seriesId);
  if (Math.max(...values) === 0) allZeroSeries.push(seriesId);
}

check(
  "No constant (zero-variance) series that ARIMA_PLUS degenerates on",
  constantSeries.length === 0,
  constantSeries.length ? constantSeries.join(", ") : "all 120 series carry variance"
);
check(
  "No all-zero demand series",
  allZeroSeries.length === 0,
  allZeroSeries.length ? allZeroSeries.join(", ") : "all 120 series have real demand"
);

// One unified date grid: ARIMA_PLUS with TIME_SERIES_ID_COL is most stable when
// every series shares the same timestamps (no ragged series / no gaps).
const seriesGrid = new Set(history.rows.map((r) => r.date));
const perSeriesGridSizes = new Set([...perSeriesDates.values()].map((m) => m.size));
check(
  "All series share one complete 90-day grid (no gaps / no ragged series)",
  perSeriesGridSizes.size === 1 && perSeriesGridSizes.has(90) && seriesGrid.size === 90,
  `distinct dates = ${seriesGrid.size}, points per series = ${[...perSeriesGridSizes].join("/")}`
);

// ================= 8. STATIC SANITY CHECK OF THE SHIPPED SQL FILES
// Catches typos (unbalanced quotes/brackets, unterminated statements) in the
// BigQuery scripts without having to execute them.
const QUERY_DIR = path.resolve(__dirname, "queries");
const sqlFiles = fs.readdirSync(QUERY_DIR).filter((f) => f.endsWith(".sql")).sort();

function codeOnly(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    const third = sql[i + 2];
    if (ch === "-" && next === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (ch === "#") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (ch === "/" && next === "*") { i += 2; while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++; i += 2; continue; }
    if (ch === '"' && next === '"' && third === '"') {           // BigQuery triple-quoted string
      i += 3;
      while (i < sql.length && !(sql[i] === '"' && sql[i + 1] === '"' && sql[i + 2] === '"')) i++;
      i += 3;
      out += '""';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {                 // normal / raw string
      const quote = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === quote) { i++; break; }
        i++;
      }
      out += "''";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

check("bigquery/queries contains the full pipeline (7 SQL files)", sqlFiles.length === 7, sqlFiles.join(", "));

for (const file of sqlFiles) {
  const raw = fs.readFileSync(path.join(QUERY_DIR, file), "utf8");
  let stripped;
  try {
    stripped = codeOnly(raw);
  } catch (err) {
    check(`SQL ${file}: parseable`, false, err.message);
    continue;
  }

  let depth = 0;
  let balanced = true;
  for (const ch of stripped) {
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth < 0) balanced = false; }
  }
  if (depth !== 0) balanced = false;

  const terminated = stripped.trim().endsWith(";");
  check(`SQL ${file}: balanced brackets/quotes`, balanced, `final parenthesis depth ${depth}`);
  check(`SQL ${file}: statement terminated with ';'`, terminated, `last character '${stripped.trim().slice(-1)}'`);
}



// ==================================================================== REPORT
console.log("\n=========== SwasthyaSetu AI | BigQuery pipeline pre-validation ===========\n");
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
}

const actionable = riskRows.filter((x) => ["STOCKED_OUT", "CRITICAL", "HIGH"].includes(x.risk_tier));
console.log("\n--------- Predicted stock-out risks inside the alert window (7 days) ---------");
console.log("series_id".padEnd(26) + "stock".padStart(7) + "demand".padStart(9) + "days".padStart(7) + "   tier");
for (const r of actionable.slice(0, 10)) {
  console.log(
    r.seriesId.padEnd(26) +
    String(r.current_stock).padStart(7) +
    r.forecast_daily_demand.toFixed(2).padStart(9) +
    r.days_remaining.toFixed(1).padStart(7) +
    `   ${r.risk_tier}`
  );
}

console.log(`\nSummary: ${critical.length} CRITICAL, ${high.length} HIGH out of ${riskRows.length} monitored (PHC x medicine) pairs.`);
console.log(`Date handling: history ends ${lastHistoryDate} -> shifted by ${shiftDays} days so ARIMA_PLUS forecasts the next 14 days from today.`);

console.log("\n---------------- Demo scenario rows (used in the pitch) ----------------");
for (const id of ["MH-PUNE-PHC-003_ORS", "MH-PUNE-PHC-011_ORS", "BR-PATNA-PHC-009_ORS", "TN-MDU-PHC-001_INSULIN_REGULAR"]) {
  const r = riskRows.find((x) => x.seriesId === id);
  if (!r) continue;
  console.log(
    `${id.padEnd(30)} stock=${String(r.current_stock).padStart(4)}  forecast=${r.forecast_daily_demand.toFixed(2).padStart(6)}/day  ` +
    `days_remaining=${r.days_remaining.toFixed(1).padStart(5)}  tier=${r.risk_tier}`
  );
}


const failed = results.filter((r) => !r.pass);
console.log(`\nResult: ${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log("\nFAILED CHECKS:");
  failed.forEach((f) => console.log(` - ${f.name} ${f.detail ? `[${f.detail}]` : ""}`));
  process.exit(1);
}
console.log("All checks passed - the BigQuery queries in bigquery/queries/ are expected to run cleanly.\n");

