// Synthetic data generator for SwasthyaSetu AI
const fs = require("fs");
const path = require("path");

const PHC_DATA = [
  { phc_id: "MH-PUNE-PHC-001", name: "Haveli Primary Health Centre", state: "Maharashtra", district: "Pune", lat: 18.5204, lng: 73.8567, population_served: 28500 },
  { phc_id: "MH-PUNE-PHC-002", name: "Shirur Community Health Post", state: "Maharashtra", district: "Pune", lat: 18.8268, lng: 74.3789, population_served: 21400 },
  { phc_id: "MH-PUNE-PHC-003", name: "Baramati Rural Health Centre", state: "Maharashtra", district: "Pune", lat: 18.1517, lng: 74.5771, population_served: 34200 },
  { phc_id: "MH-PUNE-PHC-004", name: "Junnar Valley PHC", state: "Maharashtra", district: "Pune", lat: 19.2083, lng: 73.8767, population_served: 19800 },
  { phc_id: "MH-PUNE-PHC-011", name: "Daund Sub-District Health Depot", state: "Maharashtra", district: "Pune", lat: 18.4636, lng: 74.5804, population_served: 45000 },
  { phc_id: "MH-NSK-PHC-001", name: "Dindori Primary Health Post", state: "Maharashtra", district: "Nashik", lat: 20.2012, lng: 73.8344, population_served: 23100 },
  { phc_id: "MH-NSK-PHC-002", name: "Sinnar Rural Health Centre", state: "Maharashtra", district: "Nashik", lat: 19.8456, lng: 74.0023, population_served: 26800 },
  { phc_id: "BR-PATNA-PHC-001", name: "Danapur Primary Health Centre", state: "Bihar", district: "Patna", lat: 25.6322, lng: 85.0427, population_served: 39000 },
  { phc_id: "BR-PATNA-PHC-004", name: "Phulwari Sharif Health Post", state: "Bihar", district: "Patna", lat: 25.5786, lng: 85.0782, population_served: 48500 },
  { phc_id: "BR-PATNA-PHC-009", name: "Fatuha Rural Health Centre", state: "Bihar", district: "Patna", lat: 25.5097, lng: 85.3129, population_served: 32700 },
  { phc_id: "BR-GAYA-PHC-001", name: "Bodh Gaya Primary Health Post", state: "Bihar", district: "Gaya", lat: 24.6961, lng: 84.9869, population_served: 31200 },
  { phc_id: "TN-MDU-PHC-001", name: "Vadipatti Primary Health Centre", state: "Tamil Nadu", district: "Madurai", lat: 10.0574, lng: 77.9628, population_served: 27900 },
  { phc_id: "TN-MDU-PHC-002", name: "Usilampatti Community Health Post", state: "Tamil Nadu", district: "Madurai", lat: 9.9678, lng: 77.7942, population_served: 24600 },
  { phc_id: "TN-MDU-PHC-005", name: "Melur Health Sub-Center", state: "Tamil Nadu", district: "Madurai", lat: 10.0500, lng: 78.3300, population_served: 29300 },
  { phc_id: "TN-TNV-PHC-001", name: "Ambasamudram Health Post", state: "Tamil Nadu", district: "Tirunelveli", lat: 8.7061, lng: 77.4589, population_served: 25100 }
];

const MEDICINE_DATA = [
  { medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", category: "Hydration", unit: "Packets", safety_stock: 100, standard_daily_consumption: 18 },
  { medicine_id: "PARACETAMOL_500", medicine_name: "Paracetamol 500mg Tablets", category: "Analgesic/Antipyretic", unit: "Strips (10s)", safety_stock: 200, standard_daily_consumption: 40 },
  { medicine_id: "AMOXICILLIN_500", medicine_name: "Amoxicillin 500mg Capsules", category: "Antibiotic", unit: "Strips (10s)", safety_stock: 150, standard_daily_consumption: 25 },
  { medicine_id: "AZITHROMYCIN_500", medicine_name: "Azithromycin 500mg Tablets", category: "Antibiotic", unit: "Strips (3s)", safety_stock: 80, standard_daily_consumption: 15 },
  { medicine_id: "METFORMIN_500", medicine_name: "Metformin 500mg Tablets", category: "Chronic Disease", unit: "Strips (10s)", safety_stock: 120, standard_daily_consumption: 22 },
  { medicine_id: "INSULIN_REGULAR", medicine_name: "Insulin Regular (100IU/ml)", category: "Cold Chain", unit: "Vials", safety_stock: 30, standard_daily_consumption: 5 },
  { medicine_id: "RABIES_VACCINE", medicine_name: "Anti-Rabies Vaccine (ARV)", category: "Cold Chain / Emergency", unit: "Vials", safety_stock: 25, standard_daily_consumption: 4 },
  { medicine_id: "OXYGEN_CYLINDER", medicine_name: "Medical Oxygen D-Type", category: "Critical Care", unit: "Cylinders", safety_stock: 8, standard_daily_consumption: 2 }
];

function toCSV(items, headers) {
  const headerRow = headers.join(",");
  const rows = items.map(item => {
    return headers.map(header => {
      let val = item[header];
      if (val === undefined || val === null) val = "";
      if (typeof val === "string" && (val.includes(",") || val.includes("\""))) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(",");
  });
  return [headerRow, ...rows].join("\n");
}

function generateSyntheticData() {
  const dataDir = path.resolve(__dirname);
  const totalDays = 90;
  const baseDate = new Date("2024-11-17");

  const inventoryHistory = [];
  const currentInventory = [];

  PHC_DATA.forEach(phc => {
    const bedsAvailableBase = Math.floor(phc.population_served / 5000);
    const doctorsBase = Math.max(1, Math.floor(phc.population_served / 12000));
    const nursesBase = Math.max(2, Math.floor(phc.population_served / 7000));

    MEDICINE_DATA.forEach(med => {
      let runningStock = med.safety_stock * 3 + Math.floor(Math.random() * 200);

      for (let day = 1; day <= totalDays; day++) {
        const currentDate = new Date(baseDate);
        currentDate.setDate(baseDate.getDate() + day);
        const dateStr = currentDate.toISOString().split("T")[0];

        let footfall = Math.floor(phc.population_served / 350) + Math.floor(Math.random() * 25);
        let dailyConsumption = med.standard_daily_consumption + Math.floor(Math.random() * 8) - 4;
        if (dailyConsumption < 1) dailyConsumption = 1;

        // Realistic demand spikes:
        // ORS demand spike in monsoon / diarrheal disease outbreak (day > 60)
        if (med.medicine_id === "ORS" && day > 60) {
          dailyConsumption += Math.floor(Math.random() * 20) + 10;
          footfall += Math.floor(Math.random() * 30) + 20;
        }

        // Paracetamol & Azithromycin viral fever surge (day 30 - 55)
        if ((med.medicine_id === "PARACETAMOL_500" || med.medicine_id === "AZITHROMYCIN_500") && day >= 30 && day <= 55) {
          dailyConsumption += Math.floor(Math.random() * 15) + 8;
          footfall += 15;
        }

        // Periodic buffer replenishment
        if (runningStock < med.safety_stock * 1.2 && day < totalDays - 5) {
          runningStock += med.safety_stock * 2 + Math.floor(Math.random() * 100);
        }

        runningStock = Math.max(10, runningStock - dailyConsumption);

        inventoryHistory.push({
          date: dateStr,
          phc_id: phc.phc_id,
          medicine_id: med.medicine_id,
          medicine_name: med.medicine_name,
          daily_consumption: dailyConsumption,
          current_stock: runningStock,
          patient_footfall: footfall
        });

        // Current Inventory Snapshot at Day 90
        if (day === totalDays) {
          let finalStock = runningStock;
          let finalConsumption = dailyConsumption;
          let finalBeds = Math.max(1, bedsAvailableBase + Math.floor(Math.random() * 3) - 1);
          let finalDoctors = doctorsBase;
          let finalNurses = nursesBase;
          let finalFootfall = footfall;

          // Critical Scenario: PHC MH-PUNE-PHC-003 has ORS stock only 40, demand 22/day (stockout in 1.8 days)
          if (phc.phc_id === "MH-PUNE-PHC-003" && med.medicine_id === "ORS") {
            finalStock = 40;
            finalConsumption = 22;
            finalFootfall = 110;
            finalBeds = 3;
            finalDoctors = 1;
            finalNurses = 2;
          }

          // Companion surplus donor: MH-PUNE-PHC-011 (Daund depot has 620 ORS)
          if (phc.phc_id === "MH-PUNE-PHC-011" && med.medicine_id === "ORS") {
            finalStock = 620;
            finalConsumption = 15;
            finalFootfall = 75;
            finalBeds = 8;
            finalDoctors = 3;
            finalNurses = 5;
          }

          currentInventory.push({
            phc_id: phc.phc_id,
            medicine_id: med.medicine_id,
            medicine_name: med.medicine_name,
            current_stock: finalStock,
            daily_consumption: finalConsumption,
            beds_available: finalBeds,
            doctors_present: finalDoctors,
            nurses_present: finalNurses,
            patient_footfall: finalFootfall,
            timestamp: new Date().toISOString()
          });
        }
      }
    });
  });

  // Export CSV and JSON files
  const phcHeaders = ["phc_id", "name", "state", "district", "lat", "lng", "population_served"];
  fs.writeFileSync(path.join(dataDir, "phcs.csv"), toCSV(PHC_DATA, phcHeaders), "utf8");
  fs.writeFileSync(path.join(dataDir, "phcs.json"), JSON.stringify(PHC_DATA, null, 2), "utf8");

  const medHeaders = ["medicine_id", "medicine_name", "category", "unit", "safety_stock", "standard_daily_consumption"];
  fs.writeFileSync(path.join(dataDir, "medicines.csv"), toCSV(MEDICINE_DATA, medHeaders), "utf8");
  fs.writeFileSync(path.join(dataDir, "medicines.json"), JSON.stringify(MEDICINE_DATA, null, 2), "utf8");

  const histHeaders = ["date", "phc_id", "medicine_id", "medicine_name", "daily_consumption", "current_stock", "patient_footfall"];
  fs.writeFileSync(path.join(dataDir, "inventory_history.csv"), toCSV(inventoryHistory, histHeaders), "utf8");
  fs.writeFileSync(path.join(dataDir, "inventory_history.json"), JSON.stringify(inventoryHistory, null, 2), "utf8");

  const currHeaders = ["phc_id", "medicine_id", "medicine_name", "current_stock", "daily_consumption", "beds_available", "doctors_present", "nurses_present", "patient_footfall", "timestamp"];
  fs.writeFileSync(path.join(dataDir, "current_inventory.csv"), toCSV(currentInventory, currHeaders), "utf8");
  fs.writeFileSync(path.join(dataDir, "current_inventory.json"), JSON.stringify(currentInventory, null, 2), "utf8");

  console.log(`Generated datasets in ${dataDir}:`);
  console.log(`- phcs.csv & phcs.json: ${PHC_DATA.length} PHCs`);
  console.log(`- medicines.csv & medicines.json: ${MEDICINE_DATA.length} medicines`);
  console.log(`- inventory_history.csv & inventory_history.json: ${inventoryHistory.length} daily consumption records`);
  console.log(`- current_inventory.csv & current_inventory.json: ${currentInventory.length} current facility snapshots`);
}

if (require.main === module) {
  generateSyntheticData();
}

module.exports = {
  generateSyntheticData,
  PHC_DATA,
  MEDICINE_DATA
};

