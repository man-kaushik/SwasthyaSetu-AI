import { Fragment, useEffect, useState } from "react";
import { approveTransferPlan, completeTransferPlan, getTransferRequests, getTransferTrackingData, rejectTransferPlan, updateTransferRequestStatus } from "../services/api";
import TransferRequestDialog from "./TransferRequestDialog";
import "./TransferTrackingPage.css";

const format = (value) => new Intl.NumberFormat("en-IN").format(Number(value) || 0);
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

function statusLabel(status) {
  if (status === "PROPOSED") return "Transfer generated · waiting for approval";
  if (status === "APPROVED_IN_TRANSIT" || status === "IN_TRANSIT") return "In transit";
  if (status === "COMPLETED" || status === "DELIVERED") return "Completed Transfer";
  if (status === "REJECTED") return "Rejected";
  return status || "Unknown";
}

function statusStep(status) {
  if (status === "COMPLETED" || status === "DELIVERED") return 2;
  if (status === "APPROVED_IN_TRANSIT" || status === "IN_TRANSIT") return 1;
  if (status === "REJECTED") return 3;
  return 0;
}

function TransferTrackingPage({ currentUser, permissions }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState("");
  const [actionId, setActionId] = useState("");
  const [actionNotice, setActionNotice] = useState(null);
  const [requests, setRequests] = useState([]);
  const [requestLoading, setRequestLoading] = useState(true);
  const [requestError, setRequestError] = useState("");
  const [requestActionId, setRequestActionId] = useState("");
  const [requestNotice, setRequestNotice] = useState(null);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getTransferTrackingData()
      .then(({ recommendations, transfers }) => {
        if (!active) return;
        const transferByRecommendation = new Map(transfers
          .filter((transfer) => transfer.recommendation_id)
          .map((transfer) => [transfer.recommendation_id, transfer]));
        const tracked = recommendations.map((recommendation) => {
          const transfer = transferByRecommendation.get(recommendation.recommendation_id);
          return {
            ...recommendation,
            ...(transfer || {}),
            recommendation_id: recommendation.recommendation_id,
            status: transfer?.status || recommendation.status,
            source_phc_id: transfer?.source_phc_id || recommendation.source_phc_id,
            source_phc_name: transfer?.source_phc_name || recommendation.source_phc_name,
            destination_phc_id: transfer?.destination_phc_id || recommendation.destination_phc_id,
            destination_phc_name: transfer?.destination_phc_name || recommendation.shortage_phc_name,
            medicine: recommendation.medicine || recommendation.medicine_name || transfer?.medicine_id,
            quantity: transfer?.quantity ?? recommendation.quantity ?? recommendation.recommended_transfer,
            distance_km: transfer?.distance_km ?? recommendation.distance_km,
            last_updated: transfer?.timestamp || recommendation.approved_at || recommendation.created_at,
            transfer_id: transfer?.transfer_id || recommendation.transfer_id || "—"
          };
        });
        const knownRecommendations = new Set(recommendations.map((item) => item.recommendation_id));
        const transfersWithoutProposal = transfers
          .filter((transfer) => !transfer.recommendation_id || !knownRecommendations.has(transfer.recommendation_id))
          .map((transfer) => ({
            ...transfer,
            medicine: transfer.medicine_id,
            last_updated: transfer.timestamp,
            transfer_id: transfer.transfer_id
          }));
        setRows([...tracked, ...transfersWithoutProposal]
          .sort((left, right) => new Date(right.last_updated || 0) - new Date(left.last_updated || 0)));
        setError("");
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load transfer tracking.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    getTransferRequests(currentUser)
      .then((items) => {
        if (active) {
          setRequests(items);
          setRequestError("");
        }
      })
      .catch((requestError) => {
        if (active) setRequestError(requestError.message || "Could not load transfer requests.");
      })
      .finally(() => { if (active) setRequestLoading(false); });
    return () => { active = false; };
  }, [currentUser, reloadKey]);

  const filteredRows = rows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "proposed") return row.status === "PROPOSED";
    if (filter === "active") return ["APPROVED_IN_TRANSIT", "IN_TRANSIT"].includes(row.status);
    if (filter === "completed") return ["COMPLETED", "DELIVERED"].includes(row.status);
    if (filter === "rejected") return row.status === "REJECTED";
    return true;
  });
  const proposedCount = rows.filter((row) => row.status === "PROPOSED").length;
  const activeCount = rows.filter((row) => ["APPROVED_IN_TRANSIT", "IN_TRANSIT"].includes(row.status)).length;
  const completedCount = rows.filter((row) => ["COMPLETED", "DELIVERED"].includes(row.status)).length;
  const rejectedCount = rows.filter((row) => row.status === "REJECTED").length;
  const pendingRequestCount = requests.filter((request) => request.status === "pending").length;

  async function handleRequestReview(request, status) {
    setRequestActionId(request.id);
    setRequestNotice(null);
    try {
      const updated = await updateTransferRequestStatus(request, status, currentUser);
      setRequests((current) => current.map((item) => item.id === request.id ? updated : item));
      setRequestNotice({ kind: "success", text: `Request ${status}.` });
    } catch (requestActionError) {
      setRequestNotice({ kind: "error", text: requestActionError.message || "Could not update this request." });
    } finally {
      setRequestActionId("");
    }
  }

  function handleRequestSubmitted() {
    setRequestDialogOpen(false);
    setRequestLoading(true);
    setReloadKey((key) => key + 1);
  }

  async function handleApprove(row) {
    setActionId(row.recommendation_id);
    setActionNotice(null);
    try {
      const result = await approveTransferPlan(row);
      const updated = {
        ...row,
        ...result.transfer,
        status: result.transfer.status,
        transfer_id: result.transfer.transfer_id,
        last_updated: result.transfer.timestamp
      };
      setRows(current => current.map(item => item.recommendation_id === row.recommendation_id ? updated : item));
      setActionNotice({ id: row.recommendation_id, kind: "success", text: `Transfer ${result.transfer.transfer_id} approved and saved to Firestore.` });
    } catch (actionError) {
      setActionNotice({ id: row.recommendation_id, kind: "error", text: actionError.message || "Could not approve this transfer." });
    } finally {
      setActionId("");
    }
  }

  async function handleReject(row) {
    setActionId(row.recommendation_id);
    setActionNotice(null);
    try {
      const result = await rejectTransferPlan(row);
      setRows(current => current.map(item => item.recommendation_id === row.recommendation_id
        ? { ...item, status: result.status, rejected_at: result.rejected_at, last_updated: result.rejected_at }
        : item));
      setActionNotice({ id: row.recommendation_id, kind: "success", text: "Transfer request rejected." });
    } catch (actionError) {
      setActionNotice({ id: row.recommendation_id, kind: "error", text: actionError.message || "Could not reject this transfer." });
    } finally {
      setActionId("");
    }
  }

  async function handleComplete(row) {
    setActionId(row.transfer_id);
    setActionNotice(null);
    try {
      const result = await completeTransferPlan(row);
      setRows(current => current.map(item => item.transfer_id === row.transfer_id
        ? { ...item, status: result.status, completed_at: result.completed_at, last_updated: result.completed_at }
        : item));
      setActionNotice({ id: row.recommendation_id, kind: "success", text: "Transfer marked as completed." });
    } catch (actionError) {
      setActionNotice({ id: row.recommendation_id, kind: "error", text: actionError.message || "Could not complete this transfer." });
    } finally {
      setActionId("");
    }
  }

  return (
    <main className="transfer-tracking">
      <header className="tracking-heading">
        <div>
          <p className="tracking-eyebrow">PUBLIC HEALTH · REDISTRIBUTION</p>
          <h1>Transfer tracking</h1>
          <p>Review generated requests and track approved medicine movements.</p>
        </div>
        <div className="tracking-heading-actions">
          {permissions?.canRaiseTransferRequest && <button className="tracking-raise-request" type="button" onClick={() => setRequestDialogOpen(true)}>
            Raise Transfer Request
          </button>}
          <button className="tracking-refresh" type="button" disabled={loading || requestLoading} onClick={() => { setLoading(true); setRequestLoading(true); setReloadKey((key) => key + 1); }}>
            {loading || requestLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="tracking-error" role="alert">{error}</div>}

      <section className="tracking-metrics" aria-label="Transfer status summary">
        <article className="tracking-metric proposed"><span>Waiting for approval</span><strong>{format(proposedCount)}</strong></article>
        <article className="tracking-metric active"><span>In transit</span><strong>{format(activeCount)}</strong></article>
        <article className="tracking-metric delivered"><span>Completed transfers</span><strong>{format(completedCount)}</strong></article>
        <article className="tracking-metric rejected"><span>Rejected</span><strong>{format(rejectedCount)}</strong></article>
      </section>

      <section className="tracking-section request-inbox">
        <div className="tracking-toolbar">
          <div>
            <h2>{permissions?.canApproveTransfers ? "Response Viewer requests" : "My transfer requests"}</h2>
            <p>{permissions?.canApproveTransfers ? `${format(pendingRequestCount)} pending review` : `${format(requests.length)} requests raised by your account`}</p>
          </div>
          {requestNotice && <p className={`tracking-action-notice ${requestNotice.kind}`} role={requestNotice.kind === "error" ? "alert" : "status"}>{requestNotice.text}</p>}
        </div>
        {requestError && <div className="tracking-error" role="alert">{requestError}</div>}
        {requestLoading ? <p className="request-empty">Loading requests...</p> : requests.length ? (
          <div className="request-list">
            {requests.map((request) => (
              <article className="request-card" key={request.id}>
                <div className="request-card-heading">
                  <div>
                    <strong>{request.destination_phc_name || request.destination_phc_id}</strong>
                    <small>{request.requester_name} · {formatDate(request.created_at)}</small>
                  </div>
                  <span className={`request-status request-${request.status}`}>{request.status}</span>
                </div>
                <p>{request.source_phc_name} → {request.destination_phc_name}</p>
                <p><strong>{format(request.quantity)} {request.medicine_name}</strong> · {request.priority} priority</p>
                <p className="request-reason">{request.reason}</p>
                {permissions?.canApproveTransfers && request.status === "pending" && (
                  <div className="tracking-actions">
                    <button type="button" className="tracking-reject" disabled={Boolean(requestActionId)} onClick={() => handleRequestReview(request, "rejected")}>
                      {requestActionId === request.id ? "Saving..." : "Reject"}
                    </button>
                    <button type="button" className="tracking-approve" disabled={Boolean(requestActionId)} onClick={() => handleRequestReview(request, "approved")}>
                      {requestActionId === request.id ? "Saving..." : "Approve"}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : <p className="request-empty">No transfer requests yet.</p>}
      </section>

      <section className="tracking-section">
        <div className="tracking-toolbar">
          <div>
            <h2>Transfer records</h2>
            <p>{format(filteredRows.length)} records</p>
          </div>
          <label className="tracking-filter">
            <span>Status</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="proposed">Waiting for approval</option>
              <option value="active">In transit</option>
              <option value="completed">Completed transfer</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
        <div className="tracking-table-scroll">
          <table className="tracking-table">
            <thead><tr><th>Transfer</th><th>Source</th><th>Destination</th><th>Medicine</th><th>Quantity</th><th>Distance</th><th>Status</th><th>Last updated</th></tr></thead>
            <tbody>
              {loading ? <tr><td className="tracking-empty" colSpan="8">Loading transfer records...</td></tr> :
                filteredRows.length ? filteredRows.map((row) => {
                  const step = statusStep(row.status);
                  const rowId = row.recommendation_id || row.transfer_id;
                  const isExpanded = expandedId === rowId;
                  return (
                    <Fragment key={rowId}>
                      <tr key={rowId} className={isExpanded ? "tracking-row expanded" : "tracking-row"}>
                        <td><button type="button" className="tracking-expand" aria-expanded={isExpanded} aria-controls={`transfer-detail-${rowId}`} onClick={() => setExpandedId(isExpanded ? "" : rowId)}><strong>{row.transfer_id !== "—" ? row.transfer_id : row.recommendation_id || "—"}</strong><small>{row.transfer_id !== "—" ? row.recommendation_id || "Transfer" : "Recommendation"}</small></button></td>
                        <td><strong>{row.source_phc_name || row.source_phc_id || "—"}</strong><small>{row.source_phc_id || ""}</small></td>
                        <td><strong>{row.destination_phc_name || row.shortage_phc_name || row.destination_phc_id || "—"}</strong><small>{row.destination_phc_id || ""}</small></td>
                        <td>{row.medicine || row.medicine_id || "—"}</td>
                        <td className="tracking-number">{format(row.quantity ?? row.recommended_transfer)} units</td>
                        <td className="tracking-number">{row.distance_km == null ? "—" : `${format(row.distance_km)} km`}</td>
                        <td>
                          <span className={`tracking-status status-${step}`}>{statusLabel(row.status)}</span>
                          {row.status !== "REJECTED" && <div className={`tracking-progress progress-${step}`} aria-label={`Transfer progress: ${statusLabel(row.status)}`}><i /><i /><i /></div>}
                        </td>
                        <td>{formatDate(row.last_updated)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="tracking-detail-row">
                          <td colSpan="8">
                            <div className="tracking-detail" id={`transfer-detail-${rowId}`}>
                              <div className="tracking-detail-grid">
                                <div><span>Request ID</span><strong>{row.recommendation_id || "—"}</strong></div>
                                <div><span>Source stock</span><strong>{format(row.source_current_stock)} units</strong></div>
                                <div><span>Source daily demand</span><strong>{row.source_predicted_daily_demand == null ? "—" : `${format(row.source_predicted_daily_demand)} units/day`}</strong></div>
                                <div><span>Source surplus after 10-day reserve</span><strong>{row.source_surplus == null ? "—" : `${format(row.source_surplus)} units`}</strong></div>
                                <div><span>Donor stock after transfer</span><strong>{row.donor_remaining_stock == null ? "—" : `${format(row.donor_remaining_stock)} units`}</strong></div>
                                <div><span>Destination stock</span><strong>{format(row.current_stock)} units</strong></div>
                                <div><span>Destination daily demand</span><strong>{row.daily_consumption == null ? "—" : `${format(row.daily_consumption)} units/day`}</strong></div>
                                <div><span>Destination days remaining</span><strong>{row.days_remaining == null ? "—" : `${format(row.days_remaining)} days`}</strong></div>
                                <div><span>Required quantity</span><strong>{format(row.required_quantity ?? row.quantity)} units</strong></div>
                                <div><span>Estimated travel time</span><strong>{row.estimated_transit_hours == null ? "—" : `${format(row.estimated_transit_hours)} ${Number(row.estimated_transit_hours) === 1 ? "hour" : "hours"}`}</strong></div>
                                <div><span>Coverage after transfer</span><strong>{row.estimated_coverage_days == null ? "—" : `${format(row.estimated_coverage_days)} days`}</strong></div>
                                <div><span>Source / destination area</span><strong>{row.source_district || "—"} · {row.source_state || row.destination_state || "—"}</strong></div>
                                <div><span>Area match</span><strong>{row.same_district ? "Same district" : "Different district"} · {row.same_state === false ? "Different state" : "Same state"}</strong></div>
                                <div><span>Updated</span><strong>{formatDate(row.last_updated)}</strong></div>
                              </div>
                              {row.alternative_donors?.length > 0 && <p className="tracking-rationale"><strong>Other eligible PHCs:</strong> {row.alternative_donors.map(donor => `${donor.source_phc_name} (${format(donor.distance_km)} km, ${format(donor.source_surplus)} surplus)`).join(" · ")}</p>}
                              {row.reason && <p className="tracking-reason">{row.reason}</p>}
                              {actionNotice?.id === row.recommendation_id && <p className={`tracking-action-notice ${actionNotice.kind}`} role={actionNotice.kind === "error" ? "alert" : "status"}>{actionNotice.text}</p>}
                              {permissions?.canApproveTransfers && row.status === "PROPOSED" && (
                                <div className="tracking-actions">
                                  <button type="button" className="tracking-reject" disabled={Boolean(actionId)} onClick={() => handleReject(row)}>{actionId === row.recommendation_id ? "Saving..." : "Reject"}</button>
                                  <button type="button" className="tracking-approve" disabled={Boolean(actionId)} onClick={() => handleApprove(row)}>{actionId === row.recommendation_id ? "Saving..." : "Approve Transfer"}</button>
                                </div>
                              )}
                              {permissions?.canUpdateStock && ["APPROVED_IN_TRANSIT", "IN_TRANSIT"].includes(row.status) && (
                                <div className="tracking-actions">
                                  <button type="button" className="tracking-complete" disabled={Boolean(actionId)} onClick={() => handleComplete(row)}>{actionId === row.transfer_id ? "Saving..." : "Complete Transfer"}</button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                }) : <tr><td className="tracking-empty" colSpan="8">{error ? "Transfer records could not be loaded." : "No transfer records for this status."}</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="tracking-footer">Data source: Firestore transfer and recommendation records</footer>
      </section>
      {requestDialogOpen && <TransferRequestDialog
        open
        userProfile={currentUser}
        onClose={() => setRequestDialogOpen(false)}
        onSubmitted={handleRequestSubmitted}
      />}
    </main>
  );
}

export default TransferTrackingPage;
