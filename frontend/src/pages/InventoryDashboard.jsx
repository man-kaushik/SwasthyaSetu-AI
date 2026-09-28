import { useEffect, useState } from "react";
import { getDashboardData } from "../services/api";
import "./InventoryDashboard.css";

const number = (value) => new Intl.NumberFormat("en-IN").format(Number(value) || 0);

function InventoryDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

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

  const summary = dashboard?.summary || {};
  const inventory = dashboard?.inventory || [];
  const filteredInventory = inventory.filter((row) =>
    `${row.phc_name} ${row.phc_id} ${row.medicine_name} ${row.medicine_id}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const source = summary.data_source?.inventory_source || "unavailable";
  const pageCount = Math.max(1, Math.ceil(filteredInventory.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleInventory = filteredInventory.slice(currentPage * 50, (currentPage + 1) * 50);

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

      <section className="metric-grid" aria-label="Inventory summary">
        <article className="metric metric-green">
          <span className="metric-label">PHCs monitored</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(summary.total_phcs_monitored)}</strong>
          <span className="metric-note">of {(loading || error) && !dashboard ? "—" : number(summary.total_phc_directory)} in directory</span>
        </article>
        <article className="metric metric-blue">
          <span className="metric-label">Medicine records</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(summary.total_medicine_records)}</strong>
          <span className="metric-note">current inventory snapshot</span>
        </article>
        <article className="metric metric-red">
          <span className="metric-label">Critical stock risks</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(summary.critical_stockouts)}</strong>
          <span className="metric-note">at 3 days of stock or less</span>
        </article>
        <article className="metric metric-amber">
          <span className="metric-label">Beds available</span>
          <strong>{(loading || error) && !dashboard ? "—" : number(summary.beds_available)}</strong>
          <span className="metric-note">across reporting facilities</span>
        </article>
      </section>

      <section className="inventory-section">
        <div className="inventory-toolbar">
          <div>
            <h2>Current medicine stock</h2>
            <p>{number(filteredInventory.length)} records</p>
          </div>
          <label className="search-field">
            <span className="search-label">Filter records</span>
            <input
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              placeholder="Facility or medicine"
            />
          </label>
        </div>
        <div className="table-scroll">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Facility</th>
                <th>Medicine</th>
                <th>In stock</th>
                <th>Daily use</th>
                <th>Days left</th>
                <th>Beds</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {loading && !dashboard ? (
                <tr><td className="table-message" colSpan="7">Loading inventory from BigQuery...</td></tr>
              ) : visibleInventory.length ? visibleInventory.map((row, index) => (
                <tr key={`${row.phc_id}-${row.medicine_id}-${index}`}>
                  <td>
                    <span className="facility-name">{row.phc_name || row.phc_id}</span>
                    <span className="facility-meta">{row.district || row.phc_id} · {row.state || "India"}</span>
                  </td>
                  <td>
                    <span className="medicine-name">{row.medicine_name || row.medicine_id}</span>
                    <span className="facility-meta">{row.medicine_id}</span>
                  </td>
                  <td className="numeric-cell">{number(row.current_stock)}</td>
                  <td className="numeric-cell">{number(row.daily_consumption)}</td>
                  <td className="numeric-cell">{number(row.days_remaining)}</td>
                  <td className="numeric-cell">{number(row.beds_available)}</td>
                  <td><span className={`risk-tag risk-${String(row.risk_level || "stable").toLowerCase()}`}>{row.risk_level || "STABLE"}</span></td>
                </tr>
                )) : (
                <tr><td className="table-message" colSpan="7">{error ? "Inventory could not be loaded." : "No matching inventory records."}</td></tr>
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
