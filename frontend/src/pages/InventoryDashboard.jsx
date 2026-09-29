import { useEffect, useState } from "react";
import { generateTransferRecommendation, getDashboardData, getTransferTrackingData } from "../services/api";
import "./InventoryDashboard.css";

const number = (value) => new Intl.NumberFormat("en-IN").format(Number(value) || 0);
const decimal = (value, digits = 1) => value == null || !Number.isFinite(Number(value))
  ? "—"
  : new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(Number(value));

function riskCategory(row) {
  const risk = String(row.risk_level || "").toUpperCase();
  const daysRemaining = Number(row.forecast_days_remaining ?? row.days_remaining);
  if (["CRITICAL", "STOCKED_OUT"].includes(risk) || daysRemaining <= 3) return "critical";
  if (["WARNING", "HIGH"].includes(risk) || daysRemaining <= 7) return "warning";
  return "stable";
}

function InventoryDashboard({ onTransferGenerated }) {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingTransfers, setPendingTransfers] = useState(null);
  const [transferStatuses, setTransferStatuses] = useState({});
  const [planLoadingKey, setPlanLoadingKey] = useState("");
  const [transferNotice, setTransferNotice] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDashboardData()
      .then((data) => {
        if (active) {
          setDashboard(data);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load inventory data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reloadKey]);

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
          const status = transfer?.status || recommendation.status;
          if (!statuses[key]) statuses[key] = status;
        });
        setTransferStatuses(statuses);
        setPendingTransfers(recommendations.filter((recommendation) => {
          const transfer = transferByRecommendation.get(recommendation.recommendation_id);
          return (transfer?.status || recommendation.status) === "PROPOSED";
        }).length);
      })
      .catch(() => {
        if (active) setPendingTransfers(null);
      });
    return () => { active = false; };
  }, [reloadKey]);

  const summary = dashboard?.summary || {};
  const inventory = dashboard?.inventory || [];
  const criticalCount = inventory.filter((row) => riskCategory(row) === "critical").length;
  const warningCount = inventory.filter((row) => riskCategory(row) === "warning").length;
  const filteredInventory = inventory.filter((row) =>
    `${row.phc_name} ${row.phc_id} ${row.district} ${row.medicine_name} ${row.medicine_id}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const source = summary.data_source?.inventory_source || "unavailable";
  const pageCount = Math.max(1, Math.ceil(filteredInventory.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleInventory = filteredInventory.slice(currentPage * 50, (currentPage + 1) * 50);

  const transferStatusLabel = {
    PROPOSED: "Approval Raised",
    APPROVED_IN_TRANSIT: "In Transit",
    IN_TRANSIT: "In Transit",
    COMPLETED: "Completed",
    DELIVERED: "Completed",
    REJECTED: "Rejected"
  };

  async function handleGeneratePlan(row) {
    const rowKey = `${row.phc_id}-${row.medicine_id}`;
    setPlanLoadingKey(rowKey);
    setTransferNotice(null);
    try {
      const result = await generateTransferRecommendation({ phc_id: row.phc_id, medicine_id: row.medicine_id });
      if (!result.recommended) {
        setTransferNotice({ kind: "info", text: result.message || "No transfer plan is available." });
      } else if (result.saved_to_firestore === false) {
        setTransferNotice({ kind: "error", text: `The transfer was generated but could not be saved to tracking: ${result.firestore_error || "Firestore unavailable"}` });
      } else {
        onTransferGenerated?.();
      }
    } catch (requestError) {
      setTransferNotice({ kind: "error", text: requestError.message || "Could not generate a transfer plan." });
    } finally {
      setPlanLoadingKey("");
    }
  }

  return (
    <main className="dashboard">
      <section className="dashboard-heading">
        <div>
          <p className="eyebrow">PUBLIC HEALTH · LIVE OPERATIONS</p>
          <h1>Inventory overview</h1>
          <p className="dashboard-subtitle">Medicine availability across the primary health centre network.</p>
        </div>
        <div className="heading-actions">
          <span className={`source-tag source-${source}`}>
            <span className="source-dot" />
            {source === "bigquery" ? "BigQuery live" : source === "memory" ? "Seed data" : source}
          </span>
          <button className="refresh-button" type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
            {loading ? "Loading..." : "Refresh data"}
          </button>
        </div>
      </section>

      {error && (
        <div className="dashboard-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
        </div>
      )}

      <section className="metric-grid" aria-label="Operations summary">
        <article className="metric metric-green">
          <span className="metric-label">Total PHCs</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(summary.total_phcs_monitored)}</strong>
          <span className="metric-note">of {(loading || error) && !dashboard ? "—" : number(summary.total_phc_directory)} in directory</span>
        </article>
        <article className="metric metric-red">
          <span className="metric-label">Critical alerts</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(criticalCount)}</strong>
          <span className="metric-note">at 3 days of stock or less</span>
        </article>
        <article className="metric metric-amber">
          <span className="metric-label">Warning alerts</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(warningCount)}</strong>
          <span className="metric-note">up to 7 days of stock</span>
        </article>
        <article className="metric metric-blue">
          <span className="metric-label">Beds available</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(summary.beds_available)}</strong>
          <span className="metric-note">across reporting facilities</span>
        </article>
        <article className="metric metric-red">
          <span className="metric-label">Staff shortage alerts</span>
          <strong>{(loading || error) && !dashboard ? "—" : summary.facility_staff_shortages == null ? "—" : number(summary.facility_staff_shortages)}</strong>
          <span className="metric-note">facilities with no doctors reported</span>
        </article>
        <article className="metric metric-blue">
          <span className="metric-label">Transfers pending</span>
          <strong>{pendingTransfers == null ? "—" : number(pendingTransfers)}</strong>
          <span className="metric-note">requests awaiting approval</span>
        </article>
      </section>

      <section className="inventory-section">
        <div className="inventory-toolbar">
          <div>
            <h2>Stock-out risk by facility</h2>
            <p>{number(filteredInventory.length)} records</p>
          </div>
          <label className="search-field">
            <span className="search-label">Filter records</span>
            <input
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              placeholder="PHC, district or medicine"
            />
          </label>
        </div>
        {transferNotice && (
          <div className={`transfer-plan ${transferNotice.kind}`} role="status">
            <p>{transferNotice.text}</p>
            <button type="button" className="cancel-transfer-button" onClick={() => setTransferNotice(null)}>Dismiss</button>
          </div>
        )}
        <div className="table-scroll">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>PHC</th>
                <th>District</th>
                <th>Medicine</th>
                <th>Current stock</th>
                <th>Predicted demand/day</th>
                <th>Days remaining</th>
                <th>Risk</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && !dashboard ? (
                <tr><td className="table-message" colSpan="8">Loading inventory from BigQuery...</td></tr>
              ) : visibleInventory.length ? visibleInventory.map((row, index) => (
                <tr key={`${row.phc_id}-${row.medicine_id}-${index}`}>
                  <td>
                    <span className="facility-name">{row.phc_name || row.phc_id}</span>
                    <span className="facility-meta">{row.phc_id}</span>
                  </td>
                  <td>{row.district || "—"}</td>
                  <td>
                    <span className="medicine-name">{row.medicine_name || row.medicine_id}</span>
                    <span className="facility-meta">{row.medicine_id}</span>
                  </td>
                  <td className="numeric-cell">{number(row.current_stock)}</td>
                  <td className="numeric-cell">{decimal(row.forecast_daily_demand ?? row.daily_consumption, 2)}</td>
                  <td className="numeric-cell">{decimal(row.forecast_days_remaining ?? row.days_remaining, 2)}</td>
                  <td><span className={`risk-tag risk-${riskCategory(row)}`}>{riskCategory(row).toUpperCase()}</span></td>
                  <td className={`action-cell action-${riskCategory(row)}`}>
                    {riskCategory(row) === "stable" ? "Monitor" : transferStatusLabel[transferStatuses[`${row.phc_id}_${row.medicine_id}`]] ? (
                      <span className={`generated-request generated-${String(transferStatuses[`${row.phc_id}_${row.medicine_id}`]).toLowerCase()}`}>
                        {transferStatusLabel[transferStatuses[`${row.phc_id}_${row.medicine_id}`]]}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="generate-plan-button"
                        disabled={Boolean(planLoadingKey)}
                        onClick={() => handleGeneratePlan(row)}
                      >
                        {planLoadingKey === `${row.phc_id}-${row.medicine_id}` ? "Finding source..." : "Generate Transfer Plan"}
                      </button>
                    )}
                  </td>
                </tr>
                )) : (
                <tr><td className="table-message" colSpan="8">{error ? "Inventory could not be loaded." : "No matching inventory records."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>Source table: <code>swasthya_ai.current_inventory</code></span>
          <span>{number(summary.doctors_on_duty)} doctors · {number(summary.patient_footfall_today)} visits today</span>
          <div className="table-pagination" aria-label="Inventory pagination">
            <button type="button" className="pagination-button" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>Previous</button>
            <span>{filteredInventory.length ? `Page ${currentPage + 1} of ${pageCount}` : "Page 0 of 0"}</span>
            <button type="button" className="pagination-button" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>Next</button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default InventoryDashboard;
