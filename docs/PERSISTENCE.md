# Dayforge Persistence Contract

Dayforge is local-first. User data must survive application restarts, Windows restarts, upgrades and ordinary UI navigation.

## Source of truth

SQLite is the source of truth for product data. React state, Zustand stores and component state are caches or runtime presentation state only.

The database is loaded as `sqlite:dayforge.db` through the Tauri SQL plugin. It is stored in the application's persistent data location managed by the desktop runtime rather than inside temporary frontend memory.

## Data that must persist

The following information must never depend only on in-memory state:

- task definitions;
- daily task completion history;
- persistent task completion state;
- habit definitions;
- every habit check-in;
- timer sessions that qualify as saved history;
- sleep records;
- every EXP transaction;
- level progress through the EXP ledger;
- daily heatmap activity through the EXP ledger;
- user settings such as window preferences and last daily-login reward date.

## Restart behavior

When Dayforge launches:

1. open the persistent SQLite database;
2. run idempotent schema migrations;
3. read durable records from SQLite;
4. rebuild derived UI state from those records;
5. only then show data as ready.

The application must not initialize an empty in-memory store and overwrite existing durable history.

## Daily tasks

Daily tasks do not get deleted or recreated at midnight.

A daily task definition remains in `tasks`. Completion is represented by a dated row in `task_completions`. On a new local date, the task appears incomplete because no completion row exists for the new `date_key`; older completion rows remain as history.

This means reopening Dayforge tomorrow does not erase yesterday's activity.

## Persistent tasks

Persistent tasks remain until the user completes, archives or deletes them. Their definition and completion state are stored in SQLite and must be restored on every launch.

## Habits

Habit check-ins are append-only history records. A UI counter is derived from `habit_checkins`; it must not be the only stored value.

## EXP and level

`experience_logs` is the authoritative EXP ledger. Total EXP, current level and the contribution heatmap are derived from this ledger. A UI field such as `totalExp` is never the authoritative copy.

This prevents EXP from disappearing after restart and allows the heatmap to be rebuilt from history at any time.

## Sleep

Each saved sleep record is stored in `sleep_records`. Closing the application after saving a record must not lose it.

## Timer sessions

Completed sessions are persisted. Runtime timer state may be kept in memory while actively counting, but any state that is expected to survive a restart must be explicitly checkpointed before that behavior is advertised.

The first release must not claim crash-safe active timer restoration until it is implemented and tested.

## Write safety

For actions that modify product data:

- write to SQLite before showing a permanent success state;
- use transactions when one user action creates multiple related records, such as a task completion plus EXP award;
- reject duplicate reward writes where product rules require only one reward;
- never clear tables as part of normal startup;
- never use development seed data in production startup logic.

## Migrations

Schema changes must be forward migrations. Existing user rows must not be dropped merely because a new app version is installed.

Migrations should be idempotent where possible and versioned through `app_meta.schema_version` as the schema becomes more complex.

## Backup/export direction

A later milestone should add explicit backup/export and restore. This is separate from normal persistence: normal persistence is mandatory from the first usable build, while backup is an additional safety feature.
