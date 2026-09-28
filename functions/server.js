const { app } = require("./index");

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("=================================================");
  console.log(" SwasthyaSetu AI API Server");
  console.log(` Local:  http://localhost:${PORT}`);
  console.log(` Index:  http://localhost:${PORT}/`);
  console.log("-------------------------------------------------");
  console.log(" Endpoints:");
  console.log("   GET    /health");
  console.log("   GET    /meta");
  console.log("   GET    /dashboard");
  console.log("   POST   /phcUpdate");
  console.log("   GET    /alerts");
  console.log("   POST   /recommendation");
  console.log("   POST   /approveTransfer");
  console.log("   POST   /explainAlert");
  console.log("   POST   /translate");
  console.log("-------------------------------------------------");
  console.log(" Optional integrations (graceful fallback without them):");
  console.log("   GEMINI_API_KEY          -> Gemini briefings + AI translation");
  console.log("   GOOGLE_CLOUD_PROJECT    -> BigQuery forecast + Cloud Translation");
  console.log("   GOOGLE_APPLICATION_CREDENTIALS -> Firestore persistence");
  console.log("=================================================");
});

