# SwasthyaSetu-AI

# Overall Architecture

```text
Firebase Web App
  |
  |-- Firebase Auth
  |
  |-- Firestore
  |
  |-- Cloud Functions Gen 2
          |
          |-- BigQuery
          |-- BigQuery ML
          |-- Gemini API
          |-- Translation API
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
