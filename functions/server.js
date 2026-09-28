const { app } = require("./index");

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` SwasthyaSetu AI API Server running on port ${PORT}`);
  console.log(` Local: http://localhost:${PORT}`);
  console.log(` Endpoints:`);
  console.log(`  - GET  /health`);
  console.log(`  - GET  /meta`);
  console.log(`  - GET  /dashboard`);
  console.log(`  - POST /phcUpdate`);
  console.log(`  - GET  /alerts`);
  console.log(`  - POST /recommendation`);
  console.log(`  - POST /approveTransfer`);
  console.log(`  - POST /explainAlert`);
  console.log(`  - POST /translate`);
  console.log(`=================================================`);
});
