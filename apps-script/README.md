# Free Dashboard Endpoint (Google Apps Script)

This endpoint replaces only the dashboard's BigQuery `GET /dashboard` read. It
runs as the deploying Google account, uses BigQuery read-only scope, returns the
same `summary` and `inventory` response shape, and caches results for 30 seconds.
It does not provide the Express write, transfer, Gemini, or Translation routes.

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

7. From the repository root, build and deploy Hosting:
7. Test the alerts response directly at `YOUR_WEB_APP_URL/exec?route=alerts`. It returns a JSON array ordered `CRITICAL`, `WARNING`, then `STABLE`.
8. From the repository root, build and deploy Hosting:

   ```powershell
   npm --prefix frontend run build
   firebase deploy --only hosting --project swasthyasetu-ai-7b4e6
   ```

The manifest enables the BigQuery Advanced Service. The BigQuery Sandbox has
monthly query/storage limits; Apps Script also has per-user execution quotas.
This path does not require Cloud Run, Cloud Build, Artifact Registry, or placing
BigQuery credentials in frontend code.
