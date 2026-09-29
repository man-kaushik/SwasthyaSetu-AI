import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEmergencyScenario, buildEmergencyDataSummary, buildEmergencyTickerText } from './emergency.js';

test('dengue emergency raises ORS and paracetamol demand', () => {
  const base = {
    inventory: [
      {
        phc_id: 'PHC-1',
        medicine_id: 'ORS',
        medicine_name: 'ORS Packets (Oral Rehydration)',
        current_stock: 100,
        daily_consumption: 10,
        forecast_daily_demand: 10,
        forecast_days_remaining: 10
      },
      {
        phc_id: 'PHC-1',
        medicine_id: 'PARACETAMOL_500',
        medicine_name: 'Paracetamol 500mg Tablets',
        current_stock: 50,
        daily_consumption: 20,
        forecast_daily_demand: 20,
        forecast_days_remaining: 2.5
      }
    ]
  };

  const adjusted = applyEmergencyScenario(base, 'dengue');

  assert.equal(adjusted.inventory[0].forecast_daily_demand, 11.5);
  assert.equal(adjusted.inventory[1].forecast_daily_demand, 27);
  assert.ok(adjusted.summary.emergency_active);
});

test('normal mode leaves the baseline demand intact', () => {
  const base = {
    inventory: [{
      phc_id: 'PHC-2',
      medicine_id: 'ORS',
      medicine_name: 'ORS Packets (Oral Rehydration)',
      current_stock: 80,
      daily_consumption: 16,
      forecast_daily_demand: 16,
      forecast_days_remaining: 5
    }]
  };

  const adjusted = applyEmergencyScenario(base, 'normal');
  assert.equal(adjusted.inventory[0].forecast_daily_demand, 16);
  assert.equal(adjusted.summary.emergency_active, false);
});

test('zero-stock medicines become critical during a matching emergency', () => {
  const adjusted = applyEmergencyScenario({
    inventory: [{
      phc_id: 'PHC-3',
      medicine_id: 'ORS',
      district: 'Pune',
      current_stock: 0,
      daily_consumption: 10
    }]
  }, 'diarrhoea');

  assert.equal(adjusted.inventory[0].days_remaining, 0);
  assert.equal(adjusted.inventory[0].risk_level, 'CRITICAL');
  assert.equal(adjusted.summary.critical_alerts, 1);
});

test('emergency summary uses recalculated risks from baseline demand', () => {
  const summary = buildEmergencyDataSummary({
    inventory: [{
      phc_id: 'PHC-4',
      medicine_id: 'ORS',
      medicine_name: 'ORS Packets',
      district: 'Pune',
      current_stock: 40,
      daily_consumption: 10,
      forecast_daily_demand: 10,
      days_remaining: 4
    }]
  }, 'dengue');

  assert.equal(summary.stockoutDistricts, 1);
  assert.equal(summary.criticalAlerts, 0);
  assert.equal(summary.warningAlerts, 1);
});

test('ticker does not invent a district count without dashboard data', () => {
  const ticker = buildEmergencyTickerText(null, 'dengue');
  assert.match(ticker, /Review recalculated stock-out risks/);
  assert.doesNotMatch(ticker, /1 districts/);
});
