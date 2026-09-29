import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, Grid, InputLabel,
  MenuItem, Paper, Select, Stack, Typography
} from "@mui/material";
import { generateDistrictBriefing, getDashboardData, getTransferTrackingData } from "../services/api";
import { riskCategory } from "../utils/risk";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
const RISK_COLORS = { stable: "#2f8f5b", warning: "#e5a514", critical: "#cf493e" };
let mapsLoader;

function loadGoogleMaps() {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise((resolve, reject) => {
    const callbackName = "__swasthyaSetuMapsReady";
    window[callbackName] = () => resolve(window.google.maps);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      mapsLoader = null;
      reject(new Error("Google Maps could not be loaded. Check the Maps JavaScript API key and referrer restrictions."));
    };
    document.head.appendChild(script);
  });
  return mapsLoader;
}

function validCoordinates(row) {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function showItem(item, index) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return `Item ${index + 1}`;
  return item.action || item.description || item.medicine || item.phc_name || item.risk || `Item ${index + 1}`;
}

export default function NationalMapPage() {
  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [dashboard, setDashboard] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(MAPS_KEY ? "" : "Google Maps JavaScript API key is not configured.");
  const [mapDistrict, setMapDistrict] = useState("all");
  const [mapRisk, setMapRisk] = useState("all");
  const [mapMedicine, setMapMedicine] = useState("all");
  const [selectedPhc, setSelectedPhc] = useState(null);
  const [briefingDistrict, setBriefingDistrict] = useState("");
  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getDashboardData(), getTransferTrackingData()])
      .then(([data, tracking]) => {
        if (!active) return;
        setDashboard(data);
        setRecommendations(tracking.recommendations || []);
        const firstDistrict = (data.inventory || []).find((row) => row.district);
        setBriefingDistrict((current) => current || (firstDistrict ? `${firstDistrict.state || ""}::${firstDistrict.district}` : ""));
      })
      .catch((error) => {
        if (active) setLoadError(error.message || "Could not load PHC data.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!MAPS_KEY) {
      return undefined;
    }
    let active = true;
    window.gm_authFailure = () => {
      if (active) setMapError("Google Maps rejected this key. Enable the Maps JavaScript API and restrict the key to this site's referrer.");
    };
    loadGoogleMaps()
      .then(async (maps) => {
        const [{ Map }, markerLibrary] = await Promise.all([
          maps.importLibrary("maps"),
          maps.importLibrary("marker")
        ]);
        if (!active || !mapElement.current) return;
        mapRef.current = new Map(mapElement.current, {
          center: { lat: 22.8, lng: 79.0 },
          zoom: 4.6,
          mapId: "DEMO_MAP_ID",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true
        });
        mapRef.current.markerLibrary = markerLibrary;
        setMapError("");
        setMapReady(true);
      })
      .catch((error) => { if (active) setMapError(error.message); });
    return () => {
      active = false;
      delete window.gm_authFailure;
    };
  }, []);

  const inventory = dashboard?.inventory || [];
  const medicines = [...new Set(inventory.map((row) => row.medicine_name).filter(Boolean))].sort();
  const districtKeys = [...new Map(inventory.filter((row) => row.district).map((row) => [`${row.state || ""}::${row.district}`, { key: `${row.state || ""}::${row.district}`, label: `${row.district}${row.state ? `, ${row.state}` : ""}` }])).values()];

  useEffect(() => {
    if (!mapReady || !mapRef.current) return undefined;
    markersRef.current.forEach((marker) => { marker.map = null; });
    markersRef.current = [];

    const grouped = new Map();
    (dashboard?.inventory || []).forEach((row) => {
      if (!validCoordinates(row)) return;
      if (mapDistrict !== "all" && `${row.state || ""}::${row.district || ""}` !== mapDistrict) return;
      if (mapMedicine !== "all" && row.medicine_name !== mapMedicine) return;
      const risk = riskCategory(row);
      if (mapRisk !== "all" && risk !== mapRisk) return;
      if (!grouped.has(row.phc_id)) grouped.set(row.phc_id, { phc: row, rows: [] });
      grouped.get(row.phc_id).rows.push(row);
    });

    const markerLibrary = mapRef.current.markerLibrary;
    grouped.forEach((entry) => {
      const sortedRows = [...entry.rows].sort((left, right) => {
        const order = { critical: 0, warning: 1, stable: 2 };
        return order[riskCategory(left)] - order[riskCategory(right)];
      });
      const primaryRisk = riskCategory(sortedRows[0]);
      const pin = new markerLibrary.PinElement({
        background: RISK_COLORS[primaryRisk],
        borderColor: "#ffffff",
        glyphColor: "#ffffff"
      });
      const marker = new markerLibrary.AdvancedMarkerElement({
        map: mapRef.current,
        position: { lat: Number(entry.phc.lat), lng: Number(entry.phc.lng) },
        title: `${entry.phc.phc_name || entry.phc.phc_id} · ${primaryRisk}`,
        content: pin,
        gmpClickable: true
      });
      marker.addEventListener("gmp-click", () => setSelectedPhc({ ...entry, rows: sortedRows }));
      markersRef.current.push(marker);
    });
    return () => markersRef.current.forEach((marker) => { marker.map = null; });
  }, [dashboard, mapDistrict, mapMedicine, mapRisk, mapReady]);

  async function handleGenerateBriefing() {
    const [districtState, districtName] = briefingDistrict.split("::");
    const rows = inventory.filter((row) => row.district === districtName && String(row.state || "") === districtState);
    if (!briefingDistrict || !rows.length) {
      setBriefingError("No inventory records are available for this district.");
      return;
    }
    setBriefingLoading(true);
    setBriefingError("");
    setBriefing(null);
    try {
      const riskRows = rows.map((row) => ({ ...row, normalized_risk: riskCategory(row) }));
      const criticalRows = riskRows.filter((row) => row.normalized_risk === "critical");
      const warningRows = riskRows.filter((row) => row.normalized_risk === "warning");
      const phcRisk = new Map();
      const riskOrder = { critical: 3, warning: 2, stable: 1 };
      riskRows.forEach((row) => {
        const existingRisk = phcRisk.get(row.phc_id);
        if (!existingRisk || riskOrder[row.normalized_risk] > riskOrder[existingRisk]) phcRisk.set(row.phc_id, row.normalized_risk);
      });
      const existingActions = recommendations
        .filter((item) => item.destination_district === districtName && (!item.destination_state || item.destination_state === districtState) && ["PROPOSED", "APPROVED", "APPROVED_IN_TRANSIT", "IN_TRANSIT"].includes(String(item.status || "").toUpperCase()))
        .map((item) => ({
          source_phc: item.source_phc_name || item.source_phc_id,
          destination_phc: item.shortage_phc_name || item.destination_phc_id || item.shortage_phc,
          medicine: item.medicine,
          quantity: Number(item.quantity ?? item.recommended_transfer) || 0,
          status: item.status
        }));
      const context = {
        district: districtName,
        state: rows.find((row) => row.state)?.state || "Unavailable",
        phc_count: phcRisk.size,
        critical_phcs: [...phcRisk.values()].filter((risk) => risk === "critical").length,
        warning_phcs: [...phcRisk.values()].filter((risk) => risk === "warning").length,
        stable_phcs: [...phcRisk.values()].filter((risk) => risk === "stable").length,
        critical_alerts: criticalRows.length,
        warning_alerts: warningRows.length,
        medicines_at_risk: [...new Set([...criticalRows, ...warningRows].map((row) => row.medicine_name).filter(Boolean))],
        stockout_risks: [...criticalRows, ...warningRows]
          .sort((left, right) => Number(left.days_remaining) - Number(right.days_remaining))
          .slice(0, 20)
          .map((row) => ({ phc: row.phc_name || row.phc_id, medicine: row.medicine_name, current_stock: Number(row.current_stock) || 0, days_remaining: row.days_remaining, risk: row.normalized_risk.toUpperCase() })),
        existing_recommendations: existingActions,
        data_limitations: rows.length ? [] : ["No inventory records were returned for this district."]
      };
      const generated = await generateDistrictBriefing(context);
      setBriefing({ ...generated, context });
    } catch (error) {
      console.error("District briefing generation failed:", error);
      setBriefingError("Unable to generate the district briefing. Please try again.");
    } finally {
      setBriefingLoading(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: "auto", width: "100%" }}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} spacing={1} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="overline" sx={{ color: "#51805d", fontWeight: 800 }}>NATIONAL PHC GRID</Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: "#193330" }}>India supply risk map</Typography>
          <Typography color="text.secondary">Facility locations and medicine risk from the live inventory feed.</Typography>
        </Box>
        <Chip label={`${new Set(inventory.map((row) => row.phc_id)).size} PHCs in feed`} color="success" variant="outlined" />
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mb: 1.5 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>District</InputLabel>
                <Select value={mapDistrict} label="District" onChange={(event) => setMapDistrict(event.target.value)}>
                  <MenuItem value="all">All districts</MenuItem>
                  {districtKeys.map((item) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>Risk</InputLabel>
                <Select value={mapRisk} label="Risk" onChange={(event) => setMapRisk(event.target.value)}>
                  <MenuItem value="all">All risk levels</MenuItem>
                  <MenuItem value="critical">Critical</MenuItem>
                  <MenuItem value="warning">Warning</MenuItem>
                  <MenuItem value="stable">Stable</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>Medicine</InputLabel>
                <Select value={mapMedicine} label="Medicine" onChange={(event) => setMapMedicine(event.target.value)}>
                  <MenuItem value="all">All medicines</MenuItem>
                  {medicines.map((medicine) => <MenuItem key={medicine} value={medicine}>{medicine}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <Box sx={{ position: "relative", height: { xs: 440, md: 590 }, bgcolor: "#e7efeb", borderRadius: 1, overflow: "hidden" }}>
              <div ref={mapElement} style={{ width: "100%", height: "100%" }} />
              {(loading || mapError) && (
                <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", p: 3, bgcolor: "rgba(244,248,245,.92)" }}>
                  <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 460, textAlign: "center" }}>
                    {loading && <CircularProgress size={28} />}
                    <Typography variant="h6" sx={{ fontWeight: 750 }}>{loading ? "Loading PHC locations" : "Google Maps is not configured"}</Typography>
                    <Typography color="text.secondary">{loading ? "Reading PHC and supply records from the existing data sources." : mapError}</Typography>
                    {!loading && <Typography variant="caption" color="text.secondary">Set `VITE_GOOGLE_MAPS_API_KEY` to a Maps JavaScript API key with HTTP referrer restrictions, then rebuild.</Typography>}
                  </Stack>
                </Box>
              )}
            </Box>
            <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" sx={{ pt: 1.5, px: 0.5 }}>
              {["stable", "warning", "critical"].map((risk) => (
                <Stack key={risk} direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: RISK_COLORS[risk] }} />
                  <Typography variant="body2" sx={{ textTransform: "capitalize" }}>{risk}</Typography>
                </Stack>
              ))}
              <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>Marker color reflects the highest visible risk at that PHC.</Typography>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5, minHeight: 250 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>Facility detail</Typography>
            {selectedPhc ? (
              <Stack spacing={1.25}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{selectedPhc.phc.phc_name || selectedPhc.phc.phc_id}</Typography>
                  <Typography color="text.secondary">{selectedPhc.phc.district || "District unavailable"}{selectedPhc.phc.state ? `, ${selectedPhc.phc.state}` : ""}</Typography>
                </Box>
                {selectedPhc.rows.map((row) => (
                  <Box key={`${row.phc_id}_${row.medicine_id}`} sx={{ borderTop: "1px solid #e2e9e4", pt: 1 }}>
                    <Stack direction="row" justifyContent="space-between" gap={1}>
                      <Typography sx={{ fontWeight: 700 }}>{row.medicine_name || row.medicine_id}</Typography>
                      <Chip size="small" label={riskCategory(row)} sx={{ textTransform: "capitalize", bgcolor: `${RISK_COLORS[riskCategory(row)]}18`, color: RISK_COLORS[riskCategory(row)] }} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">Stock: {row.current_stock ?? "Unavailable"} {row.unit || "units"} · Days remaining: {row.days_remaining ?? "Unavailable"}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.75 }}>Suggested next step: {riskCategory(row) === "stable" ? "Continue routine stock monitoring." : "Review this shortage and consider redistribution from an eligible surplus PHC."}</Typography>
                  </Box>
                ))}
              </Stack>
            ) : <Typography color="text.secondary">Select a marker to inspect its inventory and risk.</Typography>}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 1.5 }}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} spacing={1.5}>
              <Box>
                <Typography variant="overline" sx={{ fontWeight: 800, color: "#51805d" }}>AI-GENERATED BRIEFING · GROUNDED IN CURRENT APP DATA</Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>District intelligence</Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <FormControl size="small" sx={{ minWidth: { sm: 250 } }}>
                  <InputLabel>District</InputLabel>
                  <Select value={briefingDistrict} label="District" onChange={(event) => { setBriefingDistrict(event.target.value); setBriefing(null); }}>
                    {districtKeys.map((item) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <Button variant="contained" onClick={handleGenerateBriefing} disabled={briefingLoading || !briefingDistrict || !import.meta.env.VITE_GEMINI_API_KEY}>
                  {briefingLoading ? <><CircularProgress size={18} sx={{ mr: 1, color: "inherit" }} />Generating...</> : "Generate District Briefing"}
                </Button>
              </Stack>
            </Stack>
            {briefingError && <Alert severity="error" sx={{ mt: 2 }}>{briefingError}</Alert>}
            {!briefing && !briefingLoading && <Typography color="text.secondary" sx={{ mt: 2 }}>Select a district and generate a briefing from its current stock and risk records.</Typography>}
            {briefing && (
              <Box sx={{ mt: 2 }}>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
                  <Chip color="error" label={`${briefing.context.critical_alerts} critical alerts`} />
                  <Chip color="warning" label={`${briefing.context.warning_alerts} warning alerts`} />
                  <Chip variant="outlined" label={`${briefing.context.phc_count} PHCs`} />
                </Stack>
                <Typography sx={{ lineHeight: 1.7, mb: 2 }}>{briefing.summary}</Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Medicines at risk</Typography>
                    <Typography variant="body2" color="text.secondary">{briefing.context.medicines_at_risk.join(", ") || "None in the current feed"}</Typography>
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Stockout risks</Typography>
                    {briefing.context.stockout_risks.slice(0, 5).map((risk, index) => <Typography key={`${risk.phc}-${risk.medicine}-${index}`} variant="body2" color="text.secondary">{risk.phc} · {risk.medicine} · {risk.days_remaining ?? "unknown"} days · {risk.risk}</Typography>)}
                    {!briefing.context.stockout_risks.length && <Typography variant="body2" color="text.secondary">No warning or critical rows.</Typography>}
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>AI-suggested actions</Typography>
                    {briefing.recommendedActions.slice(0, 5).map((action, index) => <Typography key={index} variant="body2" color="text.secondary">{showItem(action, index)}</Typography>)}
                    {!briefing.recommendedActions.length && <Typography variant="body2" color="text.secondary">No additional action suggested from the available facts.</Typography>}
                    <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "#8a5b13" }}>Suggestions only; these actions are not approved or executed.</Typography>
                  </Grid>
                </Grid>
                {briefing.dataLimitations.length > 0 && <Alert severity="info" sx={{ mt: 2 }}>{briefing.dataLimitations.join(" ")}</Alert>}
                {briefing.context.existing_recommendations.length > 0 && (
                  <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid #e2e9e4" }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Existing transfer recommendations</Typography>
                    {briefing.context.existing_recommendations.map((action, index) => <Typography key={index} variant="body2" color="text.secondary">{action.quantity} {action.medicine || "units"} · {action.source_phc} → {action.destination_phc} · {action.status}</Typography>)}
                  </Box>
                )}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}