import { auth, db } from "../firebase";
import { collection, doc, getDoc, getDocs, limit, query, setDoc, addDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { getRoleForEmail } from "../auth/roles";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || "";
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
let dashboardRequestSequence = 0;

function requireOperationsManager() {
  if (getRoleForEmail(auth.currentUser?.email) !== "operations") {
    throw new Error("Only the Operations Manager can perform this action.");
  }
}

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
  let dashboard;
  if (APPS_SCRIPT_URL) {
    dashboard = await requestAppsScript("");
  } else if (API_BASE_URL) {
    const response = await fetch(`${API_BASE_URL}/dashboard`);
    if (!response.ok) throw new Error(`Dashboard request failed (HTTP ${response.status})`);
    dashboard = await response.json();
  } else {
    throw new Error("Set VITE_APPS_SCRIPT_URL to the deployed Apps Script web app.");
  }

  return mergeFirestoreOperationalData(dashboard);
}

async function mergeFirestoreOperationalData(dashboard) {
  try {
    const [phcSnapshot, medicineSnapshot, inventorySnapshot] = await Promise.all([
      getDocs(collection(db, "phcs")),
      getDocs(collection(db, "medicines")),
      getDocs(collection(db, "current_inventory"))
    ]);
    const phcs = new Map((dashboard.phcs || []).map((phc) => [phc.phc_id, phc]));
    (dashboard.inventory || []).forEach((row) => {
      if (row.phc_id && !phcs.has(row.phc_id)) phcs.set(row.phc_id, {
        phc_id: row.phc_id,
        name: row.phc_name,
        district: row.district,
        state: row.state,
        lat: row.lat,
        lng: row.lng
      });
    });
    const medicines = new Map(medicineSnapshot.docs.map((snapshot) => {
      const medicine = snapshot.data();
      return [medicine.medicine_id || snapshot.id, medicine];
    }));
    const inventory = new Map((dashboard.inventory || []).map((row) => [`${row.phc_id}_${row.medicine_id}`, row]));

    phcSnapshot.docs.forEach((snapshot) => {
      const phc = snapshot.data();
      const phcId = phc.phc_id || snapshot.id;
      phcs.set(phcId, { ...(phcs.get(phcId) || {}), ...phc, phc_id: phcId });
    });

    inventorySnapshot.docs.forEach((snapshot) => {
      const record = snapshot.data();
      if (!record.phc_id || !record.medicine_id) return;
      const key = `${record.phc_id}_${record.medicine_id}`;
      const previous = inventory.get(key) || {};
      const phc = phcs.get(record.phc_id) || {};
      const medicine = medicines.get(record.medicine_id) || {};
      const merged = {
        ...previous,
        ...record,
        phc_name: record.phc_name || phc.name || previous.phc_name || record.phc_id,
        district: record.district || phc.district || previous.district,
        state: record.state || phc.state || previous.state,
        lat: record.lat ?? phc.lat ?? previous.lat,
        lng: record.lng ?? phc.lng ?? previous.lng,
        medicine_name: record.medicine_name || medicine.medicine_name || previous.medicine_name || record.medicine_id,
        unit: record.unit || medicine.unit || previous.unit
      };
      const dailyDemand = Number(record.predicted_daily_demand ?? record.daily_consumption ?? previous.predicted_daily_demand ?? previous.daily_consumption) || 0;
      const stock = Number(merged.current_stock) || 0;
      merged.predicted_daily_demand = dailyDemand;
      merged.days_remaining = dailyDemand > 0 ? Math.round(stock / dailyDemand * 100) / 100 : null;
      merged.risk_level = merged.days_remaining === null || merged.days_remaining > 7
        ? "STABLE"
        : merged.days_remaining <= 3 ? "CRITICAL" : "WARNING";
      inventory.set(key, merged);
    });

    const inventoryRows = [...inventory.values()];
    const uniquePhcs = new Set(inventoryRows.map((row) => row.phc_id));
    return {
      ...dashboard,
      inventory: inventoryRows,
      phcs: [...phcs.values()],
      summary: {
        ...dashboard.summary,
        total_phcs_monitored: uniquePhcs.size,
        total_medicine_records: inventoryRows.length
      }
    };
  } catch (error) {
    console.warn("Firestore operational records could not be merged into the dashboard:", error.message || String(error));
    return dashboard;
  }
}

export async function saveDistrictSupplies({ districtName, state, districtCode, phc, supplies, existingPhcIds = [] }) {
    requireOperationsManager();
  const cleanDistrict = String(districtName || "").trim();
  const cleanState = String(state || "").trim();
  const cleanPhcId = String(phc?.phc_id || "").trim();
  const cleanPhcName = String(phc?.name || "").trim();
  if (!cleanDistrict || !cleanState || !cleanPhcId || !cleanPhcName || !Array.isArray(supplies) || !supplies.length) {
    throw new Error("Complete district, state, PHC, and at least one supply.");
  }
  if (supplies.length > 100) throw new Error("Add no more than 100 supply rows at a time.");
  if (existingPhcIds.includes(cleanPhcId)) throw new Error("That PHC ID already exists in the current dashboard data.");

  const phcRef = doc(db, "phcs", cleanPhcId);
  if ((await getDoc(phcRef)).exists()) throw new Error("That PHC ID already exists in Firestore.");

  const timestamp = new Date().toISOString();
  const districtId = `${cleanState}-${cleanDistrict}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const districtRecord = {
    district_id: districtId,
    district_code: String(districtCode || "").trim() || districtId.toUpperCase(),
    district_name: cleanDistrict,
    state: cleanState,
    created_at: timestamp
  };
  const phcRecord = {
    ...phc,
    phc_id: cleanPhcId,
    name: cleanPhcName,
    district: cleanDistrict,
    state: cleanState,
    created_at: timestamp
  };
  const batch = writeBatch(db);
  batch.set(doc(db, "districts", districtId), districtRecord, { merge: true });
  batch.set(phcRef, phcRecord);

  supplies.forEach((supply) => {
    const medicineId = String(supply.medicine_id || "").trim().toUpperCase();
    const medicineName = String(supply.medicine_name || "").trim();
    const stock = Number(supply.current_stock);
    const dailyDemand = Number(supply.daily_consumption);
    if (!medicineId || !medicineName || !Number.isFinite(stock) || stock < 0 || !Number.isFinite(dailyDemand) || dailyDemand < 0) {
      throw new Error("Each supply needs a medicine, non-negative stock, and non-negative daily use.");
    }

    const medicineRecord = {
      medicine_id: medicineId,
      medicine_name: medicineName,
      unit: String(supply.unit || "Units").trim(),
      category: String(supply.category || "Other").trim(),
      safety_stock: Math.max(0, Number(supply.safety_stock) || 0),
      standard_daily_consumption: dailyDemand,
      updated_at: timestamp
    };
    const inventoryRecord = {
      phc_id: cleanPhcId,
      phc_name: cleanPhcName,
      district: cleanDistrict,
      state: cleanState,
      medicine_id: medicineId,
      medicine_name: medicineName,
      unit: medicineRecord.unit,
      current_stock: stock,
      daily_consumption: dailyDemand,
      updated_at: timestamp,
      timestamp
    };
    const inventoryId = `${cleanPhcId}_${medicineId}`;
    batch.set(doc(db, "medicines", medicineId), medicineRecord, { merge: true });
    batch.set(doc(db, "current_inventory", inventoryId), inventoryRecord);
    batch.set(doc(collection(db, "inventory_history")), inventoryRecord);
  });

  await batch.commit();
  return { district: districtRecord, phc: phcRecord, supply_count: supplies.length };
}

async function postBackend(route, payload) {
  if (!API_BASE_URL) throw new Error("Set VITE_API_BASE_URL to use transfer recommendations.");
  const idToken = await auth.currentUser?.getIdToken();
  const response = await fetch(`${API_BASE_URL}/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${route} request failed (HTTP ${response.status})`);
  return data;
}

async function requestGeminiInteraction(prompt) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured for this app.");
  let lastError;

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          model,
          input: prompt,
          store: false,
          generation_config: { thinking_level: "low" }
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed (HTTP ${response.status}).`);

      const text = data.output_text || (data.steps || data.outputs || [])
        .filter((step) => step.type === "model_output" || step.type === "text")
        .flatMap((step) => step.content || [step])
        .filter((content) => content.type === "text" && content.text)
        .map((content) => content.text)
        .join("");
      if (!text) throw new Error("Gemini returned an empty explanation.");
      return text;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

export function generateTransferRecommendation({ phc_id, medicine_id }) {
    requireOperationsManager();
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

export async function explainAlert(alertData, recommendation = null, language = "English") {
  const directKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (directKey) {
    const payload = {
      alert: {
        phc_id: alertData?.phc_id || alertData?.phc_name || "PHC-UNKNOWN",
        medicine: alertData?.medicine_name || alertData?.medicine_id || "Medicine",
        current_stock: Number(alertData?.current_stock ?? alertData?.stock ?? 0),
        days_remaining: Number(alertData?.forecast_days_remaining ?? alertData?.days_remaining ?? 0),
        risk_level: String(alertData?.risk_level || alertData?.alert_level || "WARNING").toUpperCase()
      },
      recommendation: recommendation || {
        source_phc_id: "NEARBY-SURPLUS-PHC",
        quantity: 250,
        distance_km: 18.4
      }
    };

    const prompt = `You are an AI assistant for an Indian district health officer.

Given this PHC medicine stock-out alert and transfer recommendation, generate a concise but practical operational explanation.

Requirements:
1. Explain the risk in plain, slightly human language.
2. Mention how the system identifies the problem: low stock, high demand risk, and limited days remaining.
3. Explain how the transfer plan works: find the nearest surplus PHC/source, compare the transfer distance and quantity, and recommend redistribution.
4. Give the recommended action.
5. Give a short message to the destination PHC officer.
6. Give a short message to the source PHC officer.
7. Generate the full answer in ${language}.

Keep it brief, clear, and operational, like a field officer briefing.

Data:
${JSON.stringify(payload, null, 2)}`;

    const text = await requestGeminiInteraction(prompt);
    const cleaned = String(text).replace(/```json/g, "").replace(/```/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Fall through to a readable plain-text object.
    }

    return {
      explanation: cleaned || `PHC ${payload.alert.phc_id} is facing a risk of stock-out for ${payload.alert.medicine}.`,
      recommended_action: "Review the stock shortage and arrange a transfer quickly from the nearest surplus PHC.",
      destination_phc_message: "Please prepare to receive the transfer supply from the nearest surplus PHC by tomorrow.",
      source_phc_message: "Please dispatch the required medicine stock to the requesting PHC by tomorrow as approved.",
      urgency: payload.alert.risk_level || "HIGH"
    };
  }

  if (API_BASE_URL) {
    return postBackend("explainAlert", { alertData, language });
  }

  const phcName = alertData?.phc_name || alertData?.phc_id || "PHC";
  const medName = alertData?.medicine_name || alertData?.medicine_id || "medicine";
  const days = Number(alertData?.forecast_days_remaining ?? alertData?.days_remaining ?? 2);

  return {
    explanation: `${phcName} is likely facing a shortage of ${medName}. The current stock may run out in about ${days} days, so it needs immediate attention.`,
    recommended_action: "Increase stock review and arrange quick replenishment or transfer from a nearby facility.",
    destination_phc_message: "Please prepare to receive the required medicine transfer by tomorrow.",
    source_phc_message: "Please dispatch the required stock to the requesting PHC urgently.",
    urgency: days <= 3 ? "CRITICAL" : "HIGH"
  };
}

export async function generateDistrictBriefing(districtSummary) {
  const prompt = `You are generating an operational district briefing from verified application data. Use only the supplied data. Do not invent PHCs, quantities, stock levels, days remaining, statistics, trends, or actions. If information is unavailable, explicitly state that it is unavailable.

Return one valid JSON object with these keys: district, summary, criticalAlerts, warningAlerts, medicinesAtRisk, stockoutRisks, recommendedActions, dataLimitations. Keep every number and recommendation grounded in the provided summary. Preserve the supplied counts exactly. recommendedActions are suggestions only, not approved or executed actions.

Verified district data:
${JSON.stringify(districtSummary)}`;
  const responseText = await requestGeminiInteraction(prompt);
  const cleaned = String(responseText).replace(/```json/g, "").replace(/```/g, "").trim();
  const jsonText = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error("Gemini returned a briefing in an unexpected format.");

  const briefing = JSON.parse(jsonText);
  if (!briefing || typeof briefing !== "object" || Array.isArray(briefing) || typeof briefing.summary !== "string") {
    throw new Error("Gemini returned an incomplete district briefing.");
  }
  return {
    district: String(briefing.district || districtSummary.district),
    summary: briefing.summary,
    criticalAlerts: Number.isFinite(Number(briefing.criticalAlerts)) ? Number(briefing.criticalAlerts) : districtSummary.critical_alerts,
    warningAlerts: Number.isFinite(Number(briefing.warningAlerts)) ? Number(briefing.warningAlerts) : districtSummary.warning_alerts,
    medicinesAtRisk: Array.isArray(briefing.medicinesAtRisk) ? briefing.medicinesAtRisk : [],
    stockoutRisks: Array.isArray(briefing.stockoutRisks) ? briefing.stockoutRisks : [],
    recommendedActions: Array.isArray(briefing.recommendedActions) ? briefing.recommendedActions : [],
    dataLimitations: Array.isArray(briefing.dataLimitations) ? briefing.dataLimitations : []
  };
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

export async function createTransferRequest(request, userProfile) {
  if (!userProfile?.uid || !userProfile?.email || !["operations", "viewer"].includes(userProfile.role)) {
    throw new Error("Sign in with an assigned role before raising a transfer request.");
  }
  const quantity = Number(request.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Enter a whole-number quantity greater than zero.");
  if (!request.source_phc_id || !request.destination_phc_id || request.source_phc_id === request.destination_phc_id) {
    throw new Error("Choose different source and destination PHCs.");
  }
  if (!request.medicine_id || !String(request.reason || "").trim()) {
    throw new Error("Choose a medicine and add a short reason.");
  }

  const record = {
    requester_uid: userProfile.uid,
    requester_email: userProfile.email,
    requester_name: userProfile.name || userProfile.email,
    source_phc_id: request.source_phc_id,
    source_phc_name: request.source_phc_name,
    destination_phc_id: request.destination_phc_id,
    destination_phc_name: request.destination_phc_name,
    resource_type: "medicine",
    medicine_id: request.medicine_id,
    medicine_name: request.medicine_name,
    quantity,
    priority: request.priority,
    reason: String(request.reason).trim().slice(0, 500),
    status: "pending",
    created_at: new Date().toISOString()
  };
  const result = await addDoc(collection(db, "transfer_requests"), record);
  return { id: result.id, ...record };
}

export async function getTransferRequests(userProfile) {
  if (!userProfile?.uid || !["operations", "viewer"].includes(userProfile.role)) return [];
  const requests = collection(db, "transfer_requests");
  const requestQuery = userProfile.role === "operations"
    ? query(requests, limit(200))
    : query(requests, where("requester_uid", "==", userProfile.uid), limit(100));
  const snapshot = await getDocs(requestQuery);
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

export async function updateTransferRequestStatus(request, status, userProfile) {
  requireOperationsManager();
  if (!request?.id || !["approved", "rejected"].includes(status)) throw new Error("Invalid transfer request action.");
  const reviewedAt = new Date().toISOString();
  const reviewedBy = userProfile?.email || auth.currentUser?.email;
  await updateDoc(doc(db, "transfer_requests", request.id), {
    status,
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt
  });
  return { ...request, status, reviewed_by: reviewedBy, reviewed_at: reviewedAt };
}

export async function rejectTransferPlan(plan) {
    requireOperationsManager();
  const rejectedAt = new Date().toISOString();
  await setDoc(doc(db, "recommendations", plan.recommendation_id), {
    status: "REJECTED",
    rejected_at: rejectedAt,
    rejected_by: "Dashboard operator"
  }, { merge: true });
  return { success: true, status: "REJECTED", rejected_at: rejectedAt };
}

export async function completeTransferPlan(transfer) {
    requireOperationsManager();
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
    requireOperationsManager();
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

