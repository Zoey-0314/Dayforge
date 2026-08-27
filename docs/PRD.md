# Dayforge Product Requirements Document

## 1. Product summary

Dayforge is a Windows desktop productivity widget focused on visible daily progress, lightweight gamification, and low-friction personal tracking.

The core interaction model is deliberately split into two states:

- **Collapsed state**: a small floating square widget showing only the level/EXP strip and a GitHub-style contribution heatmap.
- **Expanded state**: additional productivity panels become visible, including To-do, Habit Check-in, Focus Timer and Sleep Record.

The collapsed widget should remain useful on its own and should not expose the detailed task interfaces until the user explicitly expands it.

## 2. Primary goals

1. Make daily effort visible through a heatmap.
2. Turn useful activity into EXP and levels without making the app feel like a game launcher.
3. Keep the compact desktop state clean enough to remain visible for long periods.
4. Separate one-time tasks from repeatable habits.
5. Persist all important user data locally.
6. Support a future path toward richer statistics without requiring cloud infrastructure in the first version.

## 3. Target platform

Initial target:

- Windows 11

Preferred application stack:

- Tauri 2
- React
- TypeScript
- Tailwind CSS
- Zustand
- SQLite

## 4. Window behavior

### 4.1 Collapsed widget

The collapsed window should approximately target 320×320 px.

Required behavior:

- frameless native window;
- rounded corners;
- translucent glass/acrylic visual treatment;
- draggable from a defined drag region;
- optional always-on-top;
- compact enough to behave like a desktop widget;
- no To-do, Habit, Timer or Sleep content visible while collapsed.

Visible content in collapsed mode:

- slim level/EXP status strip;
- contribution heatmap;
- Month / Year heatmap view switch;
- compact affordance for expanding the widget.

### 4.2 Expanded window

Expanded mode should preserve the same visual language while increasing the window size and revealing the secondary modules.

Required modules:

- To-do
- Habit Check-in
- Timer
- Sleep Record

The exact responsive layout may evolve during implementation, but the heatmap remains the visual center of the product.

## 5. Experience and level system

All EXP changes must be processed through one centralized experience service.

No feature should directly mutate total EXP from a UI component.

### 5.1 Initial difficulty rewards

Default task difficulty rewards:

| Difficulty | EXP |
| --- | ---: |
| Easy | 10 |
| Medium | 25 |
| Hard | 50 |

These values must be configurable in code and should not be duplicated across feature modules.

### 5.2 Level progression

Initial progression rule:

`EXP required for next level = current level × 100`

Example:

- Lv.1 → Lv.2: 100 EXP
- Lv.2 → Lv.3: 200 EXP
- Lv.3 → Lv.4: 300 EXP

The implementation should keep level calculation isolated so the formula can be changed later without rewriting the UI.

### 5.3 EXP ledger

Every EXP-changing event must create an immutable ledger entry containing at least:

- id
- timestamp
- source type
- source id when applicable
- human-readable description
- EXP delta

Examples of source types:

- TODO
- HABIT
- TIMER
- DAILY_LOGIN
- ONLINE

This ledger is the source of truth for:

- total EXP;
- daily activity totals;
- heatmap intensity;
- future statistics.

## 6. Contribution heatmap

The heatmap follows GitHub Contributions interaction logic but visualizes Dayforge activity.

Each day is based on total EXP earned on that date.

Initial intensity thresholds:

| Daily EXP | Intensity |
| --- | --- |
| 0 | empty |
| 1–20 | level 1 |
| 21–50 | level 2 |
| 51–100 | level 3 |
| 101–200 | level 4 |
| 201+ | level 5 |

The visual palette should use a coherent blue gradient.

Required views:

- Month
- Year

Hover or click behavior may expose the date and EXP total.

## 7. To-do system

To-do tasks are one-time completions and are visually crossed out when completed.

Two categories are required.

### 7.1 Daily To-do

Daily To-do tasks reset their completion state at the start of a new local calendar day.

Important distinction:

- the task definition can remain;
- today's completion state resets;
- completing the same daily task on a later date grants EXP again.

Each task has:

- title;
- difficulty;
- active/inactive state;
- creation timestamp;
- daily completion history.

### 7.2 Persistent To-do

Persistent tasks remain incomplete until the user completes them.

They do not reset daily.

Each task has:

- title;
- difficulty;
- completion state;
- creation timestamp;
- completion timestamp.

### 7.3 Completion behavior

When a task is completed:

- checkbox becomes checked;
- text appears struck through;
- EXP is granted according to difficulty;
- EXP ledger entry is created;
- heatmap updates through the ledger-derived daily total.

Undo behavior should be handled cautiously. If completion is reversible, EXP reversal must also create a corresponding negative ledger entry rather than deleting history.

## 8. Habit Check-in

Habit tasks are repeatable and must not behave like To-do items.

Required behavior:

- tapping/checking a habit creates a check-in event;
- the habit remains active and visible;
- the habit text is never struck through;
- each check-in can grant EXP;
- a habit can be checked multiple times, subject to an optional daily reward cap.

Each habit should support:

- title;
- difficulty;
- today count;
- total count;
- streak information;
- optional maximum EXP-eligible check-ins per day.

Initial default recommendation:

- unlimited visual check-ins;
- configurable EXP-eligible cap per habit per day.

Habit history must be stored as individual check-in records rather than only a counter.

## 9. Focus Timer

The timer is available only in expanded mode.

Initial categories:

- Studying
- Working
- Exercise
- Custom

Each session has:

- category;
- selected difficulty;
- planned or elapsed duration;
- start time;
- end time;
- completion status;
- granted EXP.

### 9.1 Initial EXP formula

Base EXP:

`floor(completed_minutes / 5)`

Difficulty multipliers:

| Difficulty | Multiplier |
| --- | ---: |
| Easy | 1.0 |
| Medium | 1.5 |
| Hard | 2.0 |

Final timer EXP should be calculated in one dedicated function and rounded consistently.

Incomplete or cancelled sessions should not grant full completion EXP.

## 10. Daily login EXP

The app grants a small bonus once per local calendar day.

Initial default:

- +10 EXP per day

The system must persist the last rewarded date so restarting the app does not grant duplicate rewards.

## 11. Online / active-app EXP

While Dayforge is running, EXP may increase slowly.

Initial rule:

- +1 EXP per 5 active minutes
- maximum +30 EXP from this source per local calendar day

Requirements:

- the daily cap must be enforced from persisted data;
- closing and reopening the app must not reset the cap;
- the implementation should avoid awarding large amounts after system sleep or suspended execution;
- the app may continue tracking runtime after the EXP cap is reached, but should stop granting ONLINE EXP.

## 12. Sleep Record

Sleep tracking is informational only in the initial version and does not grant EXP.

Each sleep record contains:

- date;
- bedtime;
- wake time.

The weekly visualization should be inspired by a hand-drawn sleep schedule chart:

- weekdays listed vertically;
- hour scale across the top;
- bedtime point on the left side of each sleep interval;
- wake-time point on the right side;
- points connected horizontally per day;
- neighboring bedtime and wake-time points may also be visually connected to make weekly rhythm easier to read.

The chart should support overnight times that cross midnight.

Future statistics may include:

- average bedtime;
- average wake time;
- average sleep duration;
- regularity score.

These are out of scope for the first implementation.

## 13. Local persistence

Core application data must survive app restarts.

SQLite is the preferred persistence layer.

Minimum logical tables:

- tasks
- task_completions
- habits
- habit_checkins
- sleep_records
- timer_sessions
- experience_logs
- app_settings

Schema migrations must be versioned.

## 14. Settings

Initial settings should be designed for future support of:

- always-on-top;
- launch on startup;
- compact window position;
- theme/glass intensity if technically practical;
- online EXP enable/disable;
- timer defaults.

Not all settings need a dedicated screen in the first milestone.

## 15. UX and visual direction

Visual style:

- glassmorphism;
- acrylic/frosted transparency;
- floating rounded cards;
- soft shadows;
- restrained blue palette;
- clean typography;
- subtle animations.

The visual design should remain readable even when the desktop wallpaper underneath is bright or busy.

Accessibility considerations:

- sufficient text contrast;
- heatmap intensity should not rely on tiny color differences alone when a tooltip/detail view is available;
- clickable targets should remain large enough for desktop pointer use.

## 16. Non-goals for the first version

The initial version should not require:

- user accounts;
- cloud sync;
- social features;
- mobile application;
- competitive leaderboards;
- sleep-based EXP;
- AI-generated task planning;
- complex achievement trees.

## 17. Implementation milestones

### Milestone 1 — Desktop shell

- Tauri 2 + React + TypeScript project boots successfully.
- 320×320 frameless window.
- draggable glass-style UI shell.
- heatmap placeholder or static data.

### Milestone 2 — Heatmap + local data

- SQLite connected.
- daily EXP aggregation.
- Month / Year heatmap views.

### Milestone 3 — Experience system

- EXP ledger.
- level calculation.
- daily login reward.
- online EXP with cap.

### Milestone 4 — To-do

- Daily To-do.
- Persistent To-do.
- completion reward flow.

### Milestone 5 — Habit

- repeatable check-ins.
- streak/count display.
- EXP reward caps.

### Milestone 6 — Timer

- category selection.
- difficulty selection.
- timer lifecycle.
- EXP calculation.

### Milestone 7 — Sleep

- sleep record entry.
- weekly sleep chart.

### Milestone 8 — Desktop polish

- tray integration.
- optional always-on-top.
- window position persistence.
- launch-on-startup.
- Windows installer.

## 18. Acceptance principle

A feature is not considered complete merely because its UI is visible.

It must:

- persist its data;
- behave correctly after restart;
- update the relevant domain state;
- integrate with EXP where required;
- avoid fake or hard-coded production behavior;
- include enough validation or tests to make regressions visible.
