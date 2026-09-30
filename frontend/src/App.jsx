import React, { useState } from 'react';
import './App.css';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Box,
  AppBar,
  Toolbar,
  Typography,
  Button,
  Chip,
  Stack
} from '@mui/material';
import { getRolePermissions } from './auth/roles';
import { DEMO_USER } from './auth/demo';
import InventoryDashboard from './pages/InventoryDashboard';
import AlertsPage from './pages/AlertsPage';
import TransferTrackingPage from './pages/TransferTrackingPage';
import NationalMapPage from './pages/NationalMapPage';
import AddDistrictPage from './pages/AddDistrictPage';
import { buildEmergencyTickerText } from './services/emergency';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1a554d',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#b3c94a',
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
  const [emergencyState, setEmergencyState] = useState({
    scenario: 'normal',
    active: false,
    tickerVisible: false
  });
  const profile = DEMO_USER;
  const permissions = getRolePermissions(profile.role);

  function handleEmergencyScenarioChange(nextScenario) {
    const normalized = nextScenario || 'normal';
    setEmergencyState({
      scenario: normalized,
      active: normalized !== 'normal',
      tickerVisible: normalized !== 'normal'
    });
  }

  function handleCloseTicker() {
    setEmergencyState((current) => ({ ...current, tickerVisible: false }));
  }

  const emergencyTickerText = buildEmergencyTickerText(null, emergencyState.scenario);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="primary" elevation={1}>
          <Toolbar sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(190px, auto) minmax(0, 1fr)' }, gap: { xs: 0.75, lg: 2 }, minHeight: { xs: 96, lg: 72 }, py: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, cursor: 'pointer', minWidth: 0 }} onClick={() => setCurrentView('home')}>
              <Typography variant="h6" component="div" noWrap sx={{ fontWeight: 800 }}>
                SwasthyaSetu AI
              </Typography>
              <Chip
                label="National PHC Grid"
                size="small"
                sx={{ flex: '0 0 auto', bgcolor: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 600 }}
              />
            </Box>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, justifyContent: { xs: 'flex-start', lg: 'flex-end' }, overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'thin' }}>
              <Button
                onClick={() => setCurrentView('map')}
                sx={{ flex: '0 0 auto', color: 'white', bgcolor: currentView === 'map' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600, px: 1 }}
              >
                National Map
              </Button>
              <Button
                onClick={() => setCurrentView('home')}
                sx={{ flex: '0 0 auto', color: 'white', bgcolor: currentView === 'home' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600, px: 1 }}
              >
                Overview
              </Button>
              <Button
                onClick={() => setCurrentView('alerts')}
                sx={{ flex: '0 0 auto', color: 'white', bgcolor: currentView === 'alerts' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600, px: 1 }}
              >
                Alerts
              </Button>
              <Button
                onClick={() => setCurrentView('transfers')}
                sx={{ flex: '0 0 auto', color: 'white', bgcolor: currentView === 'transfers' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600, px: 1 }}
              >
                Transfers
              </Button>
              {permissions.canManageDistricts && <Button
                variant="outlined"
                onClick={() => setCurrentView('add-district')}
                sx={{ borderColor: 'rgba(255,255,255,0.7)', bgcolor: currentView === 'add-district' ? 'white' : 'transparent', color: currentView === 'add-district' ? '#0369a1' : 'white', fontWeight: 700 }}
              >
                Add District
              </Button>}
              <Chip label="Prototype Operations" size="small" sx={{ flex: '0 0 auto', bgcolor: 'rgba(255,255,255,.2)', color: 'white', fontWeight: 700 }} />
            </Stack>
          </Toolbar>
        </AppBar>

          {emergencyState.active && emergencyState.tickerVisible && emergencyTickerText && (
            <div className="emergency-news-ticker" role="status" aria-live="polite">
              <div className="emergency-news-ticker__bar">
                <div className="emergency-news-ticker__track">
                  <span className="emergency-news-ticker__text">{emergencyTickerText}</span>
                  <span className="emergency-news-ticker__text">{emergencyTickerText}</span>
                </div>
              </div>
              <button type="button" className="emergency-news-ticker__close" onClick={handleCloseTicker} aria-label="Close emergency alert">
                ×
              </button>
            </div>
          )}
          {currentView === 'map'
            ? <NationalMapPage permissions={permissions} emergencyState={emergencyState} />
              : currentView === 'add-district'
                ? permissions.canManageDistricts ? <AddDistrictPage user={profile} /> : <InventoryDashboard permissions={permissions} currentUser={profile} emergencyState={emergencyState} onEmergencyChange={handleEmergencyScenarioChange} />
                : currentView === 'alerts'
              ? <AlertsPage permissions={permissions} currentUser={profile} emergencyState={emergencyState} onTransferGenerated={() => setCurrentView('transfers')} />
              : currentView === 'transfers'
                ? <TransferTrackingPage currentUser={profile} permissions={permissions} emergencyState={emergencyState} />
                : <InventoryDashboard permissions={permissions} currentUser={profile} emergencyState={emergencyState} onEmergencyChange={handleEmergencyScenarioChange} onTransferGenerated={() => setCurrentView('transfers')} />}

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

