import Database from '@tauri-apps/plugin-sql';

let databasePromise: Promise<Database> | null = null;

export type DailyExperienceRow = {
  date_key: string;
  total: number;
};

export function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

async function openDatabase(): Promise<Database> {
  const db = await Database.load('sqlite:dayforge.db');
  await db.execute('PRAGMA foreign_keys = ON');
  await db.execute('PRAGMA journal_mode = WAL');
  await migrate(db);
  return db;
}

async function migrate(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      task_type TEXT NOT NULL CHECK(task_type IN ('daily', 'persistent')),
      difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_completions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      UNIQUE(task_id, date_key),
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard')),
      reward_cap_per_day INTEGER NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS habit_checkins (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL,
      checked_in_at TEXT NOT NULL,
      date_key TEXT NOT NULL,
      exp_eligible INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(habit_id) REFERENCES habits(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS timer_sessions (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard')),
      started_at TEXT NOT NULL,
      ended_at TEXT NULL,
      elapsed_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      exp_awarded INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sleep_records (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL UNIQUE,
      bedtime TEXT NOT NULL,
      wake_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS experience_logs (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NULL,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      date_key TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_experience_logs_date_key
    ON experience_logs(date_key)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const now = new Date().toISOString();
  await db.execute(
    `INSERT OR IGNORE INTO app_meta (key, value, updated_at) VALUES ('schema_version', '1', $1)`,
    [now],
  );
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM app_settings WHERE key = $1 LIMIT 1',
    [key],
  );

  if (!rows.length) return fallback;

  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return fallback;
  }
}

export async function getDailyExperienceTotals(fromDateKey: string, toDateKey: string): Promise<DailyExperienceRow[]> {
  const db = await getDatabase();
  return db.select<DailyExperienceRow[]>(
    `SELECT date_key, COALESCE(SUM(amount), 0) AS total
     FROM experience_logs
     WHERE date_key BETWEEN $1 AND $2
     GROUP BY date_key
     ORDER BY date_key ASC`,
    [fromDateKey, toDateKey],
  );
}
