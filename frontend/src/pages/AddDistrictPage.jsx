import { useEffect, useState } from "react";
import {
  Alert, Box, Button, CircularProgress, Grid, Paper,
  Stack, TextField, Typography
} from "@mui/material";
import { auth } from "../firebase";
import { getRoleForEmail } from "../auth/roles";
import { DEMO_MODE, DEMO_USER } from "../auth/demo";
import { getDashboardData, saveDistrictSupplies } from "../services/api";

const blankSupply = () => ({ medicine_id: "", medicine_name: "", unit: "Units", current_stock: "", daily_consumption: "", safety_stock: "", category: "" });

export default function AddDistrictPage() {
  const [districtName, setDistrictName] = useState("");
  const [districtCode, setDistrictCode] = useState("");
  const [state, setState] = useState("");
  const [phc, setPhc] = useState({ phc_id: "", name: "", lat: "", lng: "", population_served: "" });
  const [supplies, setSupplies] = useState([blankSupply()]);
  const [existingPhcIds, setExistingPhcIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canSave = DEMO_MODE ? DEMO_USER.role === "operations" : getRoleForEmail(auth.currentUser?.email) === "operations";

  useEffect(() => {
    let active = true;
    getDashboardData()
      .then((data) => {
        if (active) setExistingPhcIds([...new Set([
          ...(data.phcs || []).map((phc) => phc.phc_id),
          ...(data.inventory || []).map((row) => row.phc_id)
        ].filter(Boolean))]);
      })
      .catch(() => { if (active) setError("Could not check existing PHC records. Retry before saving to prevent duplicate IDs."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function updateSupply(index, field, value) {
    setSupplies((current) => current.map((supply, supplyIndex) => supplyIndex === index ? { ...supply, [field]: value } : supply));
  }

  function validate() {
    if (!districtName.trim() || !state.trim() || !phc.phc_id.trim() || !phc.name.trim()) return "District, state, PHC ID, and PHC name are required.";
    if (!/^[A-Za-z0-9_-]+$/.test(phc.phc_id.trim())) return "PHC ID may contain letters, numbers, hyphens, and underscores only.";
    if (existingPhcIds.includes(phc.phc_id.trim())) return "That PHC ID already exists in the current application data.";
    if (phc.population_served !== "" && (!Number.isInteger(Number(phc.population_served)) || Number(phc.population_served) < 0)) return "Population served must be a non-negative whole number.";
    if (phc.lat === "" || phc.lng === "") return "Latitude and longitude are required so this PHC can appear on the national map.";
    const lat = Number(phc.lat);
    const lng = Number(phc.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return "Enter valid latitude and longitude values.";
    if (!supplies.length) return "Add at least one supply record.";
    const medicineIds = supplies.map((supply) => supply.medicine_id.trim().toUpperCase());
    if (supplies.some((supply) => !supply.medicine_id.trim() || !supply.medicine_name.trim() || supply.current_stock === "" || supply.daily_consumption === "")) return "Each supply needs a medicine ID, name, stock, and daily use.";
    if (new Set(medicineIds).size !== medicineIds.length) return "Remove duplicate medicine IDs from the supply rows.";
    if (supplies.some((supply) => [supply.current_stock, supply.daily_consumption, supply.safety_stock].some((value) => value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0)))) return "Stock, daily use, and safety stock must be non-negative numbers.";
    return "";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!canSave) {
      setError("Prototype Operations access is disabled.");
      return;
    }
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      const cleanPhc = {
        phc_id: phc.phc_id.trim(),
        name: phc.name.trim(),
        lat: Number(phc.lat),
        lng: Number(phc.lng),
        ...(phc.population_served !== "" ? { population_served: Number(phc.population_served) } : {})
      };
      const cleanSupplies = supplies.map((supply) => ({
        medicine_id: supply.medicine_id.trim().toUpperCase(),
        medicine_name: supply.medicine_name.trim(),
        unit: supply.unit.trim() || "Units",
        category: supply.category.trim() || "Other",
        current_stock: Number(supply.current_stock),
        daily_consumption: Number(supply.daily_consumption),
        safety_stock: supply.safety_stock === "" ? 0 : Number(supply.safety_stock)
      }));
      const result = await saveDistrictSupplies({ districtName, state, districtCode, phc: cleanPhc, supplies: cleanSupplies, existingPhcIds });
      setSuccess(`${result.district.district_name} district and ${result.supply_count} supply record${result.supply_count === 1 ? "" : "s"} added successfully.`);
      setExistingPhcIds((ids) => [...ids, cleanPhc.phc_id]);
      setDistrictName("");
      setDistrictCode("");
      setState("");
      setPhc({ phc_id: "", name: "", lat: "", lng: "", population_served: "" });
      setSupplies([blankSupply()]);
    } catch (saveError) {
      console.error("District save failed:", saveError);
      setError("Could not save district and supplies. Check the Firestore connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1120, mx: "auto", width: "100%" }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="overline" sx={{ color: "#51805d", fontWeight: 800 }}>OPERATIONAL DATA</Typography>
        <Typography variant="h4" sx={{ fontWeight: 800, color: "#193330" }}>Add district & supplies</Typography>
        <Typography color="text.secondary">Save new PHC directory and inventory records to the existing Firestore collections.</Typography>
      </Box>

      {!canSave && <Alert severity="info" sx={{ mb: 2 }}>Prototype Operations access is disabled.</Alert>}
      {loading && <Alert severity="info" sx={{ mb: 2 }}>Checking current PHC IDs to prevent duplicates…</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <form onSubmit={handleSubmit}>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>District and PHC</Typography>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 5 }}><TextField label="District name" value={districtName} onChange={(event) => setDistrictName(event.target.value)} required fullWidth size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="State" value={state} onChange={(event) => setState(event.target.value)} required fullWidth size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 3 }}><TextField label="District code (optional)" value={districtCode} onChange={(event) => setDistrictCode(event.target.value)} fullWidth size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="PHC ID" value={phc.phc_id} onChange={(event) => setPhc((current) => ({ ...current, phc_id: event.target.value }))} required fullWidth size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 8 }}><TextField label="PHC name" value={phc.name} onChange={(event) => setPhc((current) => ({ ...current, name: event.target.value }))} required fullWidth size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 3 }}><TextField label="Latitude" type="number" inputProps={{ min: -90, max: 90, step: "any" }} value={phc.lat} onChange={(event) => setPhc((current) => ({ ...current, lat: event.target.value }))} required fullWidth size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 3 }}><TextField label="Longitude" type="number" inputProps={{ min: -180, max: 180, step: "any" }} value={phc.lng} onChange={(event) => setPhc((current) => ({ ...current, lng: event.target.value }))} required fullWidth size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="Population served (optional)" type="number" inputProps={{ min: 0, step: 1 }} value={phc.population_served} onChange={(event) => setPhc((current) => ({ ...current, population_served: event.target.value }))} fullWidth size="small" /></Grid>
            </Grid>
          </Paper>

          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 1.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1} sx={{ mb: 1.5 }}>
              <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>Medicine and supply records</Typography><Typography variant="body2" color="text.secondary">Each row writes to the existing medicine catalog and PHC inventory.</Typography></Box>
              <Button variant="outlined" type="button" onClick={() => setSupplies((rows) => [...rows, blankSupply()])}>Add supply row</Button>
            </Stack>
            <Stack spacing={1.5}>
              {supplies.map((supply, index) => (
                <Paper key={index} variant="outlined" sx={{ p: 1.5, bgcolor: "#fbfcfa" }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Supply {index + 1}</Typography>
                    <Button type="button" color="error" size="small" disabled={supplies.length === 1} onClick={() => setSupplies((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button>
                  </Stack>
                  <Grid container spacing={1.25}>
                    <Grid size={{ xs: 12, sm: 3 }}><TextField label="Medicine ID" value={supply.medicine_id} onChange={(event) => updateSupply(index, "medicine_id", event.target.value)} required fullWidth size="small" /></Grid>
                    <Grid size={{ xs: 12, sm: 5 }}><TextField label="Medicine / supply name" value={supply.medicine_name} onChange={(event) => updateSupply(index, "medicine_name", event.target.value)} required fullWidth size="small" /></Grid>
                    <Grid size={{ xs: 12, sm: 2 }}><TextField label="Unit" value={supply.unit} onChange={(event) => updateSupply(index, "unit", event.target.value)} required fullWidth size="small" /></Grid>
                    <Grid size={{ xs: 12, sm: 2 }}><TextField label="Category" value={supply.category} onChange={(event) => updateSupply(index, "category", event.target.value)} fullWidth size="small" /></Grid>
                    <Grid size={{ xs: 12, sm: 4 }}><TextField label="Current stock" type="number" inputProps={{ min: 0, step: 1 }} value={supply.current_stock} onChange={(event) => updateSupply(index, "current_stock", event.target.value)} required fullWidth size="small" /></Grid>
                    <Grid size={{ xs: 12, sm: 4 }}><TextField label="Daily use" type="number" inputProps={{ min: 0, step: "any" }} value={supply.daily_consumption} onChange={(event) => updateSupply(index, "daily_consumption", event.target.value)} required fullWidth size="small" /></Grid>
                    <Grid size={{ xs: 12, sm: 4 }}><TextField label="Safety stock" type="number" inputProps={{ min: 0, step: 1 }} value={supply.safety_stock} onChange={(event) => updateSupply(index, "safety_stock", event.target.value)} fullWidth size="small" /></Grid>
                  </Grid>
                </Paper>
              ))}
            </Stack>
          </Paper>
          <Stack direction="row" justifyContent="flex-end">
            <Button type="submit" variant="contained" size="large" disabled={!canSave || loading || saving} sx={{ minWidth: 190, fontWeight: 750 }}>
              {saving ? <><CircularProgress size={18} sx={{ mr: 1, color: "inherit" }} />Saving records…</> : "Save district & supplies"}
            </Button>
          </Stack>
        </Stack>
      </form>
    </Box>
  );
}