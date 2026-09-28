import React, { useState } from 'react';
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
import PHCUpdatePage from './pages/PHCUpdatePage';
import InventoryDashboard from './pages/InventoryDashboard';

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

        {currentView === 'phc-update' ? <PHCUpdatePage /> : <InventoryDashboard />}

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

