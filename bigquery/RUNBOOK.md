# BigQuery ML Demand-Forecast Pipeline — Runbook

Dataset: `swasthya_ai` · Project: `swasthyasetu-ai-7b4e6`
Code: [`bigquery/queries/`](./queries) · Local pre-validation: [`validate_pipeline.js`](./validate_pipeline.js)

Run every file **in the order below**, top-to-bottom, in the BigQuery **Query Editor**
(open <https://console.cloud.google.com/bigquery>, click **+ Compose new query**, paste, **Run**).

---

## Why this pipeline is now deterministic

Every previously observed failure is designed out:

| Previous failure | Root cause | Fix in this pipeline |
|---|---|---|
| `Cannot replace a table with a different partitioning spec` | `forecast_results` was pre-created (`PARTITION BY forecast_date`) while `CREATE OR REPLACE TABLE ... AS SELECT` created an unpartitioned table | STEP 2/3 and 3-ALT begin with `DROP TABLE IF EXISTS`, then recreate with `PARTITION BY forecast_date CLUSTER BY phc_id, medicine_id` — identical spec to [`schema.sql`](./schema.sql) |
| `Not found: Model ... medicine_demand_forecast` | STEP 2 was run before STEP 1 | STEP 2 now runs after training; STEP 1 prints the model record so you can confirm it exists |
| `Unrecognized name: time_series_id` (or `phc_medicine_id`) | `ML.FORECAST` names the series column `time_series_id`; hand-written SQL guessed wrong | STEP 3 reads `INFORMATION_SCHEMA.COLUMNS` and builds the statement with `EXECUTE IMMEDIATE FORMAT(...)`, so it adapts to either name |
| Wrong `medicine_id` (`PARACETAMOL_500` → `PARACETAMOL`) | `SPLIT(id, '_')[OFFSET(1)]` breaks on medicine IDs containing `_` | Anchored regex `REGEXP_EXTRACT(... '^[A-Z]{2}-[A-Z]+-PHC-[0-9]+')` and `REGEXP_REPLACE(... '^...PHC-[0-9]+_')` |
| Empty `forecast_results` from the fallback | `WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 21 DAY)` matches **0 rows**, because the generated history ends `2025-02-15` | Fallback uses the last **21 available** days per series (`ROW_NUMBER() ... <= 21`) |
| Forecasts dated in the past | History is from 2025 while `CURRENT_DATE()` is 2026 | STEP 1 shifts every series to end **today**; fallback anchors on `GREATEST(MAX(date), CURRENT_DATE())` → forecasts cover the **next 14 days** |
| ARIMA_PLUS duplicate-timestamp error | CSV appended twice during earlier upload retries | STEP 1 / 3-ALT `GROUP BY series_date, phc_medicine_id` de-duplicates |
| Date column type mismatch (`STRING` vs `DATE`) | CSV auto-detect vs manual DDL | `SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(date AS STRING),1,10))` works for DATE / DATETIME / TIMESTAMP / STRING |
| "Out of memory" on `ML.FORECAST` | Transforming `ML.FORECAST` output directly is a documented OOM risk | STEP 2 stores the raw output first (`SELECT *`, no transformations); STEP 3 transforms the stored table |

Pre-flight evidence: `node bigquery/validate_pipeline.js` → **39/39 checks passed**
(column contract, regex parsing of every series ID, duplicate timestamps, ≥3 points/series,
no degenerate/zero-demand series, the date-alignment shift, the fallback window,
1,680 forecast rows, the Baramati ORS CRITICAL scenario, and static sanity of every SQL file).


---

## Run order

### STEP 0 — Pre-flight check (read-only, ~2 s)
Run [`queries/00_preflight_check.sql`](./queries/00_preflight_check.sql)

Expected: row counts `15 / 8 / 10800 / 120`, `120` series × `90` points, no duplicate
`(series_id, date)` rows, and `MH-PUNE-PHC-003 / ORS → 40 stock, 22/day, 1.8 days`.

### STEP 1 — Train the ARIMA_PLUS model (~1–3 min)
Run [`queries/01_train_model.sql`](./queries/01_train_model.sql)

Creates model `swasthya_ai.medicine_demand_forecast` (`ARIMA_PLUS`, `horizon = 14`,
`auto_arima = TRUE`, one series per `PHC_ID_MEDICINE_ID`).
If training is slow, uncomment `auto_arima_max_order = 2` and re-run.

### STEP 2 — Materialise the raw forecast (~5 s)
Run [`queries/02_materialize_forecast_output.sql`](./queries/02_materialize_forecast_output.sql)

Creates `swasthya_ai.forecast_results_raw` (untouched `ML.FORECAST` output) and prints
its exact column list. Expected row count: **1,680** (`120 × 14`).

### STEP 3 — Build `forecast_results` (~5 s)
Run [`queries/03_build_forecast_results.sql`](./queries/03_build_forecast_results.sql)

BigQuery script: auto-detects the series column, `DROP`s the old table, recreates
`swasthya_ai.forecast_results` (partitioned + clustered), then verifies row counts and
prints the 14 predicted days for `MH-PUNE-PHC-003 / ORS`.

### STEP 3-ALT — Fallback (only if STEP 2/3 is unavailable, ~2 s)
Run [`queries/03b_forecast_fallback.sql`](./queries/03b_forecast_fallback.sql)

Moving-average forecast producing the **same schema**. Run it *instead of* STEP 2+3
(it is also safe to run *after* them — it simply replaces the table), and STEP 4 still works.

### STEP 4 — Stock-out risk table (~5 s)
Run [`queries/04_build_stockout_risk.sql`](./queries/04_build_stockout_risk.sql)

Creates `swasthya_ai.stockout_risk` with `risk_tier` ∈
`STOCKED_OUT / CRITICAL (≤2 d) / HIGH (≤7 d) / MEDIUM (≤14 d) / SAFE`, both
`days_remaining` (model) and `days_remaining_reported` (PHC-reported), plus the
state/district rollup that feeds the officer dashboard.

### STEP 5 — Model evidence (optional, for judging)
Run [`queries/05_model_evaluation_optional.sql`](./queries/05_model_evaluation_optional.sql)

`ML.ARIMA_EVALUATE` (AIC + per-series ARIMA orders), `ML.ARIMA_COEFFICIENTS`,
`ML.EXPLAIN_FORECAST` (trend / weekly seasonality / holiday effect / spike
decomposition) and model metadata.

---

## Expected outputs

| Object | Type | Rows | Notes |
|---|---|---|---|
| `swasthya_ai.medicine_demand_forecast` | Model | 120 series | `ARIMA_PLUS`, horizon 14 |
| `swasthya_ai.forecast_results_raw` | Table | 1,680 | raw `ML.FORECAST` output |
| `swasthya_ai.forecast_results` | Table | 1,680 | partitioned by `forecast_date` |
| `swasthya_ai.stockout_risk` | Table | 120 | scored (PHC × medicine) pairs |

Critical demo scenario (verified locally by `validate_pipeline.js`):

```
MH-PUNE-PHC-003 / ORS | stock 40 | reported 22/day -> 1.8 days
                      | forecast 37/day -> 1.1 days | CRITICAL
MH-PUNE-PHC-011 / ORS | stock 620 | SAFE (surplus donor for redistribution)
```

---

## Troubleshooting

| Error | Cause | Action |
|---|---|---|
| `Not found: Model ... medicine_demand_forecast` | STEP 1 not run (or run against another project) | Run STEP 1 first, wait for the green tick |
| `Unrecognized name: prediction_interval_lower_bound` | The model is not an `ARIMA_PLUS` model | Re-run STEP 1 exactly as written |
| `forecast_results_raw has no time-series id column` (ASSERT) | STEP 2 not run / wrong dataset selected | Re-run STEP 2 and confirm the dataset is `swasthya_ai` |
| `forecast_results` is empty | Fallback used with the old `CURRENT_DATE() - 21 DAY` filter | Use `03b_forecast_fallback.sql` (last-21-available-days window) |
| `Duplicate time series timestamps` from ARIMA_PLUS | CSV appended more than once | STEP 1 already de-duplicates; upload with *Write preference = Overwrite table* |
| Billing / quota error during training | Project not on a billing-enabled plan | Use STEP 3-ALT (fallback) — Steps 4–5 are unchanged |
| `EXECUTE IMMEDIATE` not supported by your tooling | Very old console / client | Use STEP 3-ALT (fallback), which needs no scripting |

---

## Re-running after new PHC telemetry

1. Append the new daily rows to `inventory_history` (BigQuery UI → **Load data** →
   *Write preference* = **Append to table**), or push them through the
   `POST /phcUpdate` endpoint in `functions/index.js`.
2. Re-run STEP 1 (retrain), then STEP 2 → STEP 3 → STEP 4.
   The `DROP TABLE IF EXISTS` statements make every step idempotent.

---

## ADDENDUM — STEP 3-LITE (no scripting, if `EXECUTE IMMEDIATE` is unavailable)

Run this **only** if STEP 3 reports that dynamic SQL is unsupported. First look at
the column list printed by STEP 2 and note the time-series column name
(`time_series_id` or `phc_medicine_id`), then use that name in place of
`time_series_id` below.

```sql
DROP TABLE IF EXISTS `swasthya_ai.forecast_results`;

CREATE TABLE `swasthya_ai.forecast_results`
PARTITION BY forecast_date
CLUSTER BY phc_id, medicine_id
AS
SELECT
  time_series_id                                                                  AS phc_medicine_id,
  REGEXP_EXTRACT(time_series_id, r'^[A-Z]{2}-[A-Z]+-PHC-[0-9]+')                  AS phc_id,
  REGEXP_REPLACE(time_series_id, r'^[A-Z]{2}-[A-Z]+-PHC-[0-9]+_', '')             AS medicine_id,
  DATE(forecast_timestamp)                                                        AS forecast_date,
  ROUND(CAST(forecast_value AS FLOAT64), 2)                                       AS forecast_value,
  ROUND(CAST(prediction_interval_lower_bound AS FLOAT64), 2)                      AS prediction_interval_lower_bound,
  ROUND(CAST(prediction_interval_upper_bound AS FLOAT64), 2)                      AS prediction_interval_upper_bound,
  CURRENT_TIMESTAMP()                                                             AS created_at
FROM `swasthya_ai.forecast_results_raw`;
```

Everything after this (STEP 4, STEP 5) is identical.

