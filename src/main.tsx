import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { initializeDesktopLifecycle } from './services/desktopLifecycle';
import './styles/app.css';
import './styles/timer.css';
import './styles/desktop.css';
import './styles/window-fixes.css';

void initializeDesktopLifecycle().catch((error) => {
  console.error('Dayforge desktop lifecycle initialization failed:', error);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
