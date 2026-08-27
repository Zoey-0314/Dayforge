import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { getSetting, setSetting } from '../db/database';

export type WindowPosition = {
  x: number;
  y: number;
};

const WINDOW_POSITION_KEY = 'window_position';
const ALWAYS_ON_TOP_KEY = 'always_on_top';
const AUTOSTART_KEY = 'launch_on_startup';

function isFinitePosition(value: unknown): value is WindowPosition {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<WindowPosition>;
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

async function isPositionVisible(position: WindowPosition): Promise<boolean> {
  const monitors = await availableMonitors();
  const minimumVisible = 80;

  return monitors.some((monitor) => {
    const left = monitor.position.x;
    const top = monitor.position.y;
    const right = left + monitor.size.width;
    const bottom = top + monitor.size.height;

    return (
      position.x < right - minimumVisible &&
      position.y < bottom - minimumVisible &&
      position.x + minimumVisible > left &&
      position.y + minimumVisible > top
    );
  });
}

export async function restoreDesktopWindowState(): Promise<void> {
  const window = getCurrentWindow();
  const [savedPosition, alwaysOnTop] = await Promise.all([
    getSetting<WindowPosition | null>(WINDOW_POSITION_KEY, null),
    getSetting<boolean>(ALWAYS_ON_TOP_KEY, true),
  ]);

  await window.setAlwaysOnTop(alwaysOnTop);

  if (isFinitePosition(savedPosition) && (await isPositionVisible(savedPosition))) {
    await window.setPosition(new PhysicalPosition(savedPosition.x, savedPosition.y));
  } else if (savedPosition) {
    await window.center();
  }
}

export async function startWindowPositionPersistence(): Promise<() => void> {
  const window = getCurrentWindow();
  return window.onMoved(({ payload }) => {
    void setSetting(WINDOW_POSITION_KEY, {
      x: payload.x,
      y: payload.y,
    } satisfies WindowPosition);
  });
}

export async function getAlwaysOnTopPreference(): Promise<boolean> {
  return getSetting<boolean>(ALWAYS_ON_TOP_KEY, true);
}

export async function setAlwaysOnTopPreference(value: boolean): Promise<void> {
  await getCurrentWindow().setAlwaysOnTop(value);
  await setSetting(ALWAYS_ON_TOP_KEY, value);
}

export async function getLaunchOnStartupPreference(): Promise<boolean> {
  const saved = await getSetting<boolean | null>(AUTOSTART_KEY, null);
  if (saved !== null) return saved;

  const enabled = await isEnabled();
  await setSetting(AUTOSTART_KEY, enabled);
  return enabled;
}

export async function setLaunchOnStartupPreference(value: boolean): Promise<void> {
  if (value) {
    await enable();
  } else {
    await disable();
  }

  await setSetting(AUTOSTART_KEY, value);
}

export async function initializeDesktopLifecycle(): Promise<void> {
  await restoreDesktopWindowState();
  await startWindowPositionPersistence();
}
