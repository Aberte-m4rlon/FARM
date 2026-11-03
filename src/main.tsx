import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './alpasfarm-theme.css';
import App from './App.tsx';

const rootEl = document.getElementById('root')!;

// Catch any startup error so we don't get a blank white/dark screen
try {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  rootEl.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#061220;color:#fff;font-family:sans-serif;text-align:center;padding:20px"><div><h2 style="color:#238B45;margin-bottom:12px">AlpasFarm</h2><p style="color:#94A3B8">Loading error. Please hard-refresh the page.<br/><small style="opacity:0.5">${String(err).slice(0,120)}</small></p></div></div>`;
}
