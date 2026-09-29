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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getRoleForEmail, getRolePermissions, ROLE_DESCRIPTIONS, ROLE_LABELS } from './auth/roles';
import PHCUpdatePage from './pages/PHCUpdatePage';
import InventoryDashboard from './pages/InventoryDashboard';
import AlertsPage from './pages/AlertsPage';
import TransferTrackingPage from './pages/TransferTrackingPage';
import NationalMapPage from './pages/NationalMapPage';
import AddDistrictPage from './pages/AddDistrictPage';
import TransferRequestDialog from './pages/TransferRequestDialog';

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
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestContext, setRequestContext] = useState(null);
  const permissions = getRolePermissions(profile?.role);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;
      setUser(firebaseUser);
      setProfile(null);
      setAuthError('');
      setAuthLoading(true);
      if (!firebaseUser) {
        setAuthLoading(false);
        return;
      }

      const email = String(firebaseUser.email || '').toLowerCase();
      const role = getRoleForEmail(email);
      if (!role) {
        setAuthError('This Google account is not assigned an application role.');
        setAuthLoading(false);
        return;
      }

      try {
        const profileRef = doc(db, 'users', firebaseUser.uid);
        const existing = await getDoc(profileRef);
        const existingData = existing.exists() ? existing.data() : {};
        const now = new Date().toISOString();
        const nextProfile = {
          name: firebaseUser.displayName || email,
          email,
          role,
          location: existingData.location || '',
          created_at: existingData.created_at || now,
          updated_at: now
        };
        await setDoc(profileRef, nextProfile, { merge: true });
        if (active) setProfile({ uid: firebaseUser.uid, ...nextProfile });
      } catch (error) {
        console.error('Could not load the signed-in user role:', error);
        if (active) setAuthError('Could not load your role profile. Check Firebase access and retry.');
      } finally {
        if (active) setAuthLoading(false);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

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
              {permissions.canManageDistricts && <Button
                variant="outlined"
                onClick={() => setCurrentView('add-district')}
                sx={{ borderColor: 'rgba(255,255,255,0.7)', bgcolor: currentView === 'add-district' ? 'white' : 'transparent', color: currentView === 'add-district' ? '#0369a1' : 'white', fontWeight: 700 }}
              >
                Add District
              </Button>}
              {permissions.canUpdateStock && <Button
                variant="outlined"
                onClick={() => setCurrentView('phc-update')}
                sx={{ borderColor: 'rgba(255,255,255,0.7)', bgcolor: currentView === 'phc-update' ? 'white' : 'transparent', color: currentView === 'phc-update' ? '#0369a1' : 'white', fontWeight: 700 }}
              >
                PHC Data Entry
              </Button>}
              {permissions.canRaiseTransferRequest && <Button onClick={() => { setRequestContext(null); setRequestOpen(true); }} sx={{ color: 'white', fontWeight: 700 }}>
                Raise Transfer Request
              </Button>}
              {profile && <Chip
                label={`${ROLE_LABELS[profile.role]} · ${ROLE_DESCRIPTIONS[profile.role]}`}
                size="small"
                sx={{ color: 'white', borderColor: 'rgba(255,255,255,.55)', fontWeight: 700 }}
                variant="outlined"
              />}
              <Button onClick={handleAuth} disabled={authLoading} sx={{ color: 'white', fontWeight: 700 }}>
                {authLoading ? 'Checking role...' : user ? 'Sign out' : 'Google sign in'}
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>

          {authError && <Alert severity="error" onClose={() => setAuthError('')}>{authError}</Alert>}
          {currentView === 'phc-update'
            ? permissions.canUpdateStock ? <PHCUpdatePage /> : <InventoryDashboard permissions={permissions} currentUser={profile} />
            : currentView === 'map'
              ? <NationalMapPage />
              : currentView === 'add-district'
                ? permissions.canManageDistricts ? <AddDistrictPage user={profile} /> : <InventoryDashboard permissions={permissions} currentUser={profile} />
                : currentView === 'alerts'
              ? <AlertsPage permissions={permissions} currentUser={profile} onRaiseTransferRequest={(row) => { setRequestContext(row); setRequestOpen(true); }} onTransferGenerated={() => setCurrentView('transfers')} />
              : currentView === 'transfers'
                ? <TransferTrackingPage currentUser={profile} permissions={permissions} />
                : <InventoryDashboard permissions={permissions} currentUser={profile} onRaiseTransferRequest={(row) => { setRequestContext(row); setRequestOpen(true); }} onTransferGenerated={() => setCurrentView('transfers')} />}

          {requestOpen && <TransferRequestDialog
            open={requestOpen}
            userProfile={profile}
            initialRow={requestContext}
            onClose={() => setRequestOpen(false)}
            onSubmitted={() => { setRequestOpen(false); setCurrentView('transfers'); }}
          />}

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

