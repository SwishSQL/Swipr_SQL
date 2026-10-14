
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setPendingScan } from './pendingScan';
import './index.css';

// The attendance QR points at "/?c=<code>" — a real query string, because a
// URL fragment doesn't survive some camera apps or the HTTP->HTTPS redirect.
// Stash the code and hand off to the /scan route before the router mounts.
(() => {
  try {
    const code = new URLSearchParams(window.location.search).get('c');
    if (!code) return;
    setPendingScan(code);
    window.history.replaceState(null, '', `${window.location.pathname}#/scan`);
  } catch { /* ignore */ }
})();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
