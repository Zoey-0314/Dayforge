# Dayforge

Dayforge is a lightweight Windows desktop productivity widget that turns everyday activity into visible progress.

The compact view is designed as a small floating square window. When collapsed, it shows only a GitHub-style activity heatmap plus a slim level/EXP status bar. More detailed tools appear only after expanding the widget.

## Product vision

Dayforge combines four ideas in one persistent desktop companion:

- **To-do** — daily-reset tasks and persistent tasks that remain until completed.
- **Habit Check-in** — repeatable tasks that can be checked multiple times without being crossed out.
- **Focus Timer** — Studying, Working, Exercise and custom sessions with difficulty-based EXP rewards.
- **Sleep Record** — a weekly bedtime/wake-time chart for tracking only; sleep currently does not grant EXP.

The central visual is an activity heatmap. It works similarly to GitHub Contributions, but each day's intensity is based on EXP earned in Dayforge.

## Core experience system

EXP can currently come from:

- completing to-do tasks;
- habit check-ins;
- completed timer sessions;
- a small daily login bonus;
- slow online/active-app EXP, subject to a daily cap.

Sleep records are intentionally excluded from EXP in the initial design.

All EXP changes should pass through a single experience service and be recorded in an EXP ledger so that level progress and the heatmap can be rebuilt from data instead of UI state.

## Planned stack

- Tauri 2
- React
- TypeScript
- Tailwind CSS
- Zustand
- SQLite
- date-fns
- Recharts or a small custom SVG chart where appropriate

The first target platform is Windows 11.

## UI principles

The compact widget should:

- stay small and unobtrusive;
- use a borderless floating window;
- use rounded corners and a glassmorphism / acrylic-like surface;
- support dragging and optional always-on-top behavior;
- show only the level/EXP strip and contribution heatmap while collapsed;
- expand to reveal To-do, Habit, Timer and Sleep Record panels.

The application should remain functional offline. Core user data must be stored locally and survive restarts.

## Development roadmap

1. Bootstrap Tauri 2 + React + TypeScript.
2. Create the 320×320 compact floating window.
3. Implement the month/year contribution heatmap.
4. Add local SQLite persistence.
5. Add the unified EXP and level system.
6. Implement expand/collapse behavior.
7. Add Daily To-do and Persistent To-do.
8. Add repeatable Habit Check-in.
9. Add Focus Timer and difficulty multipliers.
10. Add daily-login and capped online EXP.
11. Add weekly Sleep Record visualization.
12. Add tray support, launch-on-startup, position persistence and installer packaging.

## Documentation

- `docs/PRD.md` — complete product requirements and rules.
- `docs/ARCHITECTURE.md` — application structure, data model and service boundaries.
- `AGENTS.md` — implementation instructions for Codex and future coding agents.

## Status

Dayforge is currently in the product-definition and project-bootstrap stage.
