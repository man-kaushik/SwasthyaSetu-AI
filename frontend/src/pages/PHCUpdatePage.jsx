import React, { useState } from 'react';
import {
  Container, Paper, Typography, Box, Grid, TextField,
  MenuItem, Button, Alert, CircularProgress, Divider,
  Chip, Card, CardContent, Stack
} from '@mui/material';
import { SAMPLE_PHCS, SAMPLE_MEDICINES, submitPHCUpdate } from '../services/api';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'mr', label: 'Marathi' }
];

export default function PHCUpdatePage() {
  const [language, setLanguage] = useState('en');
  const [loading, setLoading] = useState(false);
  const [successResult, setSuccessResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const [formData, setFormData] = useState({
    phc_id: 'MH-PUNE-PHC-003',
    medicine_id: 'ORS',
    current_stock: 40,
    daily_consumption: 22,
    beds_available: 3,
    doctors_present: 1,
    nurses_present: 2,
    patient_footfall: 110,
    notes: 'Surge in dehydration cases.'
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePreset = (type) => {
    if (type === 'PUNE_CRITICAL') {
      setFormData({
        phc_id: 'MH-PUNE-PHC-003',
        medicine_id: 'ORS',
        current_stock: 40,
        daily_consumption: 22,
        beds_available: 3,
        doctors_present: 1,
        nurses_present: 2,
        patient_footfall: 110,
        notes: 'Critical stockout risk.'
      });
    } else {
      setFormData({
        phc_id: 'MH-PUNE-PHC-011',
        medicine_id: 'ORS',
        current_stock: 620,
        daily_consumption: 15,
        beds_available: 8,
        doctors_present: 3,
        nurses_present: 5,
        patient_footfall: 75,
        notes: 'Surplus depot.'
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessResult(null);
    try {
      const selectedMed = SAMPLE_MEDICINES.find((m) => m.id === formData.medicine_id);
      const payload = {
        ...formData,
        medicine_name: selectedMed ? selectedMed.name : formData.medicine_id,
        current_stock: Number(formData.current_stock),
        daily_consumption: Number(formData.daily_consumption),
        beds_available: Number(formData.beds_available),
        doctors_present: Number(formData.doctors_present),
        nurses_present: Number(formData.nurses_present),
        patient_footfall: Number(formData.patient_footfall)
      };
      const res = await submitPHCUpdate(payload);
      setSuccessResult(res);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to submit update');
    } finally {
      setLoading(false);
    }
  };

  const selectedPhc = SAMPLE_PHCS.find((p) => p.id === formData.phc_id);
  const daysRemaining = formData.daily_consumption > 0
    ? (formData.current_stock / formData.daily_consumption).toFixed(1)
    : '0';

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>PHC Daily Telemetry Data Entry</Typography>
          <Typography variant="caption" color="text.secondary">Real-time inventory and capacity sync to National Health Grid</Typography>
        </Box>
        <Box sx={{ width: 120 }}>
          <TextField select size="small" label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} fullWidth>
            {LANGUAGES.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
          </TextField>
        </Box>
      </Box>

      <Paper sx={{ p: 1.5, mb: 2, bgcolor: '#f0f9ff' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#0369a1' }}>Demo Scenarios:</Typography>
          <Button size="small" variant="outlined" onClick={() => handlePreset('PUNE_CRITICAL')}>MH-PUNE-003 Deficit</Button>
          <Button size="small" variant="outlined" onClick={() => handlePreset('SURPLUS')}>MH-PUNE-011 Surplus</Button>
        </Stack>
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 2.5, borderRadius: 2 }}>
            <form onSubmit={handleSubmit}>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 8 }}>
                  <TextField select fullWidth label="PHC Facility" name="phc_id" value={formData.phc_id} onChange={handleChange} required size="small">
                    {SAMPLE_PHCS.map((p) => (<MenuItem key={p.id} value={p.id}>{p.name} ({p.id})</MenuItem>))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth label="Location" value={selectedPhc ? `${selectedPhc.district}, ${selectedPhc.state}` : ''} disabled size="small" />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField select fullWidth label="Medicine" name="medicine_id" value={formData.medicine_id} onChange={handleChange} required size="small">
                    {SAMPLE_MEDICINES.map((m) => (<MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth type="number" label="Stock" name="current_stock" value={formData.current_stock} onChange={handleChange} required size="small" />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth type="number" label="Daily Use" name="daily_consumption" value={formData.daily_consumption} onChange={handleChange} required size="small" />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth type="number" label="Beds" name="beds_available" value={formData.beds_available} onChange={handleChange} required size="small" />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth type="number" label="Doctors" name="doctors_present" value={formData.doctors_present} onChange={handleChange} required size="small" />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth type="number" label="Nurses" name="nurses_present" value={formData.nurses_present} onChange={handleChange} required size="small" />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth type="number" label="Footfall" name="patient_footfall" value={formData.patient_footfall} onChange={handleChange} required size="small" />
                </Grid>
              </Grid>
              {errorMsg && <Alert severity="error" sx={{ mt: 2 }}>{errorMsg}</Alert>}
              {successResult && <Alert severity="success" sx={{ mt: 2 }}>{successResult.message}</Alert>}
              <Box sx={{ mt: 2 }}>
                <Button type="submit" variant="contained" disabled={loading} sx={{ fontWeight: 700 }}>
                  {loading ? <CircularProgress size={20} /> : 'Submit Telemetry'}
                </Button>
              </Box>
            </form>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2, borderRadius: 2, bgcolor: Number(daysRemaining) <= 3 ? '#fef2f2' : '#f0fdf4' }}>
            <Typography variant="overline" sx={{ fontWeight: 700 }}>DAYS OF STOCK REMAINING</Typography>
            <Typography variant="h3" sx={{ fontWeight: 800 }}>{daysRemaining} Days</Typography>
            <Chip label={Number(daysRemaining) <= 3 ? 'CRITICAL DEFICIT' : 'HEALTHY BUFFER'} color={Number(daysRemaining) <= 3 ? 'error' : 'success'} size="small" sx={{ mb: 2 }} />
            <Typography variant="body2">• Footfall: {formData.patient_footfall} patients/day</Typography>
            <Typography variant="body2">• Staff: {formData.doctors_present} Dr, {formData.nurses_present} Nurse</Typography>
            <Typography variant="body2">• Beds: {formData.beds_available} Open</Typography>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}

