import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Analytics } from '@vercel/analytics/react';
import App from './App.jsx';

function VercelUtils() {
  return createPortal(
    <>
      <SpeedInsights />
      <Analytics />
    </>,
    document.getElementById('vercel-utils')
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <VercelUtils />
  </StrictMode>
);
