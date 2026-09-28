const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (err) {
  console.warn("dotenv unavailable:", err.message);
}
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { BigQuery } = require("@google-cloud/bigquery");
const { Translate } = require("@google-cloud/translate").v2;
const { PHC_DIRECTORY, ESSENTIAL_MEDICINES } = require("./data");

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (err) {
    console.warn("Firebase admin init warning:", err.message);
  }
}

// Initialize Firestore only when credentials can realistically exist:
// Initialize Firestore only when credentials can realistically exist:
//   - an explicit service-account key (GOOGLE_APPLICATION_CREDENTIALS)
//   - Cloud Functions or Cloud Run runtime (ADC is attached automatically)
//   - the Firebase Functions emulator
// Without this guard, a bare GOOGLE_CLOUD_PROJECT in .env creates a client
// whose reads stall while probing for default credentials (metadata server).
const firestoreExplicitCreds = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const runningOnCloud = process.env.FUNCTIONS_EMULATOR === "true" ||
  Boolean(process.env.GCP_PROJECT || process.env.CLOUD_FUNCTIONS_RUNTIME || process.env.K_SERVICE);
let db = null;
if (runningOnCloud || firestoreExplicitCreds) {
  try {
    db = admin.firestore();
  } catch (e) {
    console.warn("Firestore client not initialized:", e.message);
  }
} else {
  console.warn("Firestore disabled (no credentials configured); using BigQuery / in-memory store.");
}

// ---------------------------------------------------------------------------
// Configuration (all optional - every integration degrades gracefully):
//   GEMINI_API_KEY / GOOGLE_API_KEY : enables POST /explainAlert + AI translate
//   GOOGLE_CLOUD_PROJECT / BQ_DATASET : enables BigQuery-powered risk enrichment
//   GEMINI_MODEL : override the default Gemini model id
// ---------------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const BQ_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
const BQ_DATASET = process.env.BQ_DATASET || "swasthya_ai";
const BQ_LOCATION = process.env.BQ_LOCATION || "US";
const BIGQUERY_TIMEOUT_MS = Number(process.env.BIGQUERY_TIMEOUT_MS) || 12000;

// "gemini-1.5-flash" was retired; try current GA model ids in order of preference.
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest"
].filter(Boolean);

let bigQueryClient = null;
let translateClient = null;

// Language name -> BCP-47 code, used by the Google Cloud Translation API tier.
const LANGUAGE_CODES = {
  English: "en",
  Hindi: "hi",
  Marathi: "mr",
  Tamil: "ta",
  Bengali: "bn",
  Telugu: "te",
  Gujarati: "gu",
  Kannada: "kn",
  Malayalam: "ml",
  Punjabi: "pa",
  Urdu: "ur",
  Odia: "or"
};

// Curated public-health phrase book so the most-used PHC messages translate
// instantly and offline (tier 1 of POST /translate).
const MEDICAL_PHRASE_BOOK = {
  Hindi: {
    "Stockout Alert": "स्टॉक समाप्ति चेतावनी",
    "ORS Packets (Oral Rehydration)": "ओआरएस पैकेट (मौखिक रिहाइड्रेशन)",
    "Paracetamol 500mg Tablets": "पैरासिटामोल 500 मि.ग्रा. गोलियाँ",
    "Insulin Regular (100IU/ml)": "इंसुलिन रेगुलर (100 आईयू/मि.ली.)",
    "Low stock": "कम स्टॉक",
    "Restock required": "पुनः भंडारण आवश्यक",
    "Beds available": "उपलब्ध बेड",
    "Emergency transfer approved": "आपातकालीन स्थानांतरण स्वीकृत"
  },
  Marathi: {
    "Stockout Alert": "साठा संपण्याची चेतावणी",
    "ORS Packets (Oral Rehydration)": "ओआरएस पाकिटे (तोंडावाटे पुनर्जलीकरण)",
    "Paracetamol 500mg Tablets": "पॅरासिटामॉल 500 मि.ग्रॅ. गोळ्या",
    "Insulin Regular (100IU/ml)": "इन्सुलिन रेग्युलर (100 आययू/मिली)",
    "Low stock": "कमी साठा",
    "Restock required": "पुन्हा साठा आवश्यक",
    "Beds available": "उपलब्ध खाटा",
    "Emergency transfer approved": "आपत्कालीन हस्तांतरण मंजूर"
  },
  Tamil: {
    "Stockout Alert": "மருந்து பற்றாக்குறை எச்சரிக்கை",
    "ORS Packets (Oral Rehydration)": "ஓஆர்எஸ் பொட்டலங்கள் (வாய்வழி நீர்ச்சத்து)",
    "Paracetamol 500mg Tablets": "பாராசிட்டமால் 500 மி.கி மாத்திரைகள்",
    "Insulin Regular (100IU/ml)": "இன்சுலின் ரெகுலர் (100 IU/ml)",
    "Low stock": "குறைந்த இருப்பு",
    "Restock required": "மீண்டும் இருப்பு தேவை",
    "Beds available": "கிடைக்கும் படுக்கைகள்",
    "Emergency transfer approved": "அவசர மாற்றம் அனுமதிக்கப்பட்டது"
  },
  Bengali: {
    "Stockout Alert": "স্টক শেষ হওয়ার সতর্কতা",
    "ORS Packets (Oral Rehydration)": "ওআরএস প্যাকেট (মুখে স্যালাইন)",
    "Paracetamol 500mg Tablets": "প্যারাসিটামল ৫০০ মি.গ্রা. ট্যাবলেট",
    "Insulin Regular (100IU/ml)": "ইনসুলিন রেগুলার (১০০ আইইউ/মিলি)",
    "Low stock": "কম মজুদ",
    "Restock required": "পুনরায় মজুদ প্রয়োজন",
    "Beds available": "উপলব্ধ শয্যা",
    "Emergency transfer approved": "জরুরি স্থানান্তর অনুমোদিত"
  }
};


const memoryStore = {
  inventory: loadSeedInventory(),
  transfers: [],
  recommendations: []
};

/**
 * Boots the working set from the generated 120-row PHC snapshot
 * (functions/seed/current_inventory.json, produced by data/generate_data.js and
 * identical to the BigQuery `swasthya_ai.current_inventory` table).
 * Falls back to a small inline sample if the seed file is unavailable.
 */
function loadSeedInventory() {
  try {
    const seedPath = path.join(__dirname, "seed", "current_inventory.json");
    const rows = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`Loaded ${rows.length} PHC inventory records from seed file.`);
      return rows.map(row => ({
        ...row,
        timestamp: row.updated_at || row.timestamp || new Date().toISOString()
      }));
    }
  } catch (err) {
    console.warn("Seed inventory not loaded:", err.message);
  }
  return [
    { phc_id: "MH-PUNE-PHC-003", medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", current_stock: 40, daily_consumption: 22, beds_available: 3, doctors_present: 1, nurses_present: 2, patient_footfall: 110, timestamp: new Date().toISOString() },
    { phc_id: "MH-PUNE-PHC-011", medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", current_stock: 620, daily_consumption: 15, beds_available: 8, doctors_present: 3, nurses_present: 5, patient_footfall: 75, timestamp: new Date().toISOString() },
    { phc_id: "BR-PATNA-PHC-009", medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", current_stock: 35, daily_consumption: 18, beds_available: 2, doctors_present: 1, nurses_present: 2, patient_footfall: 130, timestamp: new Date().toISOString() },
    { phc_id: "TN-MDU-PHC-001", medicine_id: "INSULIN_REGULAR", medicine_name: "Insulin Regular (100IU/ml)", current_stock: 6, daily_consumption: 4, beds_available: 5, doctors_present: 2, nurses_present: 3, patient_footfall: 88, timestamp: new Date().toISOString() },
    { phc_id: "TN-MDU-PHC-005", medicine_id: "INSULIN_REGULAR", medicine_name: "Insulin Regular (100IU/ml)", current_stock: 85, daily_consumption: 3, beds_available: 7, doctors_present: 2, nurses_present: 4, patient_footfall: 65, timestamp: new Date().toISOString() }
  ];
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function findPhc(phcId, directory) {
  const list = Array.isArray(directory) && directory.length > 0 ? directory : PHC_DIRECTORY;
  return list.find(p => p.id === phcId) || {
    id: phcId,
    name: phcId,
    district: "Pune",
    state: "Maharashtra",
    lat: 18.5204,
    lng: 73.8567
  };
}

function findMedicine(medicineId, directory) {
  const list = Array.isArray(directory) && directory.length > 0 ? directory : ESSENTIAL_MEDICINES;
  return list.find(m => m.id === medicineId) || {
    id: medicineId,
    name: medicineId,
    unit: "Units",
    safetyStock: 100
  };
}

async function loadDirectories() {
  const [phcs, medicines] = await Promise.all([getPhcDirectory(), getMedicineDirectory()]);
  return {
    phcs: normalizeDirectoryRows(phcs && phcs.length > 0 ? phcs : PHC_DIRECTORY, "phc"),
    medicines: normalizeDirectoryRows(medicines && medicines.length > 0 ? medicines : ESSENTIAL_MEDICINES, "medicine")
  };
}

/**
 * Normalizes BigQuery's scalar wrappers (TIMESTAMP/DATE/INT64 can arrive as
 * { value: "..." }) into plain JSON-safe primitives, and coerces the known
 * numeric telemetry columns to real Numbers. NULL-safe for every row shape.
 */
function normalizeBigQueryRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    normalized[key] = (value && typeof value === "object" && "value" in value)
      ? value.value
      : value;
  }
  for (const key of [
    "lat", "lng", "population_served", "safety_stock", "standard_daily_consumption",
    "current_stock", "daily_consumption", "beds_available", "doctors_present",
    "nurses_present", "patient_footfall", "recommended_quantity", "distance_km",
    "estimated_transit_hours", "donor_remaining_stock", "target_extended_days",
    "forecast_daily_demand", "days_remaining", "expected_demand_14d",
    "target_extended_days_int", "lower_bound", "upper_bound", "predicted_consumption",
    "quantity"
  ]) {
    if (normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== "") {
      const numeric = Number(normalized[key]);
      if (Number.isFinite(numeric)) normalized[key] = numeric;
    }
  }
  return normalized;
}

function toBigQueryClientOptions(projectId) {
  return projectId ? { projectId } : undefined;
}

function createBigQueryClient(projectId) {
  return new BigQuery(toBigQueryClientOptions(projectId));
}

function withBigQueryTimeout(promise, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${BIGQUERY_TIMEOUT_MS}ms`)), BIGQUERY_TIMEOUT_MS);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const FIRESTORE_TIMEOUT_MS = Number(process.env.FIRESTORE_TIMEOUT_MS) || 4000;

function withFirestoreTimeout(promise) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Firestore read timed out after ${FIRESTORE_TIMEOUT_MS}ms`)), FIRESTORE_TIMEOUT_MS);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Lazy BigQuery client + one shared query helper. Never throws: on any failure
 * it records the reason and returns null so every endpoint keeps working.
 */
let bigQueryError = "";
async function runBigQuery(sql, params) {
  if (!bigQueryConfigured()) {
    bigQueryError = "BigQuery not configured (set GOOGLE_CLOUD_PROJECT or GOOGLE_APPLICATION_CREDENTIALS)";
    return null;
  }
  try {
    const projectId = resolveBigQueryProject();
    if (!bigQueryClient) bigQueryClient = createBigQueryClient(projectId);
    const [rows] = await withBigQueryTimeout(
      bigQueryClient.query({ query: sql, params, location: BQ_LOCATION }),
      "BigQuery query"
    );
    bigQueryError = "";
    return Array.isArray(rows) ? rows.map(normalizeBigQueryRow) : [];
  } catch (err) {
    bigQueryError = err.message || String(err);
    console.warn("BigQuery query skipped:", bigQueryError);
    return null;
  }
}

/**
 * Reads live inventory records. BigQuery is now the primary source:
 *   1. `swasthya_ai.current_inventory` via SELECT *
 *   2. Firestore collection (when configured and reachable)
 *   3. in-memory seed store
 * Local session changes (POST /phcUpdate applied to memoryStore) overlay on top
 * of BigQuery rows, so updates are visible instantly even while BigQuery's
 * streaming buffer converges.
 */
let firestoreHealthy = false;
let inventorySource = "memory";
let missingTableLogged = {};
const pendingOverrides = new Map();
const PENDING_OVERRIDE_TTL_MS = 15 * 60 * 1000;
let phcDirectoryCache = { at: 0, rows: null };
let medicineDirectoryCache = { at: 0, rows: null };
const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;

function directoryCacheFresh(cache) {
  return Array.isArray(cache.rows) && Date.now() - cache.at < DIRECTORY_CACHE_TTL_MS;
}

function directoryRowsOrNull(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows : null;
}

/**
 * Directory reads, BigQuery-first with the same graceful ladder as inventory:
 * `swasthya_ai.phcs` -> local seed -> [] (callers then apply their own
 * PHC_DIRECTORY safety net). Medicines follow the identical pattern.
 */
async function getPhcDirectory() {
  if (directoryCacheFresh(phcDirectoryCache)) return phcDirectoryCache.rows;
  const projectId = resolveBigQueryProject();
  const rows = projectId
    ? await runBigQuery(`SELECT * FROM \`${projectId}.${BQ_DATASET}.phcs\` ORDER BY phc_id`)
    : null;
  const live = directoryRowsOrNull(rows);
  if (live) {
    phcDirectoryCache = { at: Date.now(), rows: live };
    return live;
  }
  phcDirectoryCache = { at: Date.now(), rows: null };
  return null;
}

async function getMedicineDirectory() {
  if (directoryCacheFresh(medicineDirectoryCache)) return medicineDirectoryCache.rows;
  const projectId = resolveBigQueryProject();
  const rows = projectId
    ? await runBigQuery(`SELECT * FROM \`${projectId}.${BQ_DATASET}.medicines\` ORDER BY medicine_id`)
    : null;
  const live = directoryRowsOrNull(rows);
  if (live) {
    medicineDirectoryCache = { at: Date.now(), rows: live };
    return live;
  }
  medicineDirectoryCache = { at: Date.now(), rows: null };
  return null;
}

function normalizeDirectoryRows(rows, kind) {
  return (rows || []).map(row => {
    const normalized = { ...(row || {}) };
    if (kind === "phc") {
      normalized.id = normalized.id || normalized.phc_id;
      if (normalized.population !== undefined && normalized.population_served === undefined) {
        normalized.population_served = normalized.population;
      }
    } else {
      normalized.id = normalized.id || normalized.medicine_id;
      normalized.name = normalized.name || normalized.medicine_name;
      if (normalized.safety_stock !== undefined && normalized.safetyStock === undefined) {
        normalized.safetyStock = normalized.safety_stock;
      }
      if (normalized.unit === undefined && normalized.units !== undefined) {
        normalized.unit = normalized.units;
      }
    }
    return normalized;
  }).filter(entry => entry.id);
}

function pendingKeyFor(phcId, medicineId) {
  return `${phcId}__${medicineId}`;
}

function trackPendingUpdate(payload) {
  pendingOverrides.set(pendingKeyFor(payload.phc_id, payload.medicine_id), {
    ...payload,
    timestamp: new Date().toISOString()
  });
  for (const [key, value] of [...pendingOverrides.entries()]) {
    if (Date.now() - new Date(value.timestamp).getTime() > PENDING_OVERRIDE_TTL_MS) {
      pendingOverrides.delete(key);
    }
  }
}

function mergeSessionOverrides(records) {
  if (pendingOverrides.size === 0) return records;
  const merged = new Map(records.map(rec => [pendingKeyFor(rec.phc_id, rec.medicine_id), rec]));
  for (const [key, override] of pendingOverrides.entries()) {
    const prior = merged.get(key) || {};
    merged.set(key, { ...prior, ...override });
  }
  return [...merged.values()];
}

function mergeUniqueByKey(lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const rec of list) {
      if (rec && rec.phc_id && rec.medicine_id) {
        merged.set(pendingKeyFor(rec.phc_id, rec.medicine_id), rec);
      }
    }
  }
  return [...merged.values()];
}

async function getInventoryRecords() {
  const projectId = resolveBigQueryProject();
  let bigQueryRows = projectId
    ? await runBigQuery(`SELECT * FROM \`${projectId}.${BQ_DATASET}.current_inventory\``)
    : null;

  if (bigQueryRows && !missingTableLogged.current_inventory) {
    const keys = new Set();
    for (const row of bigQueryRows) {
      for (const key of Object.keys(row || {})) keys.add(key);
    }
    const expected = ["updated_at", "phc_id", "medicine_id", "medicine_name", "current_stock", "daily_consumption", "beds_available", "doctors_present", "nurses_present", "patient_footfall"];
    const missing = expected.filter(key => !keys.has(key));
    if (missing.length > 0) {
      missingTableLogged.current_inventory = true;
      console.warn(`BigQuery current_inventory is missing columns: ${missing.join(", ")}`);
    }
  }

  let firestoreRows = [];
  if (db) {
    try {
      const snap = await withFirestoreTimeout(db.collection("current_inventory").limit(500).get());
      if (!snap.empty) firestoreRows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      firestoreHealthy = true;
    } catch (err) {
      firestoreHealthy = false;
      console.warn("Firestore read fallback:", err.message);
    }
  }

  if (bigQueryRows && bigQueryRows.length > 0) {
    inventorySource = "bigquery";
    return mergeSessionOverrides(mergeUniqueByKey([bigQueryRows, firestoreRows]));
  }
  if (firestoreRows.length > 0) {
    inventorySource = "firestore";
    return mergeSessionOverrides(mergeUniqueByKey([firestoreRows]));
  }
  inventorySource = "memory";
  return mergeSessionOverrides(mergeUniqueByKey([memoryStore.inventory]));
}

/**
 * Optional BigQuery enrichment: reads the `stockout_risk` table produced by the
 * BigQuery ML pipeline (bigquery/queries/04_build_stockout_risk.sql).
 * Returns an empty map when BigQuery is not configured or the table is missing,
 * so the API never fails because of the analytics layer.
 */
async function getBigQueryRisk() {
  if (!BQ_PROJECT) return {};
  try {
    if (!bigQueryClient) bigQueryClient = new BigQuery({ projectId: BQ_PROJECT });
    const query = `
      SELECT phc_id, medicine_id, forecast_daily_demand, days_remaining, risk_tier
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.stockout_risk\`
      LIMIT 1000`;
    const [rows] = await bigQueryClient.query({ query, location: "US" });
    return rows.reduce((acc, row) => {
      acc[`${row.phc_id}__${row.medicine_id}`] = row;
      return acc;
    }, {});
  } catch (err) {
    console.warn("BigQuery enrichment skipped:", err.message);
    return {};
  }
}

/**
 * Resolves the BigQuery project id from env vars, or from the service-account
 * JSON referenced by GOOGLE_APPLICATION_CREDENTIALS, so telemetry writes work
 * both locally and on Cloud Functions without extra configuration.
 */
function resolveBigQueryProject() {
  if (BQ_PROJECT) return BQ_PROJECT;
  const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credFile) {
    try {
      const cred = JSON.parse(fs.readFileSync(credFile, "utf8"));
      if (cred.project_id) return cred.project_id;
    } catch (err) {
      console.warn("Could not read credentials file for project id:", err.message);
    }
  }
  return "";
}

function bigQueryConfigured() {
  return Boolean(
    BQ_PROJECT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT
  );
}

/**
 * Writes a PHC telemetry row to BigQuery.
 *   1. `current_inventory`  - snapshot UPSERT (delete + insert for that
 *      phc_id/medicine_id) so the table keeps exactly one current row per pair.
 *   2. `inventory_history`  - best-effort append (feeds the ARIMA_PLUS training
 *      table); a missing history table must never fail the API call.
 * Never throws - returns a status object the endpoint reports back to the UI.
 */
async function insertTelemetryToBigQuery(payload) {
  if (!bigQueryConfigured()) {
    return {
      inserted: false,
      reason: "BigQuery not configured (set GOOGLE_CLOUD_PROJECT or GOOGLE_APPLICATION_CREDENTIALS)"
    };
  }

  const projectId = resolveBigQueryProject();
  const now = payload.timestamp || new Date().toISOString();
  // Named params here must match the @placeholders in the SQL exactly.
  const historyRow = {
    phc_id: payload.phc_id,
    medicine_id: payload.medicine_id,
    medicine_name: payload.medicine_name,
    daily_consumption: payload.daily_consumption,
    current_stock: payload.current_stock,
    patient_footfall: payload.patient_footfall
  };
  const snapshotRow = {
    updated_at: now,
    phc_id: payload.phc_id,
    medicine_id: payload.medicine_id,
    medicine_name: payload.medicine_name,
    current_stock: payload.current_stock,
    daily_consumption: payload.daily_consumption,
    beds_available: payload.beds_available,
    doctors_present: payload.doctors_present,
    nurses_present: payload.nurses_present,
    patient_footfall: payload.patient_footfall
  };

  try {
    if (!bigQueryClient) bigQueryClient = projectId ? new BigQuery({ projectId }) : new BigQuery();

    const currentTable = `\`${projectId}.${BQ_DATASET}.current_inventory\``;
    const upsertSql = `
      DELETE FROM ${currentTable}
      WHERE phc_id = @phc_id AND medicine_id = @medicine_id;
      INSERT INTO ${currentTable}
        (updated_at, phc_id, medicine_id, medicine_name, current_stock, daily_consumption,
         beds_available, doctors_present, nurses_present, patient_footfall)
      VALUES
        (TIMESTAMP(@updated_at), @phc_id, @medicine_id, @medicine_name, @current_stock,
         @daily_consumption, @beds_available, @doctors_present, @nurses_present, @patient_footfall);`;

    await bigQueryClient.query({
      query: upsertSql,
      params: snapshotRow,
      location: BQ_LOCATION
    });

    // Best-effort: keep the model training table in sync with the same day's row.
    let historyInserted = false;
    let historyError = null;
    try {
      const historySql = `
        INSERT INTO \`${projectId}.${BQ_DATASET}.inventory_history\`
          (date, phc_id, medicine_id, medicine_name, daily_consumption, current_stock, patient_footfall)
        VALUES
          (CURRENT_DATE(), @phc_id, @medicine_id, @medicine_name, @daily_consumption,
           @current_stock, @patient_footfall);`;
      await bigQueryClient.query({
        query: historySql,
        params: historyRow,
        location: BQ_LOCATION
      });
      historyInserted = true;
    } catch (err) {
      historyError = err.message;
      console.warn("BigQuery history append skipped:", err.message);
    }

    return {
      inserted: true,
      history_inserted: historyInserted,
      project: projectId,
      dataset: BQ_DATASET,
      table: `${projectId}.${BQ_DATASET}.current_inventory`,
      ...(historyError ? { history_error: historyError } : {})
    };
  } catch (err) {
    // Fallback: streaming insert (works when the service account can insert but
    // cannot run DML, e.g. read-only/BI permissions).
    try {
      if (!bigQueryClient) bigQueryClient = projectId ? new BigQuery({ projectId }) : new BigQuery();
      const table = bigQueryClient.dataset(BQ_DATASET).table("current_inventory");
      await table.insert(snapshotRow);
      return {
        inserted: true,
        history_inserted: false,
        mode: "stream_insert",
        project: projectId,
        dataset: BQ_DATASET,
        table: `${projectId}.${BQ_DATASET}.current_inventory`
      };
    } catch (fallbackErr) {
      return {
        inserted: false,
        reason: `${err.message} | fallback: ${fallbackErr.message}`
      };
    }
  }
}

/**
 * Upserts one recommendation/proposal row into `swasthya_ai.recommendations`.
 * Column list mirrors the live table exactly (13 columns).
 * Never throws - returns { inserted, reason }.
 */
async function writeRecommendationToBigQuery(recommendation) {
  if (!bigQueryConfigured()) {
    return { inserted: false, reason: "BigQuery not configured" };
  }
  const projectId = resolveBigQueryProject();
  if (!projectId) {
    return { inserted: false, reason: "BigQuery project id could not be resolved" };
  }
  try {
    if (!bigQueryClient) bigQueryClient = createBigQueryClient(projectId);
    const columns = "(recommendation_id, alert_id, target_phc_id, donor_phc_id, medicine_id, medicine_name, " +
      "recommended_quantity, distance_km, estimated_transit_hours, donor_remaining_stock, " +
      "target_extended_days, status, created_at)";
    const params = {
      recommendation_id: recommendation.recommendation_id,
      alert_id: null,
      target_phc_id: recommendation.shortage_phc || recommendation.destination_phc_id || null,
      donor_phc_id: recommendation.recommended_source || recommendation.source_phc_id || null,
      medicine_id: recommendation.medicine_id,
      medicine_name: recommendation.medicine,
      recommended_quantity: Number(recommendation.recommended_transfer) || 0,
      distance_km: Number(recommendation.distance_km) || 0,
      estimated_transit_hours: Number(recommendation.estimated_transit_hours) || 0,
      donor_remaining_stock: Number(recommendation.donor_remaining_stock) || 0,
      target_extended_days: Number(recommendation.estimated_coverage_days) || 0,
      status: recommendation.status || "PROPOSED",
      created_at: recommendation.created_at || new Date().toISOString()
    };
    await bigQueryClient.query({
      query: `
        DELETE FROM \`${projectId}.${BQ_DATASET}.recommendations\`
        WHERE recommendation_id = @recommendation_id;
        INSERT INTO \`${projectId}.${BQ_DATASET}.recommendations\` ${columns}
        VALUES (
          @recommendation_id, @alert_id, @target_phc_id, @donor_phc_id, @medicine_id, @medicine_name,
          @recommended_quantity, @distance_km, @estimated_transit_hours, @donor_remaining_stock,
          @target_extended_days, @status, TIMESTAMP(@created_at)
        );`,
      params,
      // BigQuery cannot infer the type of NULL parameters, so every parameter
      // must be declared explicitly (matches the live table schema).
      types: {
        recommendation_id: "STRING",
        alert_id: "STRING",
        target_phc_id: "STRING",
        donor_phc_id: "STRING",
        medicine_id: "STRING",
        medicine_name: "STRING",
        recommended_quantity: "INT64",
        distance_km: "FLOAT64",
        estimated_transit_hours: "FLOAT64",
        donor_remaining_stock: "INT64",
        target_extended_days: "FLOAT64",
        status: "STRING",
        created_at: "STRING"
      },
      location: BQ_LOCATION
    });
    return { inserted: true, table: `${projectId}.${BQ_DATASET}.recommendations` };
  } catch (err) {
    return { inserted: false, reason: err.message || String(err) };
  }
}

/** Calls Gemini, trying each configured model id until one responds. */
async function askGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("No Gemini API key configured (set GEMINI_API_KEY)");
  }
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  let lastError = null;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return { text: result.response.text(), model: modelName };
    } catch (err) {
      lastError = err;
      console.warn(`Gemini model ${modelName} unavailable:`, err.message);
    }
  }
  throw lastError || new Error("Gemini request failed");
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "SwasthyaSetu AI API",
    version: "1.0.0",
    data_source: {
      bigquery_configured: bigQueryConfigured(),
      inventory_source: inventorySource,
      bigquery_error: bigQueryError || null,
      firestore_configured: Boolean(db),
      firestore_healthy: firestoreHealthy
    }
  });
});

app.get("/meta", async (req, res) => {
  try {
    const directories = await loadDirectories();
    res.json({
      phcs: directories.phcs,
      medicines: directories.medicines,
      directory_source: {
        bigquery: Boolean(directoryCacheFresh(phcDirectoryCache) || directoryCacheFresh(medicineDirectoryCache)),
        legend: "bigquery indicates at least one directory table was served live from BigQuery"
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /dashboard
app.get("/dashboard", async (req, res) => {
  try {
    const directories = await loadDirectories();
    const phcs = directories.phcs;
    const records = await getInventoryRecords();
    const bqRisk = await getBigQueryRisk();

    let criticalCount = 0;
    let warningCount = 0;
    let totalBeds = 0;
    let totalDoctors = 0;
    let totalNurses = 0;
    let totalFootfall = 0;
    let staffShortages = 0;
    let forecastDriven = 0;

    const enriched = records.map(item => {
      const consumption = Number(item.daily_consumption) || 1;
      const stock = Number(item.current_stock) || 0;
      const daysRemaining = round1(stock / consumption);

      const phcMeta = findPhc(item.phc_id, phcs);
      const bq = bqRisk[pendingKeyFor(item.phc_id, item.medicine_id)] || null;

      // Prefer the BigQuery ML forecast when the analytics table is available.
      let riskLevel = "STABLE";
      let effectiveDays = daysRemaining;
      if (bq && bq.days_remaining != null) {
        effectiveDays = round1(bq.days_remaining);
        riskLevel = bq.risk_tier || riskLevel;
        forecastDriven++;
      }
      if (riskLevel === "CRITICAL" || riskLevel === "STOCKED_OUT" || effectiveDays <= 3) {
        if (riskLevel === "STABLE" || riskLevel === "MEDIUM") riskLevel = "CRITICAL";
        criticalCount++;
      } else if (["HIGH", "WARNING"].includes(riskLevel) || effectiveDays <= 7) {
        if (riskLevel === "STABLE") riskLevel = "WARNING";
        warningCount++;
      }

      totalBeds += Number(item.beds_available) || 0;
      totalDoctors += Number(item.doctors_present) || 0;
      totalNurses += Number(item.nurses_present) || 0;
      totalFootfall += Number(item.patient_footfall) || 0;
      if (Number(item.doctors_present) === 0) staffShortages++;

      return {
        ...item,
        days_remaining: daysRemaining,
        forecast_days_remaining: bq && bq.days_remaining != null ? round1(bq.days_remaining) : null,
        forecast_daily_demand: bq ? Number(bq.forecast_daily_demand) || null : null,
        risk_level: riskLevel,
        phc_name: phcMeta.name,
        district: phcMeta.district,
        state: phcMeta.state,
        lat: phcMeta.lat,
        lng: phcMeta.lng
      };
    });

    const monitoredPhcs = new Set(records.map(r => r.phc_id)).size;

    res.json({
      summary: {
        total_phcs_monitored: monitoredPhcs || phcs.length,
        total_phc_directory: phcs.length,
        total_medicine_records: enriched.length,
        critical_stockouts: criticalCount,
        potential_stockouts_7d: warningCount,
        beds_available: totalBeds,
        doctors_on_duty: totalDoctors,
        nurses_on_duty: totalNurses,
        patient_footfall_today: totalFootfall,
        facility_staff_shortages: staffShortages,
        approved_transfers: memoryStore.transfers.length,
        records_scored_by_bigquery_ml: forecastDriven,
        data_source: {
          bigquery: inventorySource === "bigquery",
          firestore: firestoreHealthy,
          bigquery_forecast: forecastDriven > 0,
          inventory_source: inventorySource,
          memory_fallback: inventorySource === "memory"
        }
      },
      inventory: enriched
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /phcUpdate
app.post("/phcUpdate", async (req, res) => {
  try {
    const {
      phc_id,
      medicine_id,
      medicine_name,
      current_stock,
      daily_consumption,
      beds_available,
      doctors_present,
      nurses_present,
      patient_footfall,
      notes
    } = req.body;

    if (!phc_id || !medicine_id) {
      return res.status(400).json({ error: "Missing required fields: phc_id and medicine_id" });
    }

    const payload = {
      phc_id,
      medicine_id,
      medicine_name: medicine_name || medicine_id,
      current_stock: Number(current_stock) || 0,
      daily_consumption: Number(daily_consumption) || 0,
      beds_available: Number(beds_available) || 0,
      doctors_present: Number(doctors_present) || 0,
      nurses_present: Number(nurses_present) || 0,
      patient_footfall: Number(patient_footfall) || 0,
      notes: notes || "",
      timestamp: new Date().toISOString()
    };

    const idx = memoryStore.inventory.findIndex(
      item => item.phc_id === phc_id && item.medicine_id === medicine_id
    );
    if (idx >= 0) {
      memoryStore.inventory[idx] = { ...memoryStore.inventory[idx], ...payload };
    } else {
      memoryStore.inventory.unshift(payload);
    }
    trackPendingUpdate(payload);

    let firestoreSaved = false;
    if (db) {
      try {
        const docId = `${phc_id}_${medicine_id}`;
        await db.collection("current_inventory").doc(docId).set(payload, { merge: true });
        await db.collection("inventory_history").add(payload);
        firestoreSaved = true;
      } catch (err) {
        console.warn("Firestore save warning:", err.message);
      }
    }

    // 3. BigQuery: snapshot upsert into `swasthya_ai.current_inventory`
    //    (+ best-effort append into `inventory_history` for the ML pipeline).
    const bigqueryResult = await insertTelemetryToBigQuery(payload);

    const safetyStock = findMedicine(payload.medicine_id, (await loadDirectories()).medicines).safetyStock;

    const stores = [];
    if (firestoreSaved) stores.push("Firestore");
    if (bigqueryResult.inserted) stores.push(`BigQuery.${bigqueryResult.table || `${BQ_DATASET}.current_inventory`}`);

    // Be explicit about *why* nothing durable was written, instead of implying
    // no datastore was configured (e.g. BigQuery rejects writes when project
    // billing is disabled, even though reads work fine).
    let message;
    if (stores.length > 0) {
      message = `PHC update recorded in ${stores.join(" + ")}`;
    } else if (bigQueryConfigured() || db) {
      message = `PHC update kept in local session only; persistent write rejected (${bigqueryResult.reason || bigQueryError || "datastore permissions"})`;
    } else {
      message = "PHC update recorded in local session (no datastore configured)";
    }

    res.status(200).json({
      success: true,
      message,
      saved_to_firestore: firestoreSaved,
      bigquery_inserted: bigqueryResult.inserted,
      bigquery: bigqueryResult,
      live_risk_preview: {
        days_remaining: round1((payload.current_stock) / (payload.daily_consumption || 1)),
        risk_level: payload.current_stock / (payload.daily_consumption || 1) <= 3
          ? "CRITICAL"
          : (payload.current_stock / (payload.daily_consumption || 1) <= 7 ? "WARNING" : "STABLE"),
        safety_stock: safetyStock,
        below_safety_stock: payload.current_stock < safetyStock
      },
      record: payload
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /alerts  (stock-out, bed-capacity and staffing alerts, ranked by severity)
app.get("/alerts", async (req, res) => {
  try {
    const directories = await loadDirectories();
    const phcs = directories.phcs;
    const medicines = directories.medicines;
    const records = await getInventoryRecords();
    const alerts = [];
    const severityRank = { CRITICAL: 0, HIGH: 1, WARNING: 2 };

    records.forEach(item => {
      const consumption = Number(item.daily_consumption) || 1;
      const stock = Number(item.current_stock) || 0;
      const daysRemaining = round1(stock / consumption);
      const phcMeta = findPhc(item.phc_id, phcs);
      const medMeta = findMedicine(item.medicine_id, medicines);

      if (daysRemaining <= 3) {
        alerts.push({
          id: `ALERT-MED-${item.phc_id}-${item.medicine_id}`,
          type: "STOCKOUT_CRITICAL",
          severity: "CRITICAL",
          phc_id: item.phc_id,
          phc_name: phcMeta.name,
          district: phcMeta.district,
          state: phcMeta.state,
          lat: phcMeta.lat,
          lng: phcMeta.lng,
          medicine_id: item.medicine_id,
          medicine_name: item.medicine_name || medMeta.name,
          current_stock: stock,
          daily_consumption: consumption,
          days_remaining: daysRemaining,
          recommended_action: "Trigger inter-facility redistribution (POST /recommendation)",
          message: `${item.medicine_name || medMeta.name} will run out in ${daysRemaining} days at ${phcMeta.name} (${stock} units left). Immediate redistribution recommended.`
        });
      } else if (daysRemaining <= 7) {
        alerts.push({
          id: `ALERT-MED-${item.phc_id}-${item.medicine_id}`,
          type: "STOCKOUT_WARNING",
          severity: "WARNING",
          phc_id: item.phc_id,
          phc_name: phcMeta.name,
          district: phcMeta.district,
          state: phcMeta.state,
          lat: phcMeta.lat,
          lng: phcMeta.lng,
          medicine_id: item.medicine_id,
          medicine_name: item.medicine_name || medMeta.name,
          current_stock: stock,
          daily_consumption: consumption,
          days_remaining: daysRemaining,
          recommended_action: "Schedule replenishment within the weekly indent",
          message: `${item.medicine_name || medMeta.name} running low at ${phcMeta.name}: ${daysRemaining} days of stock remaining.`
        });
      }

      if (Number(item.beds_available) <= 2) {
        alerts.push({
          id: `ALERT-BED-${item.phc_id}`,
          type: "BED_CAPACITY_CRITICAL",
          severity: "HIGH",
          phc_id: item.phc_id,
          phc_name: phcMeta.name,
          district: phcMeta.district,
          state: phcMeta.state,
          lat: phcMeta.lat,
          lng: phcMeta.lng,
          beds_available: Number(item.beds_available) || 0,
          patient_footfall: Number(item.patient_footfall) || 0,
          recommended_action: "Refer overflow cases to the nearest CHC / district hospital",
          message: `Only ${item.beds_available} beds available at ${phcMeta.name}. Footfall is ${item.patient_footfall} patients/day.`
        });
      }

      // Staffing surge: no doctor on duty, or an unusually high patient load
      // per available doctor.
      const doctors = Number(item.doctors_present) || 0;
      const nurses = Number(item.nurses_present) || 0;
      const footfall = Number(item.patient_footfall) || 0;
      const patientsPerDoctor = doctors > 0 ? Math.round(footfall / doctors) : null;

      if (doctors === 0 || nurses === 0 || (patientsPerDoctor && patientsPerDoctor > 80)) {
        alerts.push({
          id: `ALERT-STAFF-${item.phc_id}`,
          type: "STAFF_SURGE",
          severity: doctors === 0 ? "CRITICAL" : "HIGH",
          phc_id: item.phc_id,
          phc_name: phcMeta.name,
          district: phcMeta.district,
          state: phcMeta.state,
          lat: phcMeta.lat,
          lng: phcMeta.lng,
          doctors_present: doctors,
          nurses_present: nurses,
          patient_footfall: footfall,
          patients_per_doctor: patientsPerDoctor,
          recommended_action: "Deploy district mobile health unit / on-call medical officer",
          message: doctors === 0
            ? `No doctor on duty at ${phcMeta.name} with ${footfall} patients/day reported.`
            : `High patient load at ${phcMeta.name}: ${patientsPerDoctor} patients per doctor (${footfall} patients, ${doctors} doctors).`
        });
      }
    });

    alerts.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

    res.json({
      total_alerts: alerts.length,
      inventory_source: inventorySource,
      by_severity: {
        CRITICAL: alerts.filter(a => a.severity === "CRITICAL").length,
        HIGH: alerts.filter(a => a.severity === "HIGH").length,
        WARNING: alerts.filter(a => a.severity === "WARNING").length
      },
      by_type: alerts.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {}),
      alerts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /recommendation
// Matches a deficit facility with the best surplus donor (same district first,
// then shortest Haversine distance) while preserving donor safety stock.
app.post("/recommendation", async (req, res) => {
  try {
    const { phc_id, medicine_id } = req.body || {};
    const directories = await loadDirectories();
    const phcs = directories.phcs;
    const medicines = directories.medicines;
    const records = await getInventoryRecords();

    const target = records.find(
      i => (!phc_id || i.phc_id === phc_id) && (!medicine_id || i.medicine_id === medicine_id)
    ) || records[0];

    if (!target) {
      return res.status(404).json({ error: "No inventory record found for recommendation" });
    }

    const targetPhcMeta = findPhc(target.phc_id, phcs);
    const medMeta = findMedicine(target.medicine_id, medicines);

    const targetDailyNeed = Number(target.daily_consumption) || 20;
    const deficitQuantity = Math.max(0, (targetDailyNeed * 10) - Number(target.current_stock));

    const donors = records
      .filter(item => item.medicine_id === target.medicine_id && item.phc_id !== target.phc_id)
      .map(item => {
        const donorMeta = findPhc(item.phc_id, phcs);
        const donorSafetyStock = (findMedicine(item.medicine_id, medicines).safetyStock) || medMeta.safetyStock;
        const surplus = Math.max(0, Number(item.current_stock) - donorSafetyStock);
        return {
          source_phc_id: item.phc_id,
          source_phc_name: donorMeta.name,
          source_district: donorMeta.district,
          source_state: donorMeta.state,
          source_current_stock: Number(item.current_stock) || 0,
          source_safety_stock: donorSafetyStock,
          source_surplus: surplus,
          distance_km: calculateDistanceKm(targetPhcMeta.lat, targetPhcMeta.lng, donorMeta.lat, donorMeta.lng),
          same_district: donorMeta.district === targetPhcMeta.district
        };
      })
      .filter(d => d.source_surplus > 0)
      .sort((a, b) => {
        if (a.same_district && !b.same_district) return -1;
        if (!a.same_district && b.same_district) return 1;
        return a.distance_km - b.distance_km;
      });

    if (donors.length === 0) {
      return res.json({
        recommended: false,
        shortage_phc: target.phc_id,
        shortage_phc_name: targetPhcMeta.name,
        medicine_id: target.medicine_id,
        message: "No neighboring PHC currently has sufficient surplus above safety threshold. Direct district warehouse re-supply needed.",
        evaluated_donors: 0,
        inventory_source: inventorySource
      });
    }

    const optimalSource = donors[0];
    const transferQty = Math.min(deficitQuantity > 0 ? deficitQuantity : 250, optimalSource.source_surplus);
    const estimatedTransitHours = Math.max(1, Math.round((optimalSource.distance_km / 35) * 10) / 10);

    const recommendation = {
      recommendation_id: `REC-${Date.now()}`,
      recommended: true,
      shortage_phc: target.phc_id,
      shortage_phc_name: targetPhcMeta.name,
      destination_district: targetPhcMeta.district,
      destination_state: targetPhcMeta.state,
      destination_phc_id: target.phc_id,
      medicine: target.medicine_name || medMeta.name,
      medicine_id: target.medicine_id,
      current_stock: Number(target.current_stock) || 0,
      daily_consumption: targetDailyNeed,
      days_remaining: round1((Number(target.current_stock) || 0) / targetDailyNeed),
      required_quantity: deficitQuantity || 250,
      recommended_source: optimalSource.source_phc_id,
      source_phc_id: optimalSource.source_phc_id,
      source_phc_name: optimalSource.source_phc_name,
      source_district: optimalSource.source_district,
      source_current_stock: optimalSource.source_current_stock,
      source_surplus: optimalSource.source_surplus,
      distance_km: optimalSource.distance_km,
      same_district: optimalSource.same_district,
      estimated_transit_hours: estimatedTransitHours,
      recommended_transfer: transferQty,
      estimated_coverage_days: Math.round(transferQty / (targetDailyNeed || 1)),
      donor_remaining_stock: optimalSource.source_current_stock - transferQty,
      alternative_donors: donors.slice(1, 4).map(d => ({
        source_phc_id: d.source_phc_id,
        source_phc_name: d.source_phc_name,
        distance_km: d.distance_km,
        source_surplus: d.source_surplus
      })),
      status: "PROPOSED",
      created_at: new Date().toISOString(),
      rationale: `Optimal transfer of ${transferQty} units from ${optimalSource.source_phc_name} (${optimalSource.distance_km} km away in ${optimalSource.source_district}) covers ${targetPhcMeta.name} for ~${Math.round(transferQty / targetDailyNeed)} days while keeping the donor above its ${optimalSource.source_safety_stock}-unit safety stock.`
    };

    // Persist the proposal so POST /approveTransfer can link back to it.
    memoryStore.recommendations.unshift(recommendation);
    let firestoreSaved = false;
    const recommendationWrites = [];
    if (db) {
      recommendationWrites.push(
        db.collection("recommendations").doc(recommendation.recommendation_id).set(recommendation)
          .then(() => { firestoreSaved = true; })
          .catch(err => console.warn("Recommendation persist warning:", err.message))
      );
    }
    recommendationWrites.push(
      writeRecommendationToBigQuery(recommendation)
        .catch(err => ({ inserted: false, reason: err.message }))
    );
    const recommendationWriteResults = await Promise.all(recommendationWrites);
    const bigqueryWrite = recommendationWriteResults.find(r => r && typeof r.inserted === "boolean") || null;

    res.json({
      ...recommendation,
      saved_to_firestore: firestoreSaved,
      saved_to_bigquery: Boolean(bigqueryWrite && bigqueryWrite.inserted),
      inventory_source: inventorySource
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /approveTransfer
// Approves a recommended redistribution: persists the dispatch order and moves
// the stock so the deficit facility is actually replenished (closes the loop).
app.post("/approveTransfer", async (req, res) => {
  try {
    const body = req.body || {};
    // Accept both the /recommendation response keys and generic naming.
    const sourcePhcId = body.source_phc_id || body.recommended_source || body.source_phc;
    const destinationPhcId = body.destination_phc_id || body.shortage_phc || body.target_phc_id;
    const medicineId = body.medicine_id || body.medicine;
    const quantity = Number(body.quantity || body.recommended_transfer || 100);

    if (!sourcePhcId || !destinationPhcId || !medicineId) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["source_phc_id", "destination_phc_id", "medicine_id"],
        received: { sourcePhcId, destinationPhcId, medicineId }
      });
    }

    const directories = await loadDirectories();
    const sourceMeta = findPhc(sourcePhcId, directories.phcs);
    const destinationMeta = findPhc(destinationPhcId, directories.phcs);
    const quantityFinal = Number.isFinite(quantity) && quantity > 0 ? quantity : 100;

    const transferRecord = {
      transfer_id: `TRF-${Date.now()}`,
      recommendation_id: body.recommendation_id || null,
      source_phc_id: sourcePhcId,
      source_phc_name: sourceMeta.name,
      destination_phc_id: destinationPhcId,
      destination_phc_name: destinationMeta.name,
      district: destinationMeta.district,
      state: destinationMeta.state,
      medicine_id: medicineId,
      quantity: quantityFinal,
      distance_km: calculateDistanceKm(sourceMeta.lat, sourceMeta.lng, destinationMeta.lat, destinationMeta.lng),
      approved_by: body.approved_by || "District Health Officer",
      priority: body.priority || "HIGH",
      vehicle_dispatch_id: `DL-MED-${Math.floor(1000 + Math.random() * 9000)}`,
      status: "APPROVED_IN_TRANSIT",
      timestamp: new Date().toISOString()
    };

    // 1. Resolve both sides from the live ladder (BigQuery -> Firestore ->
    //    memory), because memoryStore alone does not contain BigQuery rows.
    const liveRecords = await getInventoryRecords();
    const findLive = (phcId) => liveRecords.find(i => i.phc_id === phcId && i.medicine_id === medicineId);

    const upsertWorkingRecord = (base) => {
      const record = { ...base };
      const idx = memoryStore.inventory.findIndex(
        i => i.phc_id === record.phc_id && i.medicine_id === record.medicine_id
      );
      if (idx >= 0) memoryStore.inventory[idx] = { ...memoryStore.inventory[idx], ...record };
      else memoryStore.inventory.unshift(record);
      return record;
    };

    const buildSide = (phcId) => {
      const live = findLive(phcId);
      if (live) return upsertWorkingRecord(live);
      // Only invent a zero-stock row when there is a real row somewhere upstream;
      // unknown facilities stay null so the caller reports "no record moved".
      const existsSomewhere = liveRecords.some(i => i.phc_id === phcId) || Boolean(memoryStore.inventory.find(i => i.phc_id === phcId));
      if (!existsSomewhere) return null;
      const medMeta = findMedicine(medicineId, directories.medicines);
      return upsertWorkingRecord({
        phc_id: phcId,
        medicine_id: medicineId,
        medicine_name: medMeta.name || medicineId,
        current_stock: 0,
        daily_consumption: 0,
        beds_available: 0,
        doctors_present: 0,
        nurses_present: 0,
        patient_footfall: 0
      });
    };

    const sourceRec = buildSide(sourcePhcId);
    const destRec = buildSide(destinationPhcId);

    const sourceBefore = sourceRec ? Number(sourceRec.current_stock) || 0 : null;
    const destBefore = destRec ? Number(destRec.current_stock) || 0 : null;

    if (sourceRec) sourceRec.current_stock = Math.max(0, (Number(sourceRec.current_stock) || 0) - quantityFinal);
    if (destRec) destRec.current_stock = (Number(destRec.current_stock) || 0) + quantityFinal;

    // Session overlay so BigQuery-sourced dashboards show the move instantly.
    if (sourceRec) trackPendingUpdate(sourceRec);
    if (destRec) trackPendingUpdate(destRec);

    memoryStore.transfers.unshift(transferRecord);

    // 2. Persist to BigQuery: new snapshot for both facilities. The session
    //    overlay is intentionally kept (15m TTL) until BigQuery's streaming
    //    buffer converges, mirroring POST /phcUpdate behaviour.
    const bigqueryResults = await Promise.all([
      sourceRec ? insertTelemetryToBigQuery(sourceRec).catch(err => ({ inserted: false, reason: err.message })) : Promise.resolve(null),
      destRec ? insertTelemetryToBigQuery(destRec).catch(err => ({ inserted: false, reason: err.message })) : Promise.resolve(null)
    ]);
    const bigquerySaved = bigqueryResults.filter(Boolean).some(r => r && r.inserted);

    // 3. Persist to Firestore (dispatch log + adjusted stock balances).
    let firestoreSaved = false;
    if (db) {
      try {
        await db.collection("transfers").doc(transferRecord.transfer_id).set(transferRecord);
        if (sourceRec) {
          await db.collection("current_inventory").doc(`${sourcePhcId}_${medicineId}`)
            .set({ ...sourceRec, current_stock: sourceRec.current_stock }, { merge: true });
        }
        if (destRec) {
          await db.collection("current_inventory").doc(`${destinationPhcId}_${medicineId}`)
            .set({ ...destRec, current_stock: destRec.current_stock }, { merge: true });
        }
        if (transferRecord.recommendation_id) {
          await db.collection("recommendations").doc(transferRecord.recommendation_id)
            .set({ status: "APPROVED", approved_at: transferRecord.timestamp, transfer_id: transferRecord.transfer_id }, { merge: true });
        }
        firestoreSaved = true;
      } catch (err) {
        console.warn("Transfer persist warning:", err.message);
      }
    }

    res.json({
      success: true,
      message: "Transfer order approved and dispatched into state logistics network.",
      saved_to_firestore: firestoreSaved,
      saved_to_bigquery: bigquerySaved,
      inventory_source: inventorySource,
      stock_movement: {
        source_phc_id: sourcePhcId,
        destination_phc_id: destinationPhcId,
        source_stock_before: sourceBefore,
        source_stock_after: sourceRec ? sourceRec.current_stock : null,
        destination_stock_before: destBefore,
        destination_stock_after: destRec ? destRec.current_stock : null
      },
      transfer: transferRecord
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /explainAlert
app.post("/explainAlert", async (req, res) => {
  try {
    const { alertData, language = "English" } = req.body || {};

    if (GEMINI_API_KEY) {
      try {
        const prompt = `
You are an AI assistant for a District Health Officer in India.
Analyze this health resource alert data:
${JSON.stringify(alertData, null, 2)}
Output valid JSON with keys:
- "explanation": Crisp 2-sentence diagnostic of the stockout risk.
- "root_cause": Likely cause (outbreak surge, supply delay, cold-chain, staffing).
- "action_recommendation": Concrete supply chain redistribution action.
- "phc_sms_message": Short SMS/WhatsApp dispatch note for the PHC Medical Officer.
- "local_language_message": The same note translated into ${language}.
- "urgency": One of CRITICAL, HIGH, MEDIUM, LOW.
Return ONLY the JSON object, no markdown fences.`;
        const { text, model } = await askGemini(prompt);
        const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
        return res.json({ source: `Google Gemini (${model})`, ...JSON.parse(cleaned) });
      } catch (geminiError) {
        console.warn("Gemini call fallback:", geminiError.message);
      }
    }

    const phcName = alertData?.phc_name || alertData?.phc_id || "Baramati PHC";
    const medName = alertData?.medicine_name || alertData?.medicine_id || "ORS Packets";
    const days = alertData?.days_remaining || 2;
    const footfall = alertData?.patient_footfall || 110;

    const fallbackTranslations = {
      Hindi: `कृपया कल सुबह तक निकटतम उप-जिला डिपो से आवश्यक आपूर्ति प्राप्त करने की तैयारी करें। वर्तमान स्टॉक केवल ${days} दिन चलेगा।`,
      Tamil: `தயவுசெய்து நாளைய தினத்திற்குள் அருகிலுள்ள சுகாதார மையத்திலிருந்து மருந்து இருப்பை பெற ஏற்பாடு செய்யுங்கள். இருப்பு ${days} நாட்களில் தீர்ந்துவிடும்.`,
      Marathi: `कृपया उद्यापर्यंत जवळच्या उप-जिल्हा केंद्रातून आवश्यक साठा प्राप्त करण्याची तयारी ठेवा. चालू साठा केवळ ${days} दिवस पुरेल.`,
      Bengali: `অনুগ্রহ করে আগামীকালের মধ্যে নিকটস্থ কেন্দ্র থেকে প্রয়োজনীয় ওষুধ সরবরাহের প্রস্তুতি নিন। বর্তমান মজুদ মাত্র ${days} দিন চলবে।`
    };

    res.json({
      source: "SwasthyaSetu AI Engine",
      explanation: `${phcName} is facing a severe deficit of ${medName} with only ${days} days of inventory remaining amidst high patient footfall (${footfall} patients/day).`,
      action_recommendation: `Initiate automated cross-district transfer of 250-300 units from nearby surplus depot to prevent complete stockout.`,
      phc_sms_message: `URGENT: Stockout alert for ${medName} at ${phcName}. Buffer replenishment dispatched. Current stock expected to deplete in ${days} days.`,
      local_language_message: fallbackTranslations[language] || fallbackTranslations.Hindi,
      urgency: days <= 3 ? "CRITICAL" : "HIGH"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /translate
// 4-tier healthcare translation so the endpoint can never fail:
//   1. curated medical phrase book (offline, instant)
//   2. Google Cloud Translation API (@google-cloud/translate)
//   3. Gemini AI
//   4. passthrough tagged with the target language
app.post("/translate", async (req, res) => {
  try {
    const { text, targetLanguage = "Hindi", target = "" } = req.body || {};

    if (!text) {
      return res.status(400).json({ error: "Missing required field: text" });
    }

    const language = targetLanguage || target;
    const dict = {
      Hindi: { "SwasthyaSetu AI": "स्वास्थ्यसेतु एआई", "National PHC Grid": "राष्ट्रीय प्राथमिक स्वास्थ्य केंद्र ग्रिड", "Stockout Alert": "स्टॉक समाप्ति चेतावनी" },
      Tamil: { "SwasthyaSetu AI": "சுவஸ்த்யா சேது ஏஐ", "National PHC Grid": "தேசிய ஆரம்ப சுகாதார கட்டமைப்பு", "Stockout Alert": "மருந்து பற்றாக்குறை எச்சரிக்கை" },
      Marathi: { "SwasthyaSetu AI": "स्वास्थ्यसेतू एआय", "National PHC Grid": "राष्ट्रीय प्राथमिक आरोग्य केंद्र ग्रिड", "Stockout Alert": "साठा संपण्याची चेतावणी" }
    };
    // Tier 1: curated phrase book (new book first, then the legacy mini-dict)
    const phrase = (MEDICAL_PHRASE_BOOK[language] && MEDICAL_PHRASE_BOOK[language][text]) ||
      (dict[language] && dict[language][text]);
    if (phrase) {
      return res.json({
        original: text,
        targetLanguage: language,
        translated: phrase,
        source: "SwasthyaSetu medical phrase book"
      });
    }

    // Tier 2: Google Cloud Translation API
    const languageCode = LANGUAGE_CODES[language];
    if (languageCode && (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT)) {
      try {
        if (!translateClient) translateClient = new Translate();
        const [cloudTranslation] = await translateClient.translate(text, languageCode);
        return res.json({
          original: text,
          targetLanguage: language,
          targetLanguageCode: languageCode,
          translated: cloudTranslation,
          source: "Google Cloud Translation API"
        });
      } catch (translateError) {
        console.warn("Cloud Translation unavailable, trying Gemini:", translateError.message);
      }
    }

    // Tier 3: Gemini AI
    if (GEMINI_API_KEY) {
      try {
        const prompt = `You are a public-health translator for Indian Primary Health Centres.
Translate the following message into ${language}. Keep numbers, medicine names, units and PHC
codes unchanged. Reply with the translation only - no explanations, no quotes.

Message: ${text}`;
        const { text: aiText, model } = await askGemini(prompt);
        return res.json({
          original: text,
          targetLanguage: language,
          translated: aiText.trim(),
          source: `Google Gemini (${model})`
        });
      } catch (geminiError) {
        console.warn("Gemini translate fallback:", geminiError.message);
      }
    }

    // Tier 4: never fail
    res.json({
      original: text,
      targetLanguage: language,
      translated: `[${language}] ${text}`,
      source: "Passthrough (no translation provider configured)"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /  - self-documenting endpoint index (handy for demos and curl smoke checks)
app.get("/", (req, res) => {
  res.json({
    app: "SwasthyaSetu AI API",
    version: "1.0.0",
    description: "Federated PHC resource grid: telemetry intake, stock-out alerts, AI redistribution and multilingual briefings.",
    integrations: {
      firestore_configured: Boolean(db),
      firestore_healthy: firestoreHealthy,
      bigquery_configured: Boolean(BQ_PROJECT),
      gemini_configured: Boolean(GEMINI_API_KEY),
      cloud_translation_configured: Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT)
    },
    endpoints: [
      { method: "GET", path: "/health", purpose: "liveness probe" },
      { method: "GET", path: "/meta", purpose: "PHC + medicine reference data" },
      { method: "GET", path: "/dashboard", purpose: "district rollup + live risk" },
      { method: "POST", path: "/phcUpdate", purpose: "frontline daily telemetry intake" },
      { method: "GET", path: "/alerts", purpose: "stock-out / bed / staffing alerts" },
      { method: "POST", path: "/recommendation", purpose: "surplus-to-deficit donor matching" },
      { method: "POST", path: "/approveTransfer", purpose: "approve + dispatch redistribution" },
      { method: "POST", path: "/explainAlert", purpose: "Gemini officer briefing" },
      { method: "POST", path: "/translate", purpose: "multilingual PHC messaging" }
    ]
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: `Unknown route: ${req.method} ${req.originalUrl}`,
    hint: "GET / for the endpoint index"
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled API error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

exports.app = app;

