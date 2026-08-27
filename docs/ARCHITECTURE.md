# Dayforge Architecture

## 1. Architecture goals

Dayforge should remain small, local-first and easy to evolve. The codebase should separate UI rendering from product rules so EXP, task reset behavior and history cannot accidentally diverge between screens.

Primary goals:

- local-first desktop application;
- durable SQLite persistence;
- predictable domain services;
- thin React components;
- no feature should directly mutate EXP totals;
- feature history should be event/log based where practical;
- implementation should remain friendly to iterative development with Codex.

## 2. High-level stack

```text
Windows 11
  ↓
Tauri 2 desktop shell
  ↓
React + TypeScript UI
  ↓
Application/domain services
  ↓
Repository/data-access layer
  ↓
SQLite
```

Recommended supporting libraries:

- Tailwind CSS for styling;
- Zustand for UI/application state where needed;
- date-fns for local date handling;
- Recharts or custom SVG for the sleep graph;
- Tauri plugins for SQLite, autostart and window features when appropriate.

## 3. Proposed repository layout

```text
Dayforge/
├─ src/
│  ├─ app/
│  │  ├─ App.tsx
│  │  ├─ router.ts
│  │  └─ providers/
│  ├─ components/
│  │  ├─ glass/
│  │  ├─ controls/
│  │  └─ common/
│  ├─ features/
│  │  ├─ heatmap/
│  │  ├─ experience/
│  │  ├─ todo/
│  │  ├─ habits/
│  │  ├─ timer/
│  │  ├─ sleep/
│  │  └─ settings/
│  ├─ services/
│  ├─ repositories/
│  ├─ db/
│  │  ├─ migrations/
│  │  └─ schema.ts
│  ├─ store/
│  ├─ types/
│  ├─ utils/
│  └─ styles/
├─ src-tauri/
│  ├─ src/
│  ├─ capabilities/
│  ├─ icons/
│  └─ tauri.conf.json
├─ docs/
│  ├─ PRD.md
│  └─ ARCHITECTURE.md
├─ AGENTS.md
└─ README.md
```

Feature folders may contain their own components, hooks, tests and domain types where cohesion is improved.

## 4. Domain boundaries

### 4.1 Experience

The experience domain is shared by multiple features and must remain centralized.

Responsibilities:

- grant EXP;
- reverse EXP through compensating entries if required;
- calculate total EXP;
- calculate current level/progress;
- aggregate daily EXP;
- expose heatmap data.

Suggested interface:

```ts
export type ExperienceSource =
  | 'TODO'
  | 'HABIT'
  | 'TIMER'
  | 'DAILY_LOGIN'
  | 'ONLINE';

export interface GrantExperienceInput {
  source: ExperienceSource;
  sourceId?: string;
  description: string;
  amount: number;
  occurredAt?: Date;
}

export interface ExperienceService {
  grant(input: GrantExperienceInput): Promise<void>;
  getTotal(): Promise<number>;
  getDailyTotals(range: { from: Date; to: Date }): Promise<DailyExperience[]>;
}
```

The UI must never execute statements such as `totalExp += 25`.

### 4.2 To-do

Responsibilities:

- task creation/editing/deletion;
- daily/persistent classification;
- completion state;
- daily completion history;
- completion EXP transaction.

Completing a task should be orchestrated as one application operation:

1. validate task state;
2. persist completion;
3. grant EXP;
4. return updated state.

### 4.3 Habits

Responsibilities:

- habit definitions;
- repeated check-ins;
- daily reward eligibility;
- streak/count calculations;
- EXP grant per eligible check-in.

Individual check-ins are persisted. Counters shown in UI are derived values.

### 4.4 Timer

Responsibilities:

- start/pause/resume/cancel/complete lifecycle;
- elapsed duration;
- category and difficulty;
- persisted completed sessions;
- EXP calculation on qualifying completion.

Timing must use timestamps rather than trusting repeated UI interval ticks. This prevents drift and handles temporary UI stalls.

### 4.5 Sleep

Responsibilities:

- create/edit sleep records;
- normalize overnight ranges;
- provide weekly chart input;
- no EXP integration in the initial release.

## 5. Suggested SQLite schema

Exact SQL may evolve, but the logical schema should remain close to the following.

### tasks

```text
id                  TEXT PRIMARY KEY
title               TEXT NOT NULL
task_type            TEXT NOT NULL  -- daily | persistent
difficulty          TEXT NOT NULL  -- easy | medium | hard
is_active           INTEGER NOT NULL DEFAULT 1
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
completed_at        TEXT NULL       -- persistent task convenience field
```

### task_completions

```text
id                  TEXT PRIMARY KEY
task_id             TEXT NOT NULL
date_key            TEXT NOT NULL  -- local YYYY-MM-DD
completed_at        TEXT NOT NULL
```

A daily task's current state is determined by whether a completion exists for today's local `date_key`.

### habits

```text
id                  TEXT PRIMARY KEY
title               TEXT NOT NULL
difficulty          TEXT NOT NULL
reward_cap_per_day  INTEGER NULL
is_active           INTEGER NOT NULL DEFAULT 1
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
```

### habit_checkins

```text
id                  TEXT PRIMARY KEY
habit_id            TEXT NOT NULL
checked_in_at       TEXT NOT NULL
date_key            TEXT NOT NULL
exp_eligible        INTEGER NOT NULL
```

### timer_sessions

```text
id                  TEXT PRIMARY KEY
category            TEXT NOT NULL
difficulty          TEXT NOT NULL
started_at          TEXT NOT NULL
ended_at            TEXT NULL
elapsed_seconds     INTEGER NOT NULL DEFAULT 0
status              TEXT NOT NULL
exp_awarded         INTEGER NOT NULL DEFAULT 0
```

### sleep_records

```text
id                  TEXT PRIMARY KEY
date_key            TEXT NOT NULL UNIQUE
bedtime             TEXT NOT NULL
wake_time           TEXT NOT NULL
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
```

### experience_logs

```text
id                  TEXT PRIMARY KEY
source_type         TEXT NOT NULL
source_id           TEXT NULL
description         TEXT NOT NULL
amount              INTEGER NOT NULL
occurred_at         TEXT NOT NULL
date_key            TEXT NOT NULL
```

### app_settings

A key/value table or typed settings row may be used. It should support at minimum:

- last daily login reward date;
- always-on-top;
- launch-on-startup;
- compact window position;
- online EXP enabled/disabled.

## 6. Date and time rules

Local date boundaries matter to Dayforge.

Rules:

- daily task reset uses the user's local calendar date;
- daily login reward uses local date;
- habit caps use local date;
- online EXP caps use local date;
- heatmap groups experience by local date;
- persisted timestamps should use ISO 8601;
- persisted `date_key` should use local `YYYY-MM-DD` calculated at the event time.

Do not infer a daily reset by deleting task data at midnight. Daily state should be computed from dated records.

## 7. State management

Use Zustand only for state that benefits from shared reactive UI access.

Recommended approach:

- database remains source of truth;
- repositories read/write durable data;
- application services coordinate domain operations;
- feature stores cache/query current UI state;
- components call service/hook actions rather than raw SQL.

Avoid one giant global store.

Suggested stores:

- window/ui store;
- experience summary store;
- timer runtime store.

Feature lists can use local hooks or small feature stores.

## 8. Heatmap derivation

The heatmap should not maintain a separate mutable activity counter if it can be derived from `experience_logs`.

Flow:

```text
experience_logs
  ↓ group by date_key
SUM(amount)
  ↓
daily EXP totals
  ↓
intensity thresholds
  ↓
Month / Year heatmap
```

Negative compensating entries should affect the day's net value if reversals are supported.

## 9. Desktop window architecture

The first milestone should use a single Tauri main window.

Compact state:

- target content size approximately 320×320;
- frameless;
- transparent where supported;
- rounded UI root;
- custom drag region;
- optional always-on-top.

Expanded state:

- resize the same native window;
- animate React layout independently from the native resize where possible;
- avoid creating many separate native windows for the first release.

Persist window position and restore it safely so the widget does not reopen off-screen after monitor changes.

## 10. Glass UI implementation

The application should use layered translucency instead of relying on one effect.

Suggested visual stack:

- transparent/blur-capable native surface where supported;
- semi-transparent React root surface;
- subtle inner border/highlight;
- moderate backdrop blur;
- restrained shadow;
- fallback opaque/translucent background if platform blur is unavailable.

Readability takes priority over maximum transparency.

## 11. Timer reliability

Do not implement elapsed duration as only:

```ts
setInterval(() => seconds += 1, 1000)
```

Instead persist/runtime-track timestamps:

```text
startedAt
pausedAt
accumulatedPausedDuration
```

UI ticks should display a calculation based on current time.

This prevents timer drift and prevents accidental rewards after suspend/resume without validation.

## 12. Online EXP reliability

Online EXP should use short, validated active-runtime intervals.

Do not grant based only on a large elapsed time between two timestamps because the computer may have slept.

Recommended approach:

- heartbeat while app is active;
- accumulate small verified intervals;
- grant in 5-minute units;
- consult today's persisted ONLINE EXP before each grant;
- stop grants at the configured daily cap.

## 13. Testing priorities

Prioritize tests around product rules, not visual snapshots.

Important test cases:

- daily task appears incomplete on a new date without deleting history;
- persistent task remains completed after restart;
- duplicate completion cannot double-grant EXP;
- daily login grants only once per local date;
- online EXP never exceeds daily cap;
- habit reward cap works but extra check-ins are still recorded;
- timer difficulty multiplier calculates consistently;
- heatmap totals match EXP ledger entries;
- level calculation handles thresholds correctly;
- sleep intervals crossing midnight render correctly.

## 14. Error handling

Failures to write durable state should not be hidden behind optimistic UI success.

For actions that grant EXP:

- persist the feature event and corresponding EXP operation as atomically as practical;
- surface a recoverable error if persistence fails;
- never show a permanent reward animation for a transaction that did not save.

SQLite transactions should be used for multi-write operations where supported.

## 15. Evolution rules

Future features should integrate through existing domain boundaries.

Examples:

- an achievement system should read from history rather than altering task logic;
- a statistics page should query ledger/check-in/session history;
- cloud sync, if ever added, should synchronize durable domain records rather than UI stores;
- new EXP sources should extend the centralized experience source model rather than invent a separate counter.
