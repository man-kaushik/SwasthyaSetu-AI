# SwasthyaSetu-AI

# Overall Architecture

```text
Firebase Hosting Web App
  |
  |-- Firebase Auth
  |
  |-- Firestore
  |-- Apps Script web app (read-only dashboard endpoint)
          |-- BigQuery current_inventory / phcs / medicines
  |-- Google Maps API frontend
```

---

# GitHub Repository Structure

Create this:

```text
swasthyasetu-ai/
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── firebase.json
│
├── functions/
│   ├── index.js
│   ├── services/
│   │   ├── bigquery.js
│   │   ├── gemini.js
│   │   ├── translate.js
│   │   ├── riskEngine.js
│   │   └── recommendationEngine.js
│   └── package.json
│
├── data/
│   ├── generate_data.js
│   ├── phcs.csv
│   ├── medicines.csv
│   └── inventory_history.csv
│
├── bigquery/
│   ├── create_tables.sql
│   ├── load_data_notes.md
│   ├── train_forecast_model.sql
│   └── forecast_query.sql
│
├── docs/
│   ├── demo_script.md
│   └── pitch_deck_outline.md
│
└── README.md
```

---

## API data sources (read path)

The no-billing dashboard endpoint in `apps-script/Code.gs` reads BigQuery directly
The Apps Script endpoint in `apps-script/Code.gs` serves the hosted dashboard's
read-only BigQuery data. The Express API in `functions/` remains the full local
API implementation and can be deployed separately to Cloud Run when billing is
available.

| Data | Primary source | Fallbacks |
| --- | --- | --- |
| Live stock / staff telemetry (`GET /dashboard`, `GET /alerts`, `POST /recommendation`) | `swasthya_ai.current_inventory` | Firestore `current_inventory` -> in-memory seed |
| Live dashboard (`GET /dashboard`) | Apps Script query of `swasthya_ai.current_inventory`, joined with `phcs` and `medicines` | none |
| Express API reads and writes | BigQuery | Firestore -> in-memory seed where implemented |
| Forecast risk in no-billing dashboard | Computed from stock / daily consumption | BigQuery ML forecast is not queried by Apps Script |

The full Express API still contains the write, alert, transfer, Gemini, and
translation endpoints. They are not served by the Apps Script read-only endpoint.
The web app no longer exposes a PHC telemetry data-entry screen; `POST /phcUpdate`
remains available for existing external integrations and local API tests.

The Apps Script endpoint returns a bounded inventory snapshot and dashboard
summary. It does not expose arbitrary query parameters or BigQuery write access.

```bash
cd functions
npm run start             # node server.js -> http://localhost:8080
npm run test:all          # 28 smoke + 19 BigQuery write + 29 BigQuery read checks
npm run probe:bq          # verify dataset tables/schema against the real project
```

## Deploy the no-billing dashboard endpoint

See [apps-script/README.md](apps-script/README.md) for the Apps Script deployment,
authorization, and frontend configuration steps. The deployed script runs as its
owner and is publicly callable, so only use it with dashboard data that is safe to
show publicly. BigQuery Sandbox and Apps Script quotas apply.

---
