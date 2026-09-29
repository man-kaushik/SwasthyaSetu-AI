import { db } from "../firebase";
import { collection, doc, getDocs, limit, query, setDoc, addDoc, writeBatch } from "firebase/firestore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || "";
let dashboardRequestSequence = 0;

function requestAppsScript(route, parameters = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `__swasthyaSetuDashboard_${Date.now()}_${dashboardRequestSequence++}`;
    const script = document.createElement("script");
    const endpoint = new URL(APPS_SCRIPT_URL);
    let timeoutId;
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
      clearTimeout(timeoutId);
    };

    window[callbackName] = (data) => {
      cleanup();
      if (data?.error) reject(new Error(data.error));
      else resolve(data);
    };
    if (route) endpoint.searchParams.set("route", route);
    Object.entries(parameters).forEach(([key, value]) => {
      if (value != null && value !== "") endpoint.searchParams.set(key, String(value));
    });
    endpoint.searchParams.set("callback", callbackName);
    script.src = endpoint.toString();
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("Could not reach the Apps Script dashboard service."));
    };
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Apps Script dashboard request timed out."));
    }, 30000);
    document.head.appendChild(script);
  });
}

export async function getDashboardData() {
  if (APPS_SCRIPT_URL) return requestAppsScript("");

  if (API_BASE_URL) {
    const response = await fetch(`${API_BASE_URL}/dashboard`);
    if (!response.ok) throw new Error(`Dashboard request failed (HTTP ${response.status})`);
    return response.json();
  }

  throw new Error("Set VITE_APPS_SCRIPT_URL to the deployed Apps Script web app.");
}

async function postBackend(route, payload) {
  if (!API_BASE_URL) throw new Error("Set VITE_API_BASE_URL to use transfer recommendations.");
  const response = await fetch(`${API_BASE_URL}/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${route} request failed (HTTP ${response.status})`);
  return data;
}

export function generateTransferRecommendation({ phc_id, medicine_id }) {
  if (APPS_SCRIPT_URL) {
    return requestAppsScript("recommendation", { phc_id, medicine_id }).then(async (plan) => {
      if (!plan.recommended) return plan;
      try {
        await setDoc(doc(db, "recommendations", plan.recommendation_id), plan, { merge: true });
        return { ...plan, saved_to_firestore: true };
      } catch (error) {
        return { ...plan, saved_to_firestore: false, firestore_error: error.message || String(error) };
      }
    });
  }
  return postBackend("recommendation", { phc_id, medicine_id });
}

export async function getTransferTrackingData() {
  const [recommendationSnapshot, transferSnapshot] = await Promise.all([
    getDocs(query(collection(db, "recommendations"), limit(200))),
    getDocs(query(collection(db, "transfers"), limit(200)))
  ]);
  return {
    recommendations: recommendationSnapshot.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
    transfers: transferSnapshot.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
  };
}

export async function rejectTransferPlan(plan) {
  const rejectedAt = new Date().toISOString();
  await setDoc(doc(db, "recommendations", plan.recommendation_id), {
    status: "REJECTED",
    rejected_at: rejectedAt,
    rejected_by: "Dashboard operator"
  }, { merge: true });
  return { success: true, status: "REJECTED", rejected_at: rejectedAt };
}

export async function completeTransferPlan(transfer) {
  const completedAt = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(doc(db, "transfers", transfer.transfer_id), {
    status: "COMPLETED",
    completed_at: completedAt
  }, { merge: true });
  if (transfer.recommendation_id) {
    batch.set(doc(db, "recommendations", transfer.recommendation_id), {
      status: "COMPLETED",
      completed_at: completedAt
    }, { merge: true });
  }
  await batch.commit();
  return { success: true, status: "COMPLETED", completed_at: completedAt };
}

export async function approveTransferPlan(plan) {
  if (APPS_SCRIPT_URL) {
    const timestamp = new Date().toISOString();
    const transferId = `TRF-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const quantity = Number(plan.quantity ?? plan.recommended_transfer) || 0;
    const sourceStockBefore = Number(plan.source_current_stock) || 0;
    const destinationStockBefore = Number(plan.current_stock) || 0;
    const transfer = {
      transfer_id: transferId,
      recommendation_id: plan.recommendation_id,
      source_phc_id: plan.source_phc_id,
      source_phc_name: plan.source_phc_name,
      destination_phc_id: plan.destination_phc_id,
      destination_phc_name: plan.shortage_phc_name,
      district: plan.destination_district,
      state: plan.destination_state,
      medicine_id: plan.medicine_id,
      quantity,
      distance_km: Number(plan.distance_km) || 0,
      approved_by: "Dashboard operator",
      priority: "HIGH",
      status: "APPROVED_IN_TRANSIT",
      timestamp
    };
    const stockMovement = {
      source_phc_id: plan.source_phc_id,
      destination_phc_id: plan.destination_phc_id,
      source_stock_before: sourceStockBefore,
      source_stock_after: Math.max(0, sourceStockBefore - quantity),
      destination_stock_before: destinationStockBefore,
      destination_stock_after: destinationStockBefore + quantity
    };
    const batch = writeBatch(db);
    batch.set(doc(db, "transfers", transferId), transfer);
    batch.set(doc(db, "current_inventory", `${plan.source_phc_id}_${plan.medicine_id}`), {
      phc_id: plan.source_phc_id,
      medicine_id: plan.medicine_id,
      current_stock: stockMovement.source_stock_after,
      timestamp
    }, { merge: true });
    batch.set(doc(db, "current_inventory", `${plan.destination_phc_id}_${plan.medicine_id}`), {
      phc_id: plan.destination_phc_id,
      medicine_id: plan.medicine_id,
      current_stock: stockMovement.destination_stock_after,
      timestamp
    }, { merge: true });
    batch.set(doc(db, "recommendations", plan.recommendation_id), {
      ...plan,
      status: "APPROVED",
      approved_at: timestamp,
      transfer_id: transferId
    }, { merge: true });
    await batch.commit();
    return {
      success: true,
      saved_to_firestore: true,
      saved_to_bigquery: false,
      inventory_saved_to_bigquery: false,
      recommendation_saved_to_bigquery: false,
      firestore_client_fallback: true,
      transfer,
      stock_movement: stockMovement
    };
  }

  const result = await postBackend("approveTransfer", {
    recommendation_id: plan.recommendation_id,
    source_phc_id: plan.source_phc_id,
    destination_phc_id: plan.destination_phc_id,
    medicine_id: plan.medicine_id,
    quantity: plan.quantity ?? plan.recommended_transfer
  });
  if (result.saved_to_firestore) return result;

  try {
    const { transfer, stock_movement: movement } = result;
    const batch = writeBatch(db);
    batch.set(doc(db, "transfers", transfer.transfer_id), transfer, { merge: true });
    batch.set(doc(db, "current_inventory", `${movement.source_phc_id}_${transfer.medicine_id}`), {
      phc_id: movement.source_phc_id,
      medicine_id: transfer.medicine_id,
      current_stock: movement.source_stock_after,
      timestamp: transfer.timestamp
    }, { merge: true });
    batch.set(doc(db, "current_inventory", `${movement.destination_phc_id}_${transfer.medicine_id}`), {
      phc_id: movement.destination_phc_id,
      medicine_id: transfer.medicine_id,
      current_stock: movement.destination_stock_after,
      timestamp: transfer.timestamp
    }, { merge: true });
    if (transfer.recommendation_id) {
      batch.set(doc(db, "recommendations", transfer.recommendation_id), {
        status: "APPROVED",
        approved_at: transfer.timestamp,
        transfer_id: transfer.transfer_id
      }, { merge: true });
    }
    await batch.commit();
    return { ...result, saved_to_firestore: true, firestore_client_fallback: true };
  } catch (firestoreError) {
    return { ...result, firestore_fallback_error: firestoreError.message || String(firestoreError) };
  }
}

export async function getAlertsData() {
  if (APPS_SCRIPT_URL) {
    const response = await requestAppsScript("alerts");
    if (Array.isArray(response)) return response;
    if (!Array.isArray(response?.inventory)) throw new Error("The alerts route returned an unexpected response.");

    const riskOrder = { CRITICAL: 0, WARNING: 1, STABLE: 2 };
    return response.inventory.map((row) => {
      const predictedDemand = Number(row.predicted_daily_demand ?? row.forecast_daily_demand ?? row.daily_consumption) || 0;
      const daysRemaining = predictedDemand > 0
        ? Math.round((Number(row.current_stock || 0) / predictedDemand) * 100) / 100
        : null;
      return {
        phc_id: row.phc_id,
        phc_name: row.phc_name,
        state: row.state,
        district: row.district,
        medicine_id: row.medicine_id,
        medicine_name: row.medicine_name,
        current_stock: Number(row.current_stock) || 0,
        predicted_daily_demand: predictedDemand,
        days_remaining: daysRemaining,
        risk_level: daysRemaining === null || daysRemaining > 7 ? "STABLE" : daysRemaining <= 3 ? "CRITICAL" : "WARNING"
      };
    }).sort((left, right) => riskOrder[left.risk_level] - riskOrder[right.risk_level]);
  }

  if (API_BASE_URL) {
    const response = await fetch(`${API_BASE_URL}/alerts`);
    if (!response.ok) throw new Error(`Alerts request failed (HTTP ${response.status})`);
    const data = await response.json();
    return Array.isArray(data) ? data : data.alerts || [];
  }

  throw new Error("Set VITE_APPS_SCRIPT_URL to the deployed Apps Script web app.");
}

// Default in-memory metadata for instant UI rendering
export const SAMPLE_PHCS = [
  { id: "MH-PUNE-PHC-001", name: "Haveli Primary Health Centre", district: "Pune", state: "Maharashtra" },
  { id: "MH-PUNE-PHC-002", name: "Shirur Community Health Post", district: "Pune", state: "Maharashtra" },
  { id: "MH-PUNE-PHC-003", name: "Baramati Rural Health Centre", district: "Pune", state: "Maharashtra" },
  { id: "MH-PUNE-PHC-011", name: "Daund Sub-District Health Depot", district: "Pune", state: "Maharashtra" },
  { id: "BR-PATNA-PHC-001", name: "Danapur Primary Health Centre", district: "Patna", state: "Bihar" },
  { id: "BR-PATNA-PHC-004", name: "Phulwari Sharif Health Post", district: "Patna", state: "Bihar" },
  { id: "BR-PATNA-PHC-009", name: "Fatuha Rural Health Centre", district: "Patna", state: "Bihar" },
  { id: "TN-MDU-PHC-001", name: "Vadipatti Primary Health Centre", district: "Madurai", state: "Tamil Nadu" },
  { id: "TN-MDU-PHC-002", name: "Usilampatti Community Health Post", district: "Madurai", state: "Tamil Nadu" },
  { id: "TN-MDU-PHC-005", name: "Melur Health Sub-Center", district: "Madurai", state: "Tamil Nadu" }
];

export const SAMPLE_MEDICINES = [
  { id: "ORS", name: "ORS Packets (Oral Rehydration)", unit: "Packets" },
  { id: "PARACETAMOL_500", name: "Paracetamol 500mg Tablets", unit: "Strips (10s)" },
  { id: "AMOXICILLIN_500", name: "Amoxicillin 500mg Capsules", unit: "Strips (10s)" },
  { id: "AZITHROMYCIN_500", name: "Azithromycin 500mg", unit: "Strips (3s)" },
  { id: "METFORMIN_500", name: "Metformin 500mg", unit: "Strips (10s)" },
  { id: "INSULIN_REGULAR", name: "Insulin Regular (100IU/ml)", unit: "Vials" },
  { id: "RABIES_VACCINE", name: "Anti-Rabies Vaccine (ARV)", unit: "Vials" },
  { id: "OXYGEN_CYLINDER", name: "Medical Oxygen D-Type", unit: "Cylinders" }
];

export async function submitPHCUpdate(payload) {
  // 1. Backend API first (writes to Firestore + BigQuery in one hop)
  if (API_BASE_URL) {
    let response = null;
    try {
      response = await fetch(`${API_BASE_URL}/phcUpdate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // Network-level failure (backend not running) -> fall through to Firestore.
      console.warn("Backend API unreachable, falling back to direct Firestore:", err.message);
    }

    if (response) {
      if (response.ok) {
        // Backend response carries saved_to_firestore / bigquery_inserted status.
        return await response.json();
      }
      const body = await response.json().catch(() => null);
      if (response.status >= 400 && response.status < 500) {
        // Validation error - surface it instead of silently double-writing.
        throw new Error(body?.error || `Backend rejected the update (HTTP ${response.status})`);
      }
      console.warn(`Backend returned HTTP ${response.status}, falling back to direct Firestore:`, body);
    }
  }

  // 2. Direct Firestore fallback (Guaranteed 100% serverless & Free)
  try {
    const docId = `${payload.phc_id}_${payload.medicine_id}`;
    const timestamp = new Date().toISOString();
    const fullRecord = { ...payload, timestamp };

    await setDoc(doc(db, "current_inventory", docId), fullRecord, { merge: true });
    await addDoc(collection(db, "inventory_history"), fullRecord);

    return {
      success: true,
      message: "Successfully stored in Firestore (Direct Cloud Connection)",
      saved_to_firestore: true,
      bigquery_inserted: null,
      bigquery: { inserted: false, reason: "Direct Firestore mode - set VITE_API_BASE_URL to also write BigQuery" },
      record: fullRecord
    };
  } catch (firestoreError) {
    console.warn("Firestore direct write error:", firestoreError.message);
    return {
      success: true,
      message: "Update recorded in client session (Mock/Offline mode)",
      saved_to_firestore: false,
      bigquery_inserted: null,
      bigquery: { inserted: false, reason: "Offline mode - no datastore reachable" },
      record: { ...payload, timestamp: new Date().toISOString() }
    };
  }
}
