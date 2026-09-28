/**
 * Initial dataset for SwasthyaSetu AI
 * Covers 3 sample states: Maharashtra, Bihar, Tamil Nadu
 * Essential medicines, PHCs, and realistic stock levels
 */

const PHC_DIRECTORY = [
  // Maharashtra - Pune District
  { id: "MH-PUNE-PHC-001", name: "Haveli Primary Health Centre", district: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567, contact: "+91 98220 12345" },
  { id: "MH-PUNE-PHC-002", name: "Shirur Community Health Post", district: "Pune", state: "Maharashtra", lat: 18.8268, lng: 74.3789, contact: "+91 98220 23456" },
  { id: "MH-PUNE-PHC-003", name: "Baramati Rural Health Centre", district: "Pune", state: "Maharashtra", lat: 18.1517, lng: 74.5771, contact: "+91 98220 34567" },
  { id: "MH-PUNE-PHC-011", name: "Daund Sub-District Health Depot", district: "Pune", state: "Maharashtra", lat: 18.4636, lng: 74.5804, contact: "+91 98220 45678" },
  
  // Bihar - Patna District
  { id: "BR-PATNA-PHC-001", name: "Danapur Primary Health Centre", district: "Patna", state: "Bihar", lat: 25.6322, lng: 85.0427, contact: "+91 94310 11223" },
  { id: "BR-PATNA-PHC-004", name: "Phulwari Sharif Health Post", district: "Patna", state: "Bihar", lat: 25.5786, lng: 85.0782, contact: "+91 94310 22334" },
  { id: "BR-PATNA-PHC-009", name: "Fatuha Rural Health Centre", district: "Patna", state: "Bihar", lat: 25.5097, lng: 85.3129, contact: "+91 94310 33445" },

  // Tamil Nadu - Madurai District
  { id: "TN-MDU-PHC-001", name: "Vadipatti Primary Health Centre", district: "Madurai", state: "Tamil Nadu", lat: 10.0574, lng: 77.9628, contact: "+91 94430 11223" },
  { id: "TN-MDU-PHC-002", name: "Usilampatti Community Health Post", district: "Madurai", state: "Tamil Nadu", lat: 9.9678, lng: 77.7942, contact: "+91 94430 22334" },
  { id: "TN-MDU-PHC-005", name: "Melur Health Sub-Center", district: "Madurai", state: "Tamil Nadu", lat: 10.0500, lng: 78.3300, contact: "+91 94430 33445" }
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
