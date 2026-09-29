export const EMERGENCY_SCENARIOS = Object.freeze({
  normal: {
    id: 'normal',
    label: 'Normal',
    impacts: {},
    note: 'Baseline demand remains in place.'
  },
  dengue: {
    id: 'dengue',
    label: 'Dengue',
    impacts: {
      ORS: 15,
      PARACETAMOL_500: 35,
      'IV FLUIDS': 20
    },
    note: 'Dengue demand is expected to rise sharply in high-burden districts.'
  },
  diarrhoea: {
    id: 'diarrhoea',
    label: 'Diarrhoea',
    impacts: {
      ORS: 50,
      ZINC_TABLETS: 40
    },
    note: 'Acute diarrhoeal illness is expected to drive up oral rehydration demand.'
  },
  heatwave: {
    id: 'heatwave',
    label: 'Heatwave',
    impacts: {
      ORS: 50,
      PARACETAMOL_500: 15,
      'IV FLUIDS': 30
    },
    note: 'Heat stress and dehydration are likely to elevate rehydration demand.'
  },
  flu_outbreak: {
    id: 'flu_outbreak',
    label: 'Flu Outbreak',
    impacts: {
      PARACETAMOL_500: 35,
      'FLU_COLD_MEDICINES': 30
    },
    note: 'Respiratory illness is raising demand for fever and cold relief medicines.'
  }
});

const MEDICINE_PATTERNS = [
  { key: 'ORS', patterns: ['ors', 'oral rehydration'] },
  { key: 'PARACETAMOL_500', patterns: ['paracetamol', 'acetaminophen', 'para'] },
  { key: 'ZINC_TABLETS', patterns: ['zinc'] },
  { key: 'IV FLUIDS', patterns: ['iv fluid', 'iv fluids', 'saline', 'ringer'] },
  { key: 'FLU_COLD_MEDICINES', patterns: ['flu', 'cold', 'cough', 'amoxicillin', 'azithromycin'] }
];

export function getEmergencyScenario(scenarioKey = 'normal') {
  return EMERGENCY_SCENARIOS[scenarioKey] || EMERGENCY_SCENARIOS.normal;
}

function getMedicineImpact(scenarioKey, row) {
  const scenario = getEmergencyScenario(scenarioKey);
  if (!scenario || scenario.id === 'normal') return 0;

  const medId = String(row?.medicine_id || '').toUpperCase();
  const medName = String(row?.medicine_name || row?.medicine_id || '').toLowerCase();

  for (const [impactKey, percent] of Object.entries(scenario.impacts)) {
    const match = MEDICINE_PATTERNS.find((pattern) => pattern.key === impactKey);
    if (!match) continue;
    const target = impactKey.toLowerCase();
    const hasPattern = match.patterns.some((pattern) => medId.includes(pattern.toUpperCase()) || medName.includes(pattern));
    if (hasPattern || medId === target || medName.includes(target.toLowerCase())) {
      return percent;
    }
  }

  return 0;
}

function calculateAdjustedDemand(existingDemand, impactPercent) {
  const base = Number(existingDemand) || 0;
  if (!impactPercent) return base;
  return Number((base * (1 + impactPercent / 100)).toFixed(2));
}

export function applyEmergencyScenario(dashboard, scenarioKey = 'normal') {
  const scenario = getEmergencyScenario(scenarioKey);
  const inventory = Array.isArray(dashboard?.inventory) ? dashboard.inventory.map((row) => {
    const impactPercent = getMedicineImpact(scenarioKey, row);
    if (!impactPercent || scenario.id === 'normal') return row;

    const baseDemand = Number(row?.forecast_daily_demand ?? row?.predicted_daily_demand ?? row?.daily_consumption ?? 0) || 0;
    const adjustedDemand = calculateAdjustedDemand(baseDemand, impactPercent);
    const currentStock = Number(row?.current_stock ?? 0) || 0;
    const daysRemaining = adjustedDemand > 0 && currentStock > 0 ? Number((currentStock / adjustedDemand).toFixed(2)) : null;

    return {
      ...row,
      forecast_daily_demand: adjustedDemand,
      predicted_daily_demand: adjustedDemand,
      daily_consumption: adjustedDemand,
      forecast_days_remaining: daysRemaining,
      days_remaining: daysRemaining,
      risk_level: daysRemaining == null ? 'STABLE' : daysRemaining <= 3 ? 'CRITICAL' : daysRemaining <= 7 ? 'WARNING' : 'STABLE'
    };
  }) : [];

  const summary = {
    ...(dashboard?.summary || {}),
    emergency_active: scenario.id !== 'normal',
    emergency_scenario: scenario.id,
    emergency_label: scenario.label,
    emergency_note: scenario.note,
    critical_alerts: inventory.filter((row) => String(row?.risk_level || '').toUpperCase() === 'CRITICAL').length,
    warning_alerts: inventory.filter((row) => String(row?.risk_level || '').toUpperCase() === 'WARNING').length
  };

  return {
    ...(dashboard || {}),
    inventory,
    summary
  };
}

export function buildEmergencyDataSummary(dashboard, scenarioKey = 'normal') {
  const scenario = getEmergencyScenario(scenarioKey);
  const adjustedDashboard = applyEmergencyScenario(dashboard || { inventory: [] }, scenarioKey);
  const inventory = Array.isArray(adjustedDashboard?.inventory) ? adjustedDashboard.inventory : [];
  const criticalCount = inventory.filter((row) => String(row?.risk_level || '').toUpperCase() === 'CRITICAL').length;
  const warningCount = inventory.filter((row) => String(row?.risk_level || '').toUpperCase() === 'WARNING').length;
  const affectedDistricts = new Set(
    inventory
      .filter((row) => String(row?.risk_level || '').toUpperCase() !== 'STABLE')
      .map((row) => row?.district)
      .filter(Boolean)
  ).size;

  const stockoutDistricts = new Set(
    inventory
      .filter((row) => {
        const risk = Number(row?.forecast_days_remaining ?? row?.days_remaining);
        const isTargetedMedicine = getMedicineImpact(scenarioKey, row) > 0;
        return isTargetedMedicine && Number.isFinite(risk) && risk <= 5;
      })
      .map((row) => row?.district)
      .filter(Boolean)
  ).size;

  const impactList = Object.entries(scenario.impacts)
    .map(([label, percent]) => `${label} +${percent}%`)
    .join(' • ');

  const summaryText = scenario.id === 'normal'
    ? 'No emergency scenario is active. The network is operating on the normal baseline forecast.'
    : `${scenario.label} demand is expected to increase significantly across affected districts. ${impactList} are showing elevated demand. ${stockoutDistricts} districts are projected to experience stock-out pressure within 5 days. Immediate redistribution is recommended for high-risk districts.`;

  return {
    scenario,
    criticalAlerts: criticalCount,
    warningAlerts: warningCount,
    affectedDistricts,
    stockoutDistricts,
    impactList,
    summaryText
  };
}

export function buildEmergencyTickerText(dashboard, scenarioKey = 'normal') {
  const scenario = getEmergencyScenario(scenarioKey);
  if (scenario.id === 'normal') return '';

  const impactList = Object.entries(scenario.impacts)
    .map(([label, percent]) => `${label} +${percent}%`)
    .join(' • ');

  const summary = buildEmergencyDataSummary(dashboard || { inventory: [] }, scenarioKey);
  const hotDistrictCount = summary.stockoutDistricts || 1;
  return `🚨 EMERGENCY ALERT: ${scenario.label} surge detected — ${impactList} — ${hotDistrictCount} districts at high stock-out risk.`;
}
