import { useEffect, useState } from "react";
import { explainAlert, generateTransferRecommendation, getAlertsData, getTransferTrackingData } from "../services/api";
import "./AlertsPage.css";

const format = (value, digits = 0) => new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: digits,
  minimumFractionDigits: digits
}).format(Number(value) || 0);
const riskRank = { CRITICAL: 0, WARNING: 1, STABLE: 2 };

function AlertsPage({ onTransferGenerated, onRaiseTransferRequest, permissions }) {
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stateFilter, setStateFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("action");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [transferStatuses, setTransferStatuses] = useState({});
  const [planLoadingKey, setPlanLoadingKey] = useState("");
  const [transferNotice, setTransferNotice] = useState(null);
  const [alertExplanations, setAlertExplanations] = useState({});
  const [explanationLoadingKey, setExplanationLoadingKey] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAlertsData()
      .then((rows) => {
        if (active) {
          setAlerts(rows);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load stock-out alerts.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    getTransferTrackingData()
      .then(({ recommendations, transfers }) => {
        if (!active) return;
        const transferByRecommendation = new Map(transfers
          .filter((transfer) => transfer.recommendation_id)
          .map((transfer) => [transfer.recommendation_id, transfer]));
        const newestFirst = [...recommendations].sort((left, right) =>
          new Date(right.created_at || right.approved_at || 0) - new Date(left.created_at || left.approved_at || 0));
        const statuses = {};
        newestFirst.forEach((recommendation) => {
          const key = `${recommendation.destination_phc_id || recommendation.shortage_phc}_${recommendation.medicine_id}`;
          const transfer = transferByRecommendation.get(recommendation.recommendation_id);
          if (!statuses[key]) statuses[key] = transfer?.status || recommendation.status;
        });
        setTransferStatuses(statuses);
      })
      .catch(() => { if (active) setTransferStatuses({}); });
    return () => { active = false; };
  }, [refreshKey]);

  async function handleGeneratePlan(row) {
    const key = `${row.phc_id}-${row.medicine_id}`;
    setPlanLoadingKey(key);
    setTransferNotice(null);
    try {
      const result = await generateTransferRecommendation({ phc_id: row.phc_id, medicine_id: row.medicine_id });
      if (!result.recommended) {
        setTransferNotice({ kind: "info", text: result.message || "No transfer plan is available." });
      } else if (result.saved_to_firestore === false) {
        setTransferNotice({ kind: "error", text: `The transfer was generated but could not be saved: ${result.firestore_error || "Firestore unavailable"}` });
      } else {
        onTransferGenerated?.();
      }
    } catch (requestError) {
      setTransferNotice({ kind: "error", text: requestError.message || "Could not generate a transfer plan." });
    } finally {
      setPlanLoadingKey("");
    }
  }

  async function handleExplainAlert(row) {
    const key = `${row.phc_id}-${row.medicine_id}`;
    if (explanationLoadingKey === key) return;

    setExplanationLoadingKey(key);
    try {
      const languageName = selectedLanguage === "hi" ? "Hindi" : selectedLanguage === "ta" ? "Tamil" : "English";
      const response = await explainAlert(
        row,
        {
          source_phc_id: "NEARBY-SURPLUS-PHC",
          quantity: 250,
          distance_km: 18.4
        },
        languageName
      );

      const rawText = response?.explanation || response?.text || response?.phc_sms_message || "No clear explanation is available for this alert right now.";
      setAlertExplanations((current) => ({ ...current, [key]: rawText }));
    } catch (requestError) {
      setAlertExplanations((current) => ({
        ...current,
        [key]: requestError.message || "The AI explanation could not be generated at the moment."
      }));
    } finally {
      setExplanationLoadingKey("");
    }
  }

  const states = [...new Set(alerts.map((row) => row.state).filter(Boolean))].sort();
  const districts = [...new Set(alerts
    .filter((row) => stateFilter === "all" || row.state === stateFilter)
    .map((row) => row.district).filter(Boolean))].sort();
  const filteredAlerts = alerts
    .filter((row) => stateFilter === "all" || row.state === stateFilter)
    .filter((row) => districtFilter === "all" || row.district === districtFilter)
    .filter((row) => riskFilter === "all" || row.risk_level !== "STABLE")
    .filter((row) => `${row.phc_name} ${row.phc_id} ${row.medicine_name} ${row.medicine_id} ${row.district} ${row.state}`
      .toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => riskRank[left.risk_level] - riskRank[right.risk_level] ||
      (left.days_remaining ?? Infinity) - (right.days_remaining ?? Infinity));
  const pageCount = Math.max(1, Math.ceil(filteredAlerts.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleAlerts = filteredAlerts.slice(currentPage * 50, (currentPage + 1) * 50);

  const critical = alerts.filter((row) => row.risk_level === "CRITICAL").length;
  const warning = alerts.filter((row) => row.risk_level === "WARNING").length;
  const stable = alerts.filter((row) => row.risk_level === "STABLE").length;
  const affectedAreas = new Set(alerts
    .filter((row) => row.risk_level !== "STABLE")
    .map((row) => `${row.district}, ${row.state}`)).size;

  return (
    <main className="alerts-page">
      <section className="alerts-heading">
        <div>
          <p className="alerts-eyebrow">PUBLIC HEALTH · STOCK RISK</p>
          <h1>Medicine alerts</h1>
          <p className="alerts-subtitle">Seven-day demand forecasts, grouped by facility area.</p>
        </div>
        <div className="alerts-heading-actions">
          <label className="language-select-wrap">
            <span>Language</span>
            <select value={selectedLanguage} onChange={(event) => setSelectedLanguage(event.target.value)}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="ta">Tamil</option>
            </select>
          </label>
          <button className="alerts-refresh" type="button" disabled={loading} onClick={() => setRefreshKey((key) => key + 1)}>
            {loading ? "Loading..." : "Refresh alerts"}
          </button>
        </div>
      </section>

      {error && <div className="alerts-error" role="alert">{error}</div>}
      {transferNotice && <div className={`alerts-transfer-notice ${transferNotice.kind}`} role="status"><span>{transferNotice.text}</span><button type="button" onClick={() => setTransferNotice(null)}>Dismiss</button></div>}

      <section className="alerts-metrics" aria-label="Alert totals">
        <article className="alert-metric critical-metric"><span>Critical</span><strong>{loading && !alerts.length ? "—" : format(critical)}</strong><small>3 days of stock or less</small></article>
        <article className="alert-metric warning-metric"><span>Warning</span><strong>{loading && !alerts.length ? "—" : format(warning)}</strong><small>More than 3, up to 7 days</small></article>
        <article className="alert-metric stable-metric"><span>Stable</span><strong>{loading && !alerts.length ? "—" : format(stable)}</strong><small>More than 7 days of stock</small></article>
        <article className="alert-metric area-metric"><span>Areas needing attention</span><strong>{loading && !alerts.length ? "—" : format(affectedAreas)}</strong><small>Districts with critical or warning stock</small></article>
      </section>

      <section className="alerts-table-section">
        <div className="alerts-toolbar">
          <div className="alerts-table-title">
            <h2>Stock-out risk by facility</h2>
            <p>{format(filteredAlerts.length)} records</p>
          </div>
          <div className="alert-filters">
            <label><span>State</span><select value={stateFilter} onChange={(event) => { setStateFilter(event.target.value); setDistrictFilter("all"); setPage(0); }}>
              <option value="all">All states</option>{states.map((state) => <option key={state} value={state}>{state}</option>)}
            </select></label>
            <label><span>District</span><select value={districtFilter} onChange={(event) => { setDistrictFilter(event.target.value); setPage(0); }}>
              <option value="all">All districts</option>{districts.map((district) => <option key={district} value={district}>{district}</option>)}
            </select></label>
            <label><span>Risk</span><select value={riskFilter} onChange={(event) => { setRiskFilter(event.target.value); setPage(0); }}>
              <option value="action">Needs attention</option><option value="all">All levels</option>
            </select></label>
            <label className="alert-search"><span>Search</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Facility or medicine" /></label>
          </div>
        </div>

        <div className="alerts-table-scroll">
          <table className="alerts-table">
            <thead><tr><th>Facility</th><th>Area</th><th>Medicine</th><th>Stock</th><th>Forecast / day</th><th>Days remaining</th><th>Risk</th><th>Why this alert?</th><th>Action</th></tr></thead>
            <tbody>
              {loading && !alerts.length ? <tr><td colSpan="9" className="alerts-empty">Loading forecast-based alerts...</td></tr> :
                visibleAlerts.length ? visibleAlerts.map((row) => {
                  const alertKey = `${row.phc_id}-${row.medicine_id}`;
                  const explanation = alertExplanations[alertKey];
                  const transferState = transferStatuses[`${row.phc_id}_${row.medicine_id}`];
                  return (
                    <tr key={alertKey}>
                      <td><strong>{row.phc_name || row.phc_id}</strong><small>{row.phc_id}</small></td>
                      <td><strong>{row.district || "—"}</strong><small>{row.state || "—"}</small></td>
                      <td><strong>{row.medicine_name || row.medicine_id}</strong><small>{row.medicine_id}</small></td>
                      <td className="alerts-number">{format(row.current_stock)}</td>
                      <td className="alerts-number">{format(row.predicted_daily_demand, 2)}</td>
                      <td className="alerts-number">{row.days_remaining == null ? "—" : format(row.days_remaining, 2)}</td>
                      <td><span className={`alert-risk risk-${String(row.risk_level || "stable").toLowerCase()}`}>{row.risk_level || "STABLE"}</span></td>
                      <td>
                        <div className="alert-explain-wrap">
                          <button
                            type="button"
                            className="alert-explain-button"
                            onClick={() => handleExplainAlert(row)}
                            disabled={explanationLoadingKey === alertKey}
                            aria-label={`Why this alert for ${row.medicine_name || row.medicine_id}`}
                          >
                            {explanationLoadingKey === alertKey ? "..." : "?"}
                          </button>
                          {explanation && <div className="alert-explain-text">{explanation}</div>}
                        </div>
                      </td>
                      <td>
                        {row.risk_level === "STABLE" ? "Monitor" : transferState ? (
                          <span className={`alerts-generated alerts-generated-${String(transferState).toLowerCase()}`}>
                            {transferState === "PROPOSED" ? "Approval Raised" :
                              ["APPROVED_IN_TRANSIT", "IN_TRANSIT"].includes(transferState) ? "In Transit" :
                              ["COMPLETED", "DELIVERED"].includes(transferState) ? "Completed" :
                              transferState === "REJECTED" ? "Rejected" : "Request Raised"}
                          </span>
                        ) : permissions?.canGenerateTransferPlan ? (
                          <button type="button" className="alerts-generate-plan" disabled={Boolean(planLoadingKey)} onClick={() => handleGeneratePlan(row)}>
                            {planLoadingKey === alertKey ? "Finding source..." : "Generate Transfer Plan"}
                          </button>
                        ) : permissions?.canRaiseTransferRequest ? (
                          <button type="button" className="alerts-generate-plan" onClick={() => onRaiseTransferRequest?.(row)}>
                            Raise Transfer Request
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan="9" className="alerts-empty">{error ? "Alerts could not be loaded." : "No records match these filters."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="alerts-table-footer">
          <span>Demand source: average forecast for the next 7 days</span>
          <div className="alerts-pagination" aria-label="Alerts pagination">
            <button type="button" className="pagination-button" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>Previous</button>
            <span>{filteredAlerts.length ? `Page ${currentPage + 1} of ${pageCount}` : "Page 0 of 0"}</span>
            <button type="button" className="pagination-button" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>Next</button>
          </div>
          <span>Risk order: critical, warning, stable</span>
        </div>
      </section>
    </main>
  );
}

export default AlertsPage;
