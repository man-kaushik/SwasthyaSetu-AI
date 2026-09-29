import { useEffect, useState } from "react";
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Grid, MenuItem, TextField
} from "@mui/material";
import { createTransferRequest, getDashboardData } from "../services/api";

export default function TransferRequestDialog({ open, userProfile, initialRow, onClose, onSubmitted }) {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    source_phc_id: "",
    destination_phc_id: "",
    medicine_id: "",
    quantity: "",
    priority: "HIGH",
    reason: ""
  });

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    getDashboardData()
      .then((data) => {
        if (!active) return;
        const rows = data.inventory || [];
        setInventory(rows);
        const destination = initialRow?.phc_id || "";
        const medicine = initialRow?.medicine_id || "";
        const source = rows.find((row) => row.medicine_id === medicine && row.phc_id !== destination && row.state === initialRow?.state) ||
          rows.find((row) => row.medicine_id === medicine && row.phc_id !== destination) ||
          rows.find((row) => row.phc_id !== destination);
        const requestedQuantity = initialRow
          ? Math.max(1, Math.ceil((Number(initialRow.daily_consumption) || 1) * 10 - (Number(initialRow.current_stock) || 0)))
          : 100;
        const days = Number(initialRow?.days_remaining ?? initialRow?.forecast_days_remaining);
        setForm({
          source_phc_id: source?.phc_id || "",
          destination_phc_id: destination || rows.find((row) => row.phc_id && row.phc_id !== source?.phc_id)?.phc_id || "",
          medicine_id: medicine || source?.medicine_id || rows[0]?.medicine_id || "",
          quantity: String(requestedQuantity),
          priority: initialRow?.risk_level === "CRITICAL" || days <= 3 ? "URGENT" : "HIGH",
          reason: initialRow
            ? `${initialRow.medicine_name || initialRow.medicine_id} has ${Number.isFinite(days) ? `${days.toFixed(1)} days` : "limited days"} of stock remaining at ${initialRow.phc_name || initialRow.phc_id}.`
            : "Additional stock is needed to maintain facility coverage."
        });
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load PHC inventory.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, initialRow]);

  const facilities = [...new Map(inventory.filter((row) => row.phc_id).map((row) => [row.phc_id, {
    phc_id: row.phc_id,
    phc_name: row.phc_name || row.phc_id,
    state: row.state
  }])).values()];
  const medicines = [...new Map(inventory.filter((row) => row.medicine_id).map((row) => [row.medicine_id, {
    medicine_id: row.medicine_id,
    medicine_name: row.medicine_name || row.medicine_id
  }])).values()];

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const source = facilities.find((item) => item.phc_id === form.source_phc_id);
      const destination = facilities.find((item) => item.phc_id === form.destination_phc_id);
      const medicine = medicines.find((item) => item.medicine_id === form.medicine_id);
      await createTransferRequest({
        ...form,
        source_phc_name: source?.phc_name,
        destination_phc_name: destination?.phc_name,
        medicine_name: medicine?.medicine_name
      }, userProfile);
      onSubmitted?.();
    } catch (submitError) {
      setError(submitError.message || "Could not submit transfer request. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>Raise transfer request</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading ? <CircularProgress size={24} /> : (
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField select label="From PHC" value={form.source_phc_id} onChange={(event) => update("source_phc_id", event.target.value)} required fullWidth size="small">
                  {facilities.map((item) => <MenuItem key={item.phc_id} value={item.phc_id}>{item.phc_name}{item.state ? ` · ${item.state}` : ""}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField select label="To PHC" value={form.destination_phc_id} onChange={(event) => update("destination_phc_id", event.target.value)} required fullWidth size="small">
                  {facilities.map((item) => <MenuItem key={item.phc_id} value={item.phc_id}>{item.phc_name}{item.state ? ` · ${item.state}` : ""}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField select label="Medicine" value={form.medicine_id} onChange={(event) => update("medicine_id", event.target.value)} required fullWidth size="small">
                  {medicines.map((item) => <MenuItem key={item.medicine_id} value={item.medicine_id}>{item.medicine_name}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Quantity" type="number" value={form.quantity} onChange={(event) => update("quantity", event.target.value)} inputProps={{ min: 1, step: 1 }} required fullWidth size="small" />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField select label="Priority" value={form.priority} onChange={(event) => update("priority", event.target.value)} fullWidth size="small">
                  <MenuItem value="NORMAL">Normal</MenuItem>
                  <MenuItem value="HIGH">High</MenuItem>
                  <MenuItem value="URGENT">Urgent</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField label="Reason" value={form.reason} onChange={(event) => update("reason", event.target.value)} inputProps={{ maxLength: 500 }} required fullWidth size="small" multiline minRows={2} />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={loading || saving || !facilities.length}>
            {saving ? <><CircularProgress size={16} sx={{ mr: 1, color: "inherit" }} />Submitting...</> : "Submit request"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
