import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Guard against noisy third-party browser extension scripts (chrome-extension://)
if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (event) => {
      const filename = event.filename || '';
      const message = event.message || '';
      if (
        filename.startsWith('chrome-extension://') ||
        message.includes('chrome: call method')
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true
  );

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      const reason = String(event.reason?.stack || event.reason?.message || event.reason || '');
      if (
        reason.includes('chrome-extension://') ||
        reason.includes('chrome: call method')
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true
  );
}

createRoot(document.getElementById('root')!).render(<App />);
