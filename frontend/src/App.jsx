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
  Alert,
  CircularProgress
} from '@mui/material';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getRoleForEmail, getRolePermissions, ROLE_DESCRIPTIONS, ROLE_LABELS } from './auth/roles';
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
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signInPending, setSignInPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const permissions = getRolePermissions(profile?.role);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;
      setUser(firebaseUser);
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

  async function handleSignIn() {
    setAuthError('');
    setSignInPending(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      setAuthError(error.message || 'Google sign-in could not be completed.');
    } finally {
      setSignInPending(false);
    }
  }

  async function handleSignOut() {
    setAuthError('');
    await signOut(auth);
    setCurrentView('home');
  }

  if (authLoading || (user && !profile && !authError)) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
          <Stack spacing={2} alignItems="center">
            <CircularProgress size={28} />
            <Typography color="text.secondary">Loading your dashboard...</Typography>
          </Stack>
        </Box>
      </ThemeProvider>
    );
  }

  if (!profile) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
          <Box sx={{ width: 'min(420px, 100%)', p: { xs: 3, sm: 4 }, bgcolor: 'background.paper', border: '1px solid #dfe8e1', borderTop: '4px solid #1a554d', borderRadius: 1 }}>
            <Typography variant="overline" sx={{ color: '#56805b', fontWeight: 800 }}>SWASTHYASETU AI</Typography>
            <Typography variant="h4" sx={{ mt: 0.5, color: '#193330', fontWeight: 800 }}>Sign in</Typography>
            <Typography sx={{ mt: 1, mb: 2.5, color: 'text.secondary' }}>Use your assigned account to open the health operations dashboard.</Typography>
            {authError && <Alert severity="error" sx={{ mb: 2 }}>{authError}</Alert>}
            <Button fullWidth variant="contained" onClick={user ? handleSignOut : handleSignIn} disabled={signInPending} sx={{ minHeight: 44, fontWeight: 750 }}>
              {signInPending ? <CircularProgress size={19} sx={{ color: 'inherit' }} /> : user ? 'Use another account' : 'Sign in'}
            </Button>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

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
              <Box sx={{ flex: '0 0 126px', width: 126, pl: 1, borderLeft: '1px solid rgba(255,255,255,.28)', overflow: 'hidden' }}>
                <Typography noWrap sx={{ color: 'white', fontSize: 11, fontWeight: 750 }}>{ROLE_LABELS[profile.role]}</Typography>
                <Typography noWrap sx={{ color: 'rgba(255,255,255,.76)', fontSize: 9 }}>{ROLE_DESCRIPTIONS[profile.role]}</Typography>
              </Box>
              <Button onClick={handleSignOut} sx={{ flex: '0 0 auto', color: 'white', fontWeight: 700, minWidth: 74, px: 1 }}>
                Sign out
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>

          {authError && <Alert severity="error" onClose={() => setAuthError('')}>{authError}</Alert>}
          {currentView === 'map'
              ? <NationalMapPage />
              : currentView === 'add-district'
                ? permissions.canManageDistricts ? <AddDistrictPage user={profile} /> : <InventoryDashboard permissions={permissions} currentUser={profile} />
                : currentView === 'alerts'
              ? <AlertsPage permissions={permissions} currentUser={profile} onTransferGenerated={() => setCurrentView('transfers')} />
              : currentView === 'transfers'
                ? <TransferTrackingPage currentUser={profile} permissions={permissions} />
                : <InventoryDashboard permissions={permissions} currentUser={profile} onTransferGenerated={() => setCurrentView('transfers')} />}

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

