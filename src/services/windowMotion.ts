import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';

// The native window includes an 8px transparent gutter around the visible
// glass. The visible glass itself stays 320x320 compact and 980x680 expanded.
const COMPACT_SIZE = { width: 336, height: 336 };
const EXPANDED_SIZE = { width: 996, height: 696 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function smoothEase(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function subtleSpringEase(t: number): number {
  const c1 = 0.46;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export async function animateDayforgeWindowResize(expanding: boolean): Promise<void> {
  const appWindow = getCurrentWindow();
  const from = expanding ? COMPACT_SIZE : EXPANDED_SIZE;
  const to = expanding ? EXPANDED_SIZE : COMPACT_SIZE;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await appWindow.setSize(new LogicalSize(to.width, to.height));
    return;
  }

  const steps = expanding ? 20 : 18;
  const duration = expanding ? 380 : 330;
  const frameDelay = duration / steps;

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const eased = expanding ? subtleSpringEase(t) : smoothEase(t);
    const width = Math.round(from.width + (to.width - from.width) * eased);
    const height = Math.round(from.height + (to.height - from.height) * eased);
    await appWindow.setSize(new LogicalSize(width, height));
    if (step < steps) await sleep(frameDelay);
  }

  await appWindow.setSize(new LogicalSize(to.width, to.height));
}
