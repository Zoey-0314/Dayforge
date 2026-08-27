# AGENTS.md

## Project

Dayforge is a Windows-first desktop productivity widget built with Tauri 2, React, TypeScript and local SQLite persistence.

This file defines implementation rules for Codex and other coding agents working in this repository.

## Product invariant

The compact Dayforge window is intentionally minimal.

When collapsed, the application must show only:

- a slim level / EXP strip;
- the GitHub-style activity heatmap;
- Month / Year switching;
- a minimal expand affordance.

Do not expose To-do, Habit, Timer or Sleep UI in collapsed mode.

Expanded mode reveals the secondary modules.

## Development priorities

Work in small, testable milestones. Do not scaffold fake production behavior just to make the interface appear complete.

Preferred order:

1. Tauri shell boots.
2. Compact window works.
3. Heatmap works.
4. SQLite works.
5. EXP system works.
6. Expand/collapse works.
7. To-do works.
8. Habit works.
9. Timer works.
10. Daily login and online EXP work.
11. Sleep record works.
12. Desktop polish and packaging.

Each milestone should leave the app runnable.

## Required stack

Unless there is a strong technical reason to change it, use:

- Tauri 2
- React
- TypeScript
- Tailwind CSS
- Zustand
- SQLite
- date-fns

For charts, prefer lightweight custom SVG when the chart is simple. Use Recharts only when it meaningfully reduces complexity.

## Architecture rules

### 1. Keep UI thin

React components should render state and invoke actions. They should not contain core business rules.

Bad:

```ts
setExp(exp + 25)
```

Good:

```ts
await experienceService.grant(...)
```

### 2. EXP must be centralized

All EXP changes pass through a shared experience service and generate immutable ledger records.

Sources currently include:

- TODO
- HABIT
- TIMER
- DAILY_LOGIN
- ONLINE

Do not add a second EXP counter or feature-local EXP state that can diverge from the ledger.

### 3. SQLite is the durable source of truth

Do not treat Zustand, React state, localStorage, or hard-coded fixtures as final persistence for core domain data.

Core durable records include:

- tasks and task completions;
- habits and habit check-ins;
- timer sessions;
- sleep records;
- experience logs;
- app settings.

### 4. Preserve history

Prefer append-only history for events such as:

- task completions;
- habit check-ins;
- timer sessions;
- EXP changes.

If an action is reversed, prefer a compensating record where appropriate instead of silently deleting accounting history.

### 5. Daily logic is date-based, not deletion-based

Daily To-do tasks should not be physically reset by deleting completion data at midnight.

Determine today's state using local `YYYY-MM-DD` completion history.

The same principle applies to:

- daily login;
- habit reward caps;
- online EXP caps;
- daily heatmap totals.

### 6. Time calculations must be robust

Do not rely on UI `setInterval` ticks as the source of truth for elapsed timer duration.

Use timestamps and calculate elapsed time from them.

Do not grant online EXP for long unverified gaps because the device may have slept or suspended the app.

## Initial product rules

### Difficulty rewards

- Easy: 10 EXP
- Medium: 25 EXP
- Hard: 50 EXP

Store these values in one configuration/module rather than duplicating numeric literals.

### Level progression

Initial rule:

```text
next-level EXP requirement = current level × 100
```

Keep the formula isolated so it can change later.

### Timer

Initial categories:

- Studying
- Working
- Exercise
- Custom

Initial reward rule:

```text
base EXP = floor(completed minutes / 5)
```

Difficulty multipliers:

- Easy: 1.0
- Medium: 1.5
- Hard: 2.0

Round final rewards consistently in one helper/service.

### Daily login

- +10 EXP once per local calendar day.

### Online EXP

- +1 EXP per 5 verified active minutes.
- maximum +30 ONLINE EXP per local day.

### Sleep

Sleep Record is tracking-only in the initial release.

Do not grant EXP from sleep data.

## UI rules

### Visual direction

Use a restrained blue glassmorphism style:

- rounded floating panels;
- translucent surfaces;
- subtle blur;
- gentle shadows;
- thin inner highlight/border;
- readable contrast over varied wallpapers;
- restrained animation.

Avoid excessive neon effects, oversized gradients, or a game-dashboard aesthetic.

### Compact window

Target approximately 320×320 px for the initial compact state.

Required characteristics:

- frameless;
- draggable;
- rounded content surface;
- transparent/blur-capable background where practical;
- optional always-on-top;
- heatmap is the visual focus.

### Heatmap

Use blue intensity levels derived from daily EXP totals.

Initial thresholds:

- 0: empty
- 1–20: level 1
- 21–50: level 2
- 51–100: level 3
- 101–200: level 4
- 201+: level 5

Support:

- Month view
- Year view

Hover/click detail may show date and EXP.

### To-do

Two distinct sections:

- Daily To-do
- Persistent To-do

Completed To-do items:

- checked;
- struck through;
- completion recorded;
- EXP granted once per eligible completion.

### Habit Check-in

Habit rows must never be styled as permanently completed.

A check-in:

- records an event;
- increments derived counts;
- may grant EXP;
- leaves the habit available for another check-in.

### Sleep chart

Weekly chart should visually resemble a sleep schedule plot:

- Mon–Sun vertically;
- hour scale across the top;
- bedtime and wake points;
- horizontal sleep interval per day;
- clear support for times crossing midnight.

## Code quality rules

- Enable TypeScript strict mode.
- Avoid `any` unless unavoidable and documented.
- Keep modules small and domain-focused.
- Prefer named types/interfaces for domain data.
- Avoid large components that mix database access, business logic and rendering.
- Use explicit error handling for persistence operations.
- Do not leave disabled production logic behind commented-out blocks.
- Do not commit generated build artifacts.
- Keep documentation synchronized when product rules materially change.

## Testing

Business-rule tests are more important than snapshot tests.

Prioritize tests for:

- level thresholds;
- difficulty reward mapping;
- timer EXP formula;
- one-login-reward-per-day behavior;
- online EXP daily cap;
- daily To-do reset behavior across date boundaries;
- prevention of duplicate EXP grants;
- habit reward caps;
- heatmap aggregation from experience logs;
- sleep ranges that cross midnight.

## Git workflow

For substantial implementation work:

- create a focused feature branch;
- make coherent commits;
- run available checks before opening a PR;
- summarize what changed and what remains incomplete.

Do not mix unrelated refactors into feature work unless required for correctness.

## First implementation task

If the repository does not yet contain the application scaffold, the first coding task is:

1. Bootstrap a Tauri 2 + React + TypeScript app in this repository.
2. Add Tailwind CSS.
3. Configure a Windows-first frameless main window around 320×320 px.
4. Make the content surface rounded and glass-like.
5. Add a reliable custom drag region.
6. Add a static GitHub-style blue heatmap with Month / Year switch UI.
7. Do not implement To-do, Habit, Timer or Sleep yet.
8. Keep the structure ready for the feature folders described in `docs/ARCHITECTURE.md`.
9. Run the relevant build/type checks and fix failures before concluding.

The first milestone is successful only when the project can actually run as a desktop app, not merely when files exist.
