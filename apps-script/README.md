# Free Dashboard Endpoint (Google Apps Script)

This endpoint serves dashboard, alert, and transfer-recommendation reads from
BigQuery using read-only scope. It runs as the deploying Google account and
caches the inventory snapshot for 30 seconds. Recommendation generation reads
`current_inventory`, PHC directories, and forecasts; it does not write BigQuery.
Transfer approval is written by the frontend to Firestore in an atomic batch,
so this workflow does not require Cloud Run.

## Deploy

1. Open [script.google.com](https://script.google.com/) and open the existing dashboard script project.
2. In Project Settings, enable **Show `appsscript.json` manifest file**. Replace the generated `Code.gs` and manifest with the files in this folder.
3. In the Apps Script project settings, link the standard Google Cloud project `swasthyasetu-ai-7b4e6`. Enable the BigQuery API for that project.
4. Ensure the Google account deploying the script can create BigQuery jobs in `swasthyasetu-ai-7b4e6` (`roles/bigquery.jobUser`) and read the `swasthya_ai` dataset (`roles/bigquery.dataViewer`). Authorize the requested BigQuery read-only scope when prompted.
5. Select **Deploy > New deployment > Web app**. Execute as **Me** and allow **Anyone** access. This publishes the inventory dashboard data publicly; only use this setting for data approved for public display. If your account or Workspace administrator does not offer anonymous access, this public Firebase dashboard cannot call the endpoint as configured.
6. Copy the deployed URL ending in `/exec` into `frontend/.env.production.local`:

   ```dotenv
   VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
   ```

7. Run these BigQuery seed scripts in order: [`01_seed_phcs.sql`](../bigquery/seed_sql/01_seed_phcs.sql), [`02_seed_medicines.sql`](../bigquery/seed_sql/02_seed_medicines.sql), [`03_seed_current_inventory.sql`](../bigquery/seed_sql/03_seed_current_inventory.sql), [`03b_seed_redistribution_demo.sql`](../bigquery/seed_sql/03b_seed_redistribution_demo.sql), then [`05_seed_forecast_results.sql`](../bigquery/seed_sql/05_seed_forecast_results.sql). The demo reuses existing PHC/medicine IDs and creates shortage, nearest eligible donor, farther eligible donor, and insufficient-donor cases.
8. Verify `YOUR_WEB_APP_URL/exec?route=alerts` returns risk rows and `YOUR_WEB_APP_URL/exec?route=recommendation&phc_id=MH-PUNE-PHC-003&medicine_id=ORS` selects `MH-PUNE-PHC-011` for the demo scenario.
   Locally, run `node apps-script/recommendation_smoke_test.js` to check the deterministic donor ranking without Google credentials.
9. From the repository root, build and deploy Hosting:

   ```powershell
   npm --prefix frontend run build
   firebase deploy --only hosting --project swasthyasetu-ai-7b4e6
   ```

The manifest enables the BigQuery Advanced Service. The BigQuery Sandbox has
monthly query/storage limits; Apps Script also has per-user execution quotas.
This path does not require Cloud Run, Cloud Build, Artifact Registry, or placing
BigQuery credentials in frontend code.

Prototype mode allows unauthenticated reads and writes to operational Firestore
collections so the public demo works without sign-in. Anyone with the app URL
can modify demo inventory, districts, and transfers. Use synthetic data only;
restore authenticated rules and disable `DEMO_MODE` before using real data.
