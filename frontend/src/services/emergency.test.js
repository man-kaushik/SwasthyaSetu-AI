import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEmergencyScenario } from './emergency.js';

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
