import React, { useEffect, useState } from 'react';
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
  Stack,
  Alert
} from '@mui/material';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from './firebase';
import PHCUpdatePage from './pages/PHCUpdatePage';
import InventoryDashboard from './pages/InventoryDashboard';
import AlertsPage from './pages/AlertsPage';
import TransferTrackingPage from './pages/TransferTrackingPage';
import NationalMapPage from './pages/NationalMapPage';
import AddDistrictPage from './pages/AddDistrictPage';

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
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function handleAuth() {
    setAuthError('');
    try {
      if (user) await signOut(auth);
      else await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      setAuthError(error.message || 'Google sign-in could not be completed.');
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="primary" elevation={1}>
          <Toolbar sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
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
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button
                onClick={() => setCurrentView('map')}
                sx={{ color: 'white', bgcolor: currentView === 'map' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600 }}
              >
                National Map
              </Button>
              <Button
                onClick={() => setCurrentView('home')}
                sx={{ color: 'white', bgcolor: currentView === 'home' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600 }}
              >
                Overview
              </Button>
              <Button
                onClick={() => setCurrentView('alerts')}
                sx={{ color: 'white', bgcolor: currentView === 'alerts' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600 }}
              >
                Alerts
              </Button>
              <Button
                onClick={() => setCurrentView('transfers')}
                sx={{ color: 'white', bgcolor: currentView === 'transfers' ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: 600 }}
              >
                Transfers
              </Button>
              <Button
                variant="outlined"
                onClick={() => setCurrentView('add-district')}
                sx={{ borderColor: 'rgba(255,255,255,0.7)', bgcolor: currentView === 'add-district' ? 'white' : 'transparent', color: currentView === 'add-district' ? '#0369a1' : 'white', fontWeight: 700 }}
              >
                Add District
              </Button>
              <Button
                variant="outlined"
                onClick={() => setCurrentView('phc-update')}
                sx={{ borderColor: 'rgba(255,255,255,0.7)', bgcolor: currentView === 'phc-update' ? 'white' : 'transparent', color: currentView === 'phc-update' ? '#0369a1' : 'white', fontWeight: 700 }}
              >
                PHC Data Entry
              </Button>
              <Button onClick={handleAuth} sx={{ color: 'white', fontWeight: 700 }}>
                {user ? 'Sign out' : 'Google sign in'}
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>

          {authError && <Alert severity="error" onClose={() => setAuthError('')}>{authError}</Alert>}
          {currentView === 'phc-update'
            ? <PHCUpdatePage />
            : currentView === 'map'
              ? <NationalMapPage />
              : currentView === 'add-district'
                ? <AddDistrictPage user={user} />
                : currentView === 'alerts'
              ? <AlertsPage onTransferGenerated={() => setCurrentView('transfers')} />
              : currentView === 'transfers'
                ? <TransferTrackingPage />
                : <InventoryDashboard onTransferGenerated={() => setCurrentView('transfers')} />}

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

