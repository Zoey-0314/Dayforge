import Database from '@tauri-apps/plugin-sql';

let databasePromise: Promise<Database> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

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
  // The Rust-side SQL plugin owns schema migrations. Keeping schema creation in
  // one place avoids two startup connections competing for SQLite locks.
  const db = await Database.load('sqlite:dayforge.db');

  // Wait briefly for another short write to finish instead of failing with
  // SQLITE_BUSY. Do not switch journal mode from the UI process at startup.
  await db.execute('PRAGMA busy_timeout = 5000');
  await db.execute('PRAGMA foreign_keys = ON');

  return db;
}

/**
 * Serialize Dayforge writes in the renderer. The SQL plugin uses a pool, so
 * manual BEGIN/COMMIT statements issued through separate calls are unsafe:
 * the calls may land on different pooled connections and leave SQLite locked.
 */
export function runDatabaseWrite<T>(operation: (db: Database) => Promise<T>): Promise<T> {
  const run = writeQueue.then(
    async () => operation(await getDatabase()),
    async () => operation(await getDatabase()),
  );

  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await runDatabaseWrite(async (db) => {
    await db.execute(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), new Date().toISOString()],
    );
  });
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
