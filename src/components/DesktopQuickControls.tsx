import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  getAlwaysOnTopPreference,
  getLaunchOnStartupPreference,
  setAlwaysOnTopPreference,
  setLaunchOnStartupPreference,
} from '../services/desktopLifecycle';

export function DesktopQuickControls() {
  const [visible, setVisible] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function load() {
      const window = getCurrentWindow();
      const size = await window.outerSize();
      const [pin, startup] = await Promise.all([
        getAlwaysOnTopPreference(),
        getLaunchOnStartupPreference(),
      ]);

      if (!disposed) {
        setVisible(size.width > 500);
        setAlwaysOnTop(pin);
        setLaunchOnStartup(startup);
      }

      unlisten = await window.onResized(({ payload }) => {
        if (!disposed) setVisible(payload.width > 500);
      });
    }

    void load().catch((error) => {
      console.error('Could not load desktop preferences:', error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!visible) return null;

  async function togglePin() {
    if (busy) return;
    const next = !alwaysOnTop;
    setBusy(true);
    try {
      await setAlwaysOnTopPreference(next);
      setAlwaysOnTop(next);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStartup() {
    if (busy) return;
    const next = !launchOnStartup;
    setBusy(true);
    try {
      await setLaunchOnStartupPreference(next);
      setLaunchOnStartup(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="desktop-quick-controls" aria-label="Desktop preferences">
      <button
        type="button"
        className={alwaysOnTop ? 'is-active' : ''}
        aria-pressed={alwaysOnTop}
        disabled={busy}
        onClick={() => void togglePin()}
      >
        {alwaysOnTop ? 'Pinned' : 'Pin'}
      </button>
      <button
        type="button"
        className={launchOnStartup ? 'is-active' : ''}
        aria-pressed={launchOnStartup}
        disabled={busy}
        onClick={() => void toggleStartup()}
      >
        {launchOnStartup ? 'Starts with Windows' : 'Start with Windows'}
      </button>
    </aside>
  );
}
