import React from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles/app.css';
import './styles/player.css';
import './styles/auth.css';
import './styles/itinerary.css';
import './styles/tours.css';
import './styles/studio.css';
import './styles/shell.css';
import './styles/discover.css';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { applyStoredTheme } from './hooks/useTheme.js';

applyStoredTheme();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
);
