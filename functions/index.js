const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { PHC_DIRECTORY, ESSENTIAL_MEDICINES } = require("./data");

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (err) {
    console.warn("Firebase admin init warning:", err.message);
  }
}

let db = null;
try {
  db = admin.firestore();
} catch (e) {
  console.warn("Firestore client not initialized:", e.message);
}

const memoryStore = {
  inventory: [
    { phc_id: "MH-PUNE-PHC-003", medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", current_stock: 40, daily_consumption: 22, beds_available: 3, doctors_present: 1, nurses_present: 2, patient_footfall: 110, timestamp: new Date().toISOString() },
    { phc_id: "MH-PUNE-PHC-011", medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", current_stock: 620, daily_consumption: 15, beds_available: 8, doctors_present: 3, nurses_present: 5, patient_footfall: 75, timestamp: new Date().toISOString() },
    { phc_id: "MH-PUNE-PHC-001", medicine_id: "PARACETAMOL_500", medicine_name: "Paracetamol 500mg Tablets", current_stock: 120, daily_consumption: 45, beds_available: 4, doctors_present: 2, nurses_present: 3, patient_footfall: 95, timestamp: new Date().toISOString() },
    { phc_id: "BR-PATNA-PHC-009", medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", current_stock: 35, daily_consumption: 18, beds_available: 2, doctors_present: 1, nurses_present: 2, patient_footfall: 130, timestamp: new Date().toISOString() },
    { phc_id: "BR-PATNA-PHC-004", medicine_id: "ORS", medicine_name: "ORS Packets (Oral Rehydration)", current_stock: 450, daily_consumption: 12, beds_available: 6, doctors_present: 2, nurses_present: 4, patient_footfall: 60, timestamp: new Date().toISOString() },
    { phc_id: "TN-MDU-PHC-001", medicine_id: "INSULIN_REGULAR", medicine_name: "Insulin Regular (100IU/ml)", current_stock: 6, daily_consumption: 4, beds_available: 5, doctors_present: 2, nurses_present: 3, patient_footfall: 88, timestamp: new Date().toISOString() },
    { phc_id: "TN-MDU-PHC-005", medicine_id: "INSULIN_REGULAR", medicine_name: "Insulin Regular (100IU/ml)", current_stock: 85, daily_consumption: 3, beds_available: 7, doctors_present: 2, nurses_present: 4, patient_footfall: 65, timestamp: new Date().toISOString() }
  ],
  transfers: []
};

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "SwasthyaSetu AI API", version: "1.0.0" });
});

app.get("/meta", (req, res) => {
  res.json({ phcs: PHC_DIRECTORY, medicines: ESSENTIAL_MEDICINES });
});

// GET /dashboard
app.get("/dashboard", async (req, res) => {
  try {
    let records = [];
    if (db) {
      try {
        const snap = await db.collection("current_inventory").limit(50).get();
        if (!snap.empty) records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (err) {
        console.warn("Firestore read fallback:", err.message);
      }
    }
    if (records.length === 0) records = memoryStore.inventory;

    let criticalCount = 0;
    let warningCount = 0;
    let totalBeds = 0;
    let totalDoctors = 0;

    const enriched = records.map(item => {
      const consumption = Number(item.daily_consumption) || 1;
      const stock = Number(item.current_stock) || 0;
      const daysRemaining = Math.round((stock / consumption) * 10) / 10;
      let riskLevel = "STABLE";
      if (daysRemaining <= 3) { riskLevel = "CRITICAL"; criticalCount++; }
      else if (daysRemaining <= 7) { riskLevel = "WARNING"; warningCount++; }
      totalBeds += Number(item.beds_available) || 0;
      totalDoctors += Number(item.doctors_present) || 0;
      const phcMeta = PHC_DIRECTORY.find(p => p.id === item.phc_id) || {};
      return {
        ...item,
        days_remaining: daysRemaining,
        risk_level: riskLevel,
        phc_name: phcMeta.name || item.phc_id,
        district: phcMeta.district || "Pune",
        state: phcMeta.state || "Maharashtra",
        lat: phcMeta.lat,
        lng: phcMeta.lng
      };
    });

    res.json({
      summary: {
        total_phcs_monitored: new Set(records.map(r => r.phc_id)).size || PHC_DIRECTORY.length,
        critical_stockouts: criticalCount,
        potential_stockouts_7d: warningCount,
        beds_available: totalBeds,
        doctors_on_duty: totalDoctors,
        approved_transfers: memoryStore.transfers.length
      },
      inventory: enriched
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /phcUpdate
app.post("/phcUpdate", async (req, res) => {
  try {
    const {
      phc_id,
      medicine_id,
      medicine_name,
      current_stock,
      daily_consumption,
      beds_available,
      doctors_present,
      nurses_present,
      patient_footfall,
      notes
    } = req.body;

    if (!phc_id || !medicine_id) {
      return res.status(400).json({ error: "Missing required fields: phc_id and medicine_id" });
    }

    const payload = {
      phc_id,
      medicine_id,
      medicine_name: medicine_name || medicine_id,
      current_stock: Number(current_stock) || 0,
      daily_consumption: Number(daily_consumption) || 0,
      beds_available: Number(beds_available) || 0,
      doctors_present: Number(doctors_present) || 0,
      nurses_present: Number(nurses_present) || 0,
      patient_footfall: Number(patient_footfall) || 0,
      notes: notes || "",
      timestamp: new Date().toISOString()
    };

    const idx = memoryStore.inventory.findIndex(
      item => item.phc_id === phc_id && item.medicine_id === medicine_id
    );
    if (idx >= 0) {
      memoryStore.inventory[idx] = { ...memoryStore.inventory[idx], ...payload };
    } else {
      memoryStore.inventory.unshift(payload);
    }

    let firestoreSaved = false;
    if (db) {
      try {
        const docId = `${phc_id}_${medicine_id}`;
        await db.collection("current_inventory").doc(docId).set(payload, { merge: true });
        await db.collection("inventory_history").add(payload);
        firestoreSaved = true;
      } catch (err) {
        console.warn("Firestore save warning:", err.message);
      }
    }

    res.status(200).json({
      success: true,
      message: "PHC inventory update recorded successfully",
      saved_to_firestore: firestoreSaved,
      record: payload
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /alerts
app.get("/alerts", (req, res) => {
  try {
    const alerts = [];
    memoryStore.inventory.forEach(item => {
      const consumption = Number(item.daily_consumption) || 1;
      const stock = Number(item.current_stock) || 0;
      const daysRemaining = Math.round((stock / consumption) * 10) / 10;
      const phcMeta = PHC_DIRECTORY.find(p => p.id === item.phc_id) || { name: item.phc_id, district: "General" };

      if (daysRemaining <= 3) {
        alerts.push({
          id: `ALERT-MED-${item.phc_id}-${item.medicine_id}`,
          type: "STOCKOUT_CRITICAL",
          severity: "CRITICAL",
          phc_id: item.phc_id,
          phc_name: phcMeta.name,
          district: phcMeta.district,
          medicine_id: item.medicine_id,
          medicine_name: item.medicine_name,
          current_stock: stock,
          daily_consumption: consumption,
          days_remaining: daysRemaining,
          message: `${item.medicine_name} will run out in ${daysRemaining} days at ${phcMeta.name} (${stock} units left). Immediate redistribution recommended.`
        });
      } else if (daysRemaining <= 7) {
        alerts.push({
          id: `ALERT-MED-${item.phc_id}-${item.medicine_id}`,
          type: "STOCKOUT_WARNING",
          severity: "WARNING",
          phc_id: item.phc_id,
          phc_name: phcMeta.name,
          district: phcMeta.district,
          medicine_id: item.medicine_id,
          medicine_name: item.medicine_name,
          current_stock: stock,
          daily_consumption: consumption,
          days_remaining: daysRemaining,
          message: `${item.medicine_name} running low at ${phcMeta.name}: ${daysRemaining} days of stock remaining.`
        });
      }

      if (Number(item.beds_available) <= 2) {
        alerts.push({
          id: `ALERT-BED-${item.phc_id}`,
          type: "BED_CAPACITY_CRITICAL",
          severity: "HIGH",
          phc_id: item.phc_id,
          phc_name: phcMeta.name,
          district: phcMeta.district,
          beds_available: item.beds_available,
          message: `Only ${item.beds_available} beds available at ${phcMeta.name}. Footfall is ${item.patient_footfall} patients/day.`
        });
      }
    });

    res.json({ total_alerts: alerts.length, alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /recommendation
app.post("/recommendation", (req, res) => {
  try {
    const { phc_id, medicine_id } = req.body;
    const target = memoryStore.inventory.find(
      i => (!phc_id || i.phc_id === phc_id) && (!medicine_id || i.medicine_id === medicine_id)
    ) || memoryStore.inventory[0];

    if (!target) {
      return res.status(404).json({ error: "No inventory record found for recommendation" });
    }

    const targetPhcMeta = PHC_DIRECTORY.find(p => p.id === target.phc_id) || {
      id: target.phc_id,
      name: target.phc_id,
      district: "Pune",
      lat: 18.5204,
      lng: 73.8567
    };

    const medMeta = ESSENTIAL_MEDICINES.find(m => m.id === target.medicine_id) || {
      id: target.medicine_id,
      name: target.medicine_name,
      safetyStock: 100
    };

    const targetDailyNeed = Number(target.daily_consumption) || 20;
    const deficitQuantity = Math.max(0, (targetDailyNeed * 10) - Number(target.current_stock));

    const donors = memoryStore.inventory
      .filter(item => item.medicine_id === target.medicine_id && item.phc_id !== target.phc_id)
      .map(item => {
        const donorMeta = PHC_DIRECTORY.find(p => p.id === item.phc_id) || {
          id: item.phc_id,
          name: item.phc_id,
          district: targetPhcMeta.district,
          lat: targetPhcMeta.lat + 0.1,
          lng: targetPhcMeta.lng + 0.1
        };
        const surplus = Math.max(0, Number(item.current_stock) - medMeta.safetyStock);
        const distance = calculateDistanceKm(targetPhcMeta.lat, targetPhcMeta.lng, donorMeta.lat, donorMeta.lng);
        return {
          source_phc_id: item.phc_id,
          source_phc_name: donorMeta.name,
          source_district: donorMeta.district,
          source_current_stock: item.current_stock,
          source_surplus: surplus,
          distance_km: distance,
          same_district: donorMeta.district === targetPhcMeta.district
        };
      })
      .filter(d => d.source_surplus > 0)
      .sort((a, b) => {
        if (a.same_district && !b.same_district) return -1;
        if (!a.same_district && b.same_district) return 1;
        return a.distance_km - b.distance_km;
      });

    if (donors.length === 0) {
      return res.json({
        recommended: false,
        message: "No neighboring PHC currently has sufficient surplus above safety threshold. Direct district warehouse re-supply needed."
      });
    }

    const optimalSource = donors[0];
    const transferQty = Math.min(deficitQuantity > 0 ? deficitQuantity : 250, optimalSource.source_surplus);

    const recommendation = {
      recommended: true,
      shortage_phc: target.phc_id,
      shortage_phc_name: targetPhcMeta.name,
      destination_district: targetPhcMeta.district,
      medicine: target.medicine_name,
      medicine_id: target.medicine_id,
      required_quantity: deficitQuantity || 250,
      recommended_source: optimalSource.source_phc_id,
      source_phc_name: optimalSource.source_phc_name,
      source_surplus: optimalSource.source_surplus,
      distance_km: optimalSource.distance_km,
      recommended_transfer: transferQty,
      estimated_coverage_days: Math.round(transferQty / (targetDailyNeed || 1)),
      rationale: `Optimal transfer of ${transferQty} units from ${optimalSource.source_phc_name} (${optimalSource.distance_km} km away in ${optimalSource.source_district}) covers ${targetPhcMeta.name} for ~${Math.round(transferQty / targetDailyNeed)} days.`
    };

    res.json(recommendation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /approveTransfer
app.post("/approveTransfer", (req, res) => {
  try {
    const { source_phc_id, destination_phc_id, medicine_id, quantity, approved_by } = req.body;
    const transferRecord = {
      transfer_id: `TRF-${Date.now()}`,
      source_phc_id,
      destination_phc_id,
      medicine_id,
      quantity: Number(quantity) || 100,
      approved_by: approved_by || "District Health Officer",
      vehicle_dispatch_id: `DL-MED-${Math.floor(1000 + Math.random() * 9000)}`,
      status: "APPROVED_IN_TRANSIT",
      timestamp: new Date().toISOString()
    };
    memoryStore.transfers.unshift(transferRecord);
    res.json({
      success: true,
      message: "Transfer order approved and dispatched into state logistics network.",
      transfer: transferRecord
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /explainAlert
app.post("/explainAlert", async (req, res) => {
  try {
    const { alertData, language = "English" } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (apiKey) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `
You are an AI assistant for a District Health Officer in India.
Analyze this health resource alert data:
${JSON.stringify(alertData, null, 2)}
Output valid JSON with keys:
- "explanation": Crisp 2-sentence diagnostic of the stockout risk.
- "action_recommendation": Concrete supply chain redistribution action.
- "phc_sms_message": Short SMS/WhatsApp dispatch note for the PHC Medical Officer.
- "local_language_message": The same note translated into ${language}.
`;
        const result = await model.generateContent(prompt);
        const cleaned = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        return res.json({ source: "Google Gemini 1.5 Flash", ...JSON.parse(cleaned) });
      } catch (geminiError) {
        console.warn("Gemini call fallback:", geminiError.message);
      }
    }

    const phcName = alertData?.phc_name || alertData?.phc_id || "Baramati PHC";
    const medName = alertData?.medicine_name || alertData?.medicine_id || "ORS Packets";
    const days = alertData?.days_remaining || 2;
    const footfall = alertData?.patient_footfall || 110;

    const fallbackTranslations = {
      Hindi: `कृपया कल सुबह तक निकटतम उप-जिला डिपो से आवश्यक आपूर्ति प्राप्त करने की तैयारी करें। वर्तमान स्टॉक केवल ${days} दिन चलेगा।`,
      Tamil: `தயவுசெய்து நாளைய தினத்திற்குள் அருகிலுள்ள சுகாதார மையத்திலிருந்து மருந்து இருப்பை பெற ஏற்பாடு செய்யுங்கள். இருப்பு ${days} நாட்களில் தீர்ந்துவிடும்.`,
      Marathi: `कृपया उद्यापर्यंत जवळच्या उप-जिल्हा केंद्रातून आवश्यक साठा प्राप्त करण्याची तयारी ठेवा. चालू साठा केवळ ${days} दिवस पुरेल.`,
      Bengali: `অনুগ্রহ করে আগামীকালের মধ্যে নিকটস্থ কেন্দ্র থেকে প্রয়োজনীয় ওষুধ সরবরাহের প্রস্তুতি নিন। বর্তমান মজুদ মাত্র ${days} দিন চলবে।`
    };

    res.json({
      source: "SwasthyaSetu AI Engine",
      explanation: `${phcName} is facing a severe deficit of ${medName} with only ${days} days of inventory remaining amidst high patient footfall (${footfall} patients/day).`,
      action_recommendation: `Initiate automated cross-district transfer of 250-300 units from nearby surplus depot to prevent complete stockout.`,
      phc_sms_message: `URGENT: Stockout alert for ${medName} at ${phcName}. Buffer replenishment dispatched. Current stock expected to deplete in ${days} days.`,
      local_language_message: fallbackTranslations[language] || fallbackTranslations.Hindi,
      urgency: days <= 3 ? "CRITICAL" : "HIGH"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /translate
app.post("/translate", async (req, res) => {
  try {
    const { text, targetLanguage = "Hindi" } = req.body;
    const dict = {
      Hindi: { "SwasthyaSetu AI": "स्वास्थ्यसेतु एआई", "National PHC Grid": "राष्ट्रीय प्राथमिक स्वास्थ्य केंद्र ग्रिड", "Stockout Alert": "स्टॉक समाप्ति चेतावनी" },
      Tamil: { "SwasthyaSetu AI": "சுவஸ்த்யா சேது ஏஐ", "National PHC Grid": "தேசிய ஆரம்ப சுகாதார கட்டமைப்பு", "Stockout Alert": "மருந்து பற்றாக்குறை எச்சரிக்கை" },
      Marathi: { "SwasthyaSetu AI": "स्वास्थ्यसेतू एआय", "National PHC Grid": "राष्ट्रीय प्राथमिक आरोग्य केंद्र ग्रिड", "Stockout Alert": "साठा संपण्याची चेतावणी" }
    };
    const translated = dict[targetLanguage]?.[text] || `[${targetLanguage}] ${text}`;
    res.json({ original: text, targetLanguage, translated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

exports.api = functions.https.onRequest(app);
exports.app = app;

