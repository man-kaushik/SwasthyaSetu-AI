/**
 * Reference dataset for SwasthyaSetu AI backend API.
 * Covers 3 states (Maharashtra, Bihar, Tamil Nadu), 15 PHCs across 6 districts
 * and the national essential-medicine formulary, mirroring the offline synthetic
 * dataset in `data/phcs.csv` / `data/medicines.csv` that powers the BigQuery
 * tables (`swasthya_ai.phcs`, `swasthya_ai.medicines`).
 */

const PHC_DIRECTORY = [
  // Maharashtra - Pune district
  { id: "MH-PUNE-PHC-001", name: "Haveli Primary Health Centre", district: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567, population_served: 28500, beds: 6, contact: "+91 98220 12345" },
  { id: "MH-PUNE-PHC-002", name: "Shirur Community Health Post", district: "Pune", state: "Maharashtra", lat: 18.8268, lng: 74.3789, population_served: 21400, beds: 4, contact: "+91 98220 23456" },
  { id: "MH-PUNE-PHC-003", name: "Baramati Rural Health Centre", district: "Pune", state: "Maharashtra", lat: 18.1517, lng: 74.5771, population_served: 34200, beds: 3, contact: "+91 98220 34567" },
  { id: "MH-PUNE-PHC-004", name: "Junnar Valley PHC", district: "Pune", state: "Maharashtra", lat: 19.2083, lng: 73.8767, population_served: 19800, beds: 4, contact: "+91 98220 56789" },
  { id: "MH-PUNE-PHC-011", name: "Daund Sub-District Health Depot", district: "Pune", state: "Maharashtra", lat: 18.4636, lng: 74.5804, population_served: 45000, beds: 8, contact: "+91 98220 45678" },

  // Maharashtra - Nashik district
  { id: "MH-NSK-PHC-001", name: "Dindori Primary Health Post", district: "Nashik", state: "Maharashtra", lat: 20.2012, lng: 73.8344, population_served: 23100, beds: 4, contact: "+91 98220 67890" },
  { id: "MH-NSK-PHC-002", name: "Sinnar Rural Health Centre", district: "Nashik", state: "Maharashtra", lat: 19.8456, lng: 74.0023, population_served: 26800, beds: 5, contact: "+91 98220 78901" },

  // Bihar - Patna district
  { id: "BR-PATNA-PHC-001", name: "Danapur Primary Health Centre", district: "Patna", state: "Bihar", lat: 25.6322, lng: 85.0427, population_served: 39000, beds: 7, contact: "+91 94310 11223" },
  { id: "BR-PATNA-PHC-004", name: "Phulwari Sharif Health Post", district: "Patna", state: "Bihar", lat: 25.5786, lng: 85.0782, population_served: 48500, beds: 6, contact: "+91 94310 22334" },
  { id: "BR-PATNA-PHC-009", name: "Fatuha Rural Health Centre", district: "Patna", state: "Bihar", lat: 25.5097, lng: 85.3129, population_served: 32700, beds: 2, contact: "+91 94310 33445" },

  // Bihar - Gaya district
  { id: "BR-GAYA-PHC-001", name: "Bodh Gaya Primary Health Post", district: "Gaya", state: "Bihar", lat: 24.6961, lng: 84.9869, population_served: 31200, beds: 5, contact: "+91 94310 44556" },

  // Tamil Nadu - Madurai district
  { id: "TN-MDU-PHC-001", name: "Vadipatti Primary Health Centre", district: "Madurai", state: "Tamil Nadu", lat: 10.0574, lng: 77.9628, population_served: 27900, beds: 5, contact: "+91 94430 11223" },
  { id: "TN-MDU-PHC-002", name: "Usilampatti Community Health Post", district: "Madurai", state: "Tamil Nadu", lat: 9.9678, lng: 77.7942, population_served: 24600, beds: 4, contact: "+91 94430 22334" },
  { id: "TN-MDU-PHC-005", name: "Melur Health Sub-Center", district: "Madurai", state: "Tamil Nadu", lat: 10.0500, lng: 78.3300, population_served: 29300, beds: 6, contact: "+91 94430 33445" },

  // Tamil Nadu - Tirunelveli district
  { id: "TN-TNV-PHC-001", name: "Ambasamudram Health Post", district: "Tirunelveli", state: "Tamil Nadu", lat: 8.7061, lng: 77.4589, population_served: 25100, beds: 4, contact: "+91 94430 44556" }
];


const ESSENTIAL_MEDICINES = [
  { id: "ORS", name: "ORS Packets (Oral Rehydration)", category: "Hydration", unit: "Packets", safetyStock: 100 },
  { id: "PARACETAMOL_500", name: "Paracetamol 500mg Tablets", category: "Analgesic/Antipyretic", unit: "Strips (10s)", safetyStock: 200 },
  { id: "AMOXICILLIN_500", name: "Amoxicillin 500mg Capsules", category: "Antibiotic", unit: "Strips (10s)", safetyStock: 150 },
  { id: "AZITHROMYCIN_500", name: "Azithromycin 500mg", category: "Antibiotic", unit: "Strips (3s)", safetyStock: 80 },
  { id: "METFORMIN_500", name: "Metformin 500mg", category: "Chronic Disease", unit: "Strips (10s)", safetyStock: 120 },
  { id: "INSULIN_REGULAR", name: "Insulin Regular (100IU/ml)", category: "Cold Chain", unit: "Vials", safetyStock: 30 },
  { id: "RABIES_VACCINE", name: "Anti-Rabies Vaccine (ARV)", category: "Cold Chain / Emergency", unit: "Vials", safetyStock: 25 },
  { id: "OXYGEN_CYLINDER", name: "Medical Oxygen D-Type", category: "Critical Care", unit: "Cylinders", safetyStock: 8 }
];

module.exports = {
  PHC_DIRECTORY,
  ESSENTIAL_MEDICINES
};
