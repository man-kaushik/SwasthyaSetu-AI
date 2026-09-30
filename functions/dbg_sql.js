require("dotenv").config({ path: __dirname + "/.env" });
const { BigQuery } = require("@google-cloud/bigquery");
const P = process.env.GOOGLE_CLOUD_PROJECT, D = process.env.BQ_DATASET;
const bq = new BigQuery({ projectId: P });
const columns = "(recommendation_id, alert_id, target_phc_id, donor_phc_id, medicine_id, medicine_name, recommended_quantity, distance_km, estimated_transit_hours, donor_remaining_stock, target_extended_days, status, created_at)";
const params = { recommendation_id: "REC-PARSE-CHECK", alert_id: null, target_phc_id: "T", donor_phc_id: "S", medicine_id: "ORS", medicine_name: "ORS", recommended_quantity: 10, distance_km: 1.5, estimated_transit_hours: 1, donor_remaining_stock: 5, target_extended_days: 2, status: "PROPOSED", created_at: new Date().toISOString() };
const types = { recommendation_id: "STRING", alert_id: "STRING", target_phc_id: "STRING", donor_phc_id: "STRING", medicine_id: "STRING", medicine_name: "STRING", recommended_quantity: "INT64", distance_km: "FLOAT64", estimated_transit_hours: "FLOAT64", donor_remaining_stock: "INT64", target_extended_days: "FLOAT64", status: "STRING", created_at: "STRING" };
(async () => {
  try {
    await bq.query({ query: `
      DELETE FROM \`${P}.${D}.recommendations\`
      WHERE recommendation_id = @recommendation_id;
      INSERT INTO \`${P}.${D}.recommendations\` ${columns}
      VALUES (
        @recommendation_id, @alert_id, @target_phc_id, @donor_phc_id, @medicine_id, @medicine_name,
        @recommended_quantity, @distance_km, @estimated_transit_hours, @donor_remaining_stock,
        @target_extended_days, @status, TIMESTAMP(@created_at)
      );`, params, types, location: "US" });
    console.log("RESULT: DML executed successfully");
  } catch (e) {
    const msg = String(e.message);
    console.log("param/type error:", /Parameter types|Parameter @|not found|Array has|类型/i.test(msg));
    console.log("syntax error:", /Syntax error|Unrecognized|Unexpected/i.test(msg));
    console.log("billing block:", /Billing has not been enabled/i.test(msg));
    console.log("message:", msg.slice(0, 240));
  }
})();
