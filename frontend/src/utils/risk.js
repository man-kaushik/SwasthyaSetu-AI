export function riskCategory(row) {
  const risk = String(row?.risk_level || "").toUpperCase();
  const daysRemaining = Number(row?.forecast_days_remaining ?? row?.days_remaining);
  if (["CRITICAL", "STOCKED_OUT"].includes(risk) || daysRemaining <= 3) return "critical";
  if (["WARNING", "HIGH"].includes(risk) || daysRemaining <= 7) return "warning";
  return "stable";
}

export function riskLevel(row) {
  return riskCategory(row).toUpperCase();
}