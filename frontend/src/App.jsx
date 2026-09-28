import React, { useState } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Box,
  AppBar,
  Toolbar,
  Typography,
  Container,
  Paper,
  Button,
  Grid,
  Chip,
  Card,
  CardContent,
  Stack
} from '@mui/material';
import PHCUpdatePage from './pages/PHCUpdatePage';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0284c7',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#10b981',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
});

function App() {
  const [currentView, setCurrentView] = useState('home');

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="primary" elevation={1}>
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }} onClick={() => setCurrentView('home')}>
              <Typography variant="h6" component="div" sx={{ fontWeight: 800 }}>
                SwasthyaSetu AI
              </Typography>
              <Chip
                label="National PHC Grid"
                size="small"
                sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 600 }}
              />
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                onClick={() => setCurrentView('home')}
                sx={{ color: 'white', bgcolor: currentView === 'home' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600 }}
              >
                Overview
              </Button>
              <Button
                variant="outlined"
                onClick={() => setCurrentView('phc-update')}
                sx={{ borderColor: 'rgba(255,255,255,0.7)', bgcolor: currentView === 'phc-update' ? 'white' : 'transparent', color: currentView === 'phc-update' ? '#0369a1' : 'white', fontWeight: 700 }}
              >
                PHC Data Entry
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>

        {currentView === 'phc-update' ? (
          <PHCUpdatePage />
        ) : (
          <Container maxWidth="lg" sx={{ mt: 6, mb: 6, flexGrow: 1 }}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 3, md: 5 },
              borderRadius: 3,
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: 'white',
              textAlign: 'center',
            }}
          >
            <Typography variant="overline" sx={{ letterSpacing: 2, color: '#bae6fd', fontWeight: 600 }}>
              FEDERATED AI PLATFORM FOR HEALTHCARE RESILIENCE
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, mt: 1, mb: 2 }}>
              SwasthyaSetu AI
            </Typography>
            <Typography variant="body1" sx={{ maxWidth: 700, mx: 'auto', opacity: 0.95, mb: 3, lineHeight: 1.6 }}>
              Real-time visibility into medicine stocks, bed availability, and medical personnel attendance
              across India’s entire Primary Health Centre (PHC) network with predictive supply-chain redistribution.
            </Typography>
              <Stack direction="row" spacing={2} justifyContent="center">
                <Button
                  variant="contained"
                  onClick={() => setCurrentView('phc-update')}
                  sx={{ bgcolor: 'white', color: '#0369a1', fontWeight: 700, px: 3 }}
                >
                  Open PHC Data Entry
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => setCurrentView('phc-update')}
                  sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.7)', fontWeight: 600 }}
                >
                  Supply Chain Telemetry
                </Button>
              </Stack>
            </Paper>

            <Box sx={{ mt: 5 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 3, color: '#0f172a' }}>
                Core Capabilities
              </Typography>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Card sx={{ borderRadius: 2, height: '100%', border: '1px solid #e2e8f0' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: '#0369a1' }}>
                        PHC Network Visibility
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Telemetry tracking essential medicine inventories, cold-chain units, bed occupancy, and medical staff duty roster.
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Card sx={{ borderRadius: 2, height: '100%', border: '1px solid #e2e8f0' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: '#059669' }}>
                        AI Stockout Early Warning
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Demand forecasting identifying localized surges, seasonal disease spikes, and buffer depletion 14 days in advance.
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Card sx={{ borderRadius: 2, height: '100%', border: '1px solid #e2e8f0' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: '#7c3aed' }}>
                        Automated Redistribution
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Cross-district dynamic transfer recommendations to rebalance stockpiles before expiry and eliminate regional shortages.
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          </Container>
        )}

        <Box component="footer" sx={{ py: 3, px: 2, mt: 'auto', backgroundColor: '#f1f5f9', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            SwasthyaSetu AI • Built for India at Indian Scale • Google Cloud Build with AI Hackathon
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;

