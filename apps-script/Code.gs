const MAX_INVENTORY_ROWS = 500;

function doGet(event) {
  const callback = String(event && event.parameter && event.parameter.callback || "");
  let response;

  try {
    response = event && event.parameter && event.parameter.route === "alerts"
      ? getAlerts_()
      : getDashboard_();
  } catch (error) {
    response = { error: `BigQuery dashboard query failed: ${error.message}` };
  }

  if (!callback) {
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (!/^__swasthyaSetuDashboard_[0-9]+_[0-9]+$/.test(callback)) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Invalid callback" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(`${callback}(${JSON.stringify(response)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function getDashboard_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("inventory-dashboard-v1");
  if (cached) return JSON.parse(cached);

  const properties = PropertiesService.getScriptProperties();
  const projectId = properties.getProperty("BQ_PROJECT_ID") || "swasthyasetu-ai-7b4e6";
  const datasetId = properties.getProperty("BQ_DATASET") || "swasthya_ai";
  const location = properties.getProperty("BQ_LOCATION") || "US";
  const sql = `
    SELECT
      i.updated_at,
      i.phc_id,
      COALESCE(p.name, i.phc_id) AS phc_name,
      p.district,
      p.state,
      i.medicine_id,
      COALESCE(i.medicine_name, m.medicine_name, i.medicine_id) AS medicine_name,
      i.current_stock,
      i.daily_consumption,
      i.beds_available,
      i.doctors_present,
      i.nurses_present,
      i.patient_footfall,
      (SELECT COUNT(*) FROM \`${projectId}.${datasetId}.phcs\`) AS total_phc_directory
    FROM \`${projectId}.${datasetId}.current_inventory\` AS i
    LEFT JOIN \`${projectId}.${datasetId}.phcs\` AS p USING (phc_id)
    LEFT JOIN \`${projectId}.${datasetId}.medicines\` AS m USING (medicine_id)
    ORDER BY phc_name, medicine_name
    LIMIT ${MAX_INVENTORY_ROWS}`;

  let result = BigQuery.Jobs.query({
    query: sql,
    useLegacySql: false,
    location,
    timeoutMs: 20000,
    maxResults: MAX_INVENTORY_ROWS
  }, projectId);
  const jobId = result.jobReference.jobId;
  let waitMs = 250;

  while (!result.jobComplete) {
    Utilities.sleep(waitMs);
    waitMs = Math.min(waitMs * 2, 2000);
    result = BigQuery.Jobs.getQueryResults(projectId, jobId, { location });
  }

  const forecastDemand = getSevenDayForecastDemand_(projectId, datasetId, location);
  const rows = (result.rows || []).map((row) => {
    const record = {};
    result.schema.fields.forEach((field, index) => {
      record[field.name] = row.f[index].v;
    });

    ["current_stock", "daily_consumption", "beds_available", "doctors_present", "nurses_present", "patient_footfall"]
      .forEach((field) => { record[field] = Number(record[field]) || 0; });

    const key = `${record.phc_id}__${record.medicine_id}`;
    record.predicted_daily_demand = forecastDemand.get(key) || record.daily_consumption;
    const consumption = record.predicted_daily_demand || 0;
    record.days_remaining = consumption > 0
      ? Math.round((record.current_stock / consumption) * 100) / 100
      : null;
    record.forecast_days_remaining = null;
    record.forecast_daily_demand = null;
    record.risk_level = record.days_remaining === null || record.days_remaining > 7
      ? "STABLE"
      : record.days_remaining <= 3
      ? "CRITICAL"
      : "WARNING";
    return record;
  });

  const distinctPhcs = new Set(rows.map((row) => row.phc_id));
  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  const critical = rows.filter((row) => row.risk_level === "CRITICAL").length;
  const warning = rows.filter((row) => row.risk_level === "WARNING").length;

  const payload = {
    summary: {
      total_phcs_monitored: distinctPhcs.size,
      total_phc_directory: Number(rows[0] && rows[0].total_phc_directory) || 0,
      total_medicine_records: rows.length,
      critical_stockouts: critical,
      potential_stockouts_7d: warning,
      beds_available: sum("beds_available"),
      doctors_on_duty: sum("doctors_present"),
      nurses_on_duty: sum("nurses_present"),
      patient_footfall_today: sum("patient_footfall"),
      facility_staff_shortages: rows.filter((row) => row.doctors_present === 0).length,
      approved_transfers: 0,
      records_scored_by_bigquery_ml: 0,
      data_source: {
        bigquery: true,
        firestore: false,
        bigquery_forecast: false,
        inventory_source: "bigquery",
        memory_fallback: false
      }
    },
    inventory: rows.map(({ total_phc_directory, ...row }) => row)
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length < 90000) cache.put("inventory-dashboard-v1", serialized, 30);
  return payload;
}

function getSevenDayForecastDemand_(projectId, datasetId, location) {
  try {
    let result = BigQuery.Jobs.query({
      query: `
        SELECT phc_id, medicine_id, AVG(forecast_value) AS predicted_daily_demand
        FROM \`${projectId}.${datasetId}.forecast_results\`
        WHERE forecast_date >= CURRENT_DATE()
          AND forecast_date < DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)
        GROUP BY phc_id, medicine_id`,
      useLegacySql: false,
      location,
      timeoutMs: 20000
    }, projectId);
    const jobId = result.jobReference.jobId;
    let waitMs = 250;

    while (!result.jobComplete) {
      Utilities.sleep(waitMs);
      waitMs = Math.min(waitMs * 2, 2000);
      result = BigQuery.Jobs.getQueryResults(projectId, jobId, { location });
    }

    return new Map((result.rows || []).map((row) => {
      const values = Object.fromEntries(result.schema.fields.map((field, index) => [field.name, row.f[index].v]));
      return [`${values.phc_id}__${values.medicine_id}`, Number(values.predicted_daily_demand) || 0];
    }));
  } catch (error) {
    console.warn(`7-day forecast unavailable; using reported demand: ${error.message}`);
    return new Map();
  }
}

function getAlerts_() {
  const dashboard = getDashboard_();
  const riskOrder = { CRITICAL: 0, WARNING: 1, STABLE: 2 };
  return dashboard.inventory.map((row) => ({
    phc_id: row.phc_id,
    phc_name: row.phc_name,
    state: row.state,
    district: row.district,
    medicine_id: row.medicine_id,
    medicine_name: row.medicine_name,
    current_stock: row.current_stock,
    predicted_daily_demand: row.predicted_daily_demand,
    days_remaining: row.days_remaining,
    risk_level: row.risk_level
  })).sort((left, right) => riskOrder[left.risk_level] - riskOrder[right.risk_level]);
}
