const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const inventory = [
  { phc_id: "MH-PUNE-PHC-003", phc_name: "Baramati Rural Health Centre", district: "Pune", state: "Maharashtra", lat: 18.1517, lng: 74.5771, medicine_id: "ORS", medicine_name: "ORS Packets", current_stock: 40, daily_consumption: 22, beds_available: 3, doctors_present: 1, nurses_present: 2, patient_footfall: 110 },
  { phc_id: "MH-PUNE-PHC-011", phc_name: "Daund Sub-District Health Depot", district: "Pune", state: "Maharashtra", lat: 18.4636, lng: 74.5804, medicine_id: "ORS", medicine_name: "ORS Packets", current_stock: 620, daily_consumption: 15, beds_available: 8, doctors_present: 3, nurses_present: 5, patient_footfall: 75 },
  { phc_id: "MH-PUNE-PHC-002", phc_name: "Shirur Community Health Post", district: "Pune", state: "Maharashtra", lat: 18.8268, lng: 74.3789, medicine_id: "ORS", medicine_name: "ORS Packets", current_stock: 500, daily_consumption: 12, beds_available: 4, doctors_present: 1, nurses_present: 3, patient_footfall: 102 },
  { phc_id: "MH-PUNE-PHC-001", phc_name: "Haveli Primary Health Centre", district: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567, medicine_id: "ORS", medicine_name: "ORS Packets", current_stock: 150, daily_consumption: 20, beds_available: 4, doctors_present: 2, nurses_present: 4, patient_footfall: 115 },
  { phc_id: "BR-PATNA-PHC-001", phc_name: "Danapur Primary Health Centre", district: "Patna", state: "Bihar", lat: 25.6322, lng: 85.0427, medicine_id: "ORS", medicine_name: "ORS Packets", current_stock: 2000, daily_consumption: 1, beds_available: 8, doctors_present: 3, nurses_present: 5, patient_footfall: 175 }
];
const forecast = new Map([
  ["MH-PUNE-PHC-003__ORS", 19.8],
  ["MH-PUNE-PHC-011__ORS", 13.5],
  ["MH-PUNE-PHC-002__ORS", 10.8],
  ["MH-PUNE-PHC-001__ORS", 18],
  ["BR-PATNA-PHC-001__ORS", 1]
]);
const inventoryFields = [
  "updated_at", "phc_id", "phc_name", "district", "state", "lat", "lng", "medicine_id", "medicine_name",
  "current_stock", "daily_consumption", "beds_available", "doctors_present", "nurses_present", "patient_footfall", "total_phc_directory"
];
const inventoryTypes = {
  lat: Number, lng: Number, current_stock: Number, daily_consumption: Number, beds_available: Number,
  doctors_present: Number, nurses_present: Number, patient_footfall: Number
};
const context = {
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({ BQ_PROJECT_ID: "demo", BQ_DATASET: "swasthya_ai", BQ_LOCATION: "US" })[key] }) },
  Utilities: { sleep: () => {} },
  BigQuery: {
    Jobs: {
      query: request => {
        if (request.query.includes("AVG(forecast_value)")) {
          const fields = ["phc_id", "medicine_id", "predicted_daily_demand"];
          return {
            jobReference: { jobId: "forecast-job" },
            jobComplete: true,
            schema: { fields: fields.map(name => ({ name })) },
            rows: [...forecast].map(([key, value]) => {
              const [phcId, medicineId] = key.split("__");
              return { f: [phcId, medicineId, value].map(v => ({ v })) };
            })
          };
        }
        return {
          jobReference: { jobId: "inventory-job" },
          jobComplete: true,
          schema: { fields: inventoryFields.map(name => ({ name })) },
          rows: inventory.map(row => ({
            f: inventoryFields.map(field => ({ v: field === "updated_at" ? "2026-09-29T00:00:00Z" : field === "total_phc_directory" ? 5 : row[field] }))
          }))
        };
      },
      getQueryResults: () => { throw new Error("unexpected paginated result"); }
    }
  },
  ContentService: {
    MimeType: { JSON: "application/json", JAVASCRIPT: "application/javascript" },
    createTextOutput: text => ({ text, setMimeType(type) { this.mimeType = type; return this; } })
  },
  console
};

vm.runInNewContext(fs.readFileSync("apps-script/Code.gs", "utf8"), context);
const response = context.doGet({ parameter: {
  route: "recommendation",
  phc_id: "MH-PUNE-PHC-003",
  medicine_id: "ORS"
} });
const recommendation = JSON.parse(response.text);

assert.equal(recommendation.recommended, true);
assert.equal(recommendation.destination_phc_id, "MH-PUNE-PHC-003");
assert.equal(recommendation.source_phc_id, "MH-PUNE-PHC-011");
assert.equal(recommendation.quantity, 158);
assert.equal(recommendation.required_quantity, 158);
assert.equal(recommendation.same_state, true);
assert.ok(recommendation.source_surplus >= recommendation.quantity);
assert.ok(recommendation.distance_km < recommendation.alternative_donors[0].distance_km);
assert.ok(!recommendation.alternative_donors.some(donor => donor.source_phc_id === "MH-PUNE-PHC-001"));
assert.match(recommendation.reason, /10-day coverage/);

console.log("PASS  Apps Script recommendation route selects closest eligible source");
console.log(`PASS  ${recommendation.source_phc_id} -> ${recommendation.destination_phc_id}, ${recommendation.quantity} units at ${recommendation.distance_km} km`);
