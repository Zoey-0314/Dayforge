import Database from '@tauri-apps/plugin-sql';

const DATABASE_URL = 'sqlite:dayforge.db';
const SQLITE_BUSY_PATTERN = /(database is locked|database is busy|SQLITE_BUSY|\(code:\s*5\)|code:\s*5)/i;
const STARTUP_RETRY_DELAYS_MS = [80, 120, 180, 260, 360, 480, 650, 850, 1100, 1400];

let databasePromise: Promise<Database> | null = null;
let databaseOperationQueue: Promise<void> = Promise.resolve();
let writeQueue: Promise<void> = Promise.resolve();

export type DailyExperienceRow = {
  date_key: string;
  total: number;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isSqliteBusy(error: unknown): boolean {
  return SQLITE_BUSY_PATTERN.test(error instanceof Error ? error.message : String(error));
}

async function retryBusy<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= STARTUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteBusy(error) || attempt === STARTUP_RETRY_DELAYS_MS.length) throw error;
      await delay(STARTUP_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

function enqueueDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = databaseOperationQueue.then(operation, operation);
  databaseOperationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function serializeDatabase(database: Database): Database {
  const rawExecute = database.execute.bind(database);
  const rawSelect = database.select.bind(database);

  database.execute = ((...args: Parameters<Database['execute']>) =>
    enqueueDatabaseOperation(() => rawExecute(...args))) as Database['execute'];

  database.select = ((...args: Parameters<Database['select']>) =>
    enqueueDatabaseOperation(() => rawSelect(...args))) as Database['select'];

  return database;
}

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
  // The Rust-side SQL plugin owns schema migrations. We open one logical
  // database instance in the renderer and serialize every SQL command through
  // it. This avoids WebView-side read/write races and SQLite BUSY errors.
  const database = await retryBusy(() => Database.load(DATABASE_URL));

  try {
    await retryBusy(() => database.execute('PRAGMA busy_timeout = 10000'));
    await retryBusy(() => database.execute('PRAGMA foreign_keys = ON'));

    // WAL is persistent for the database file and lets normal reads coexist
    // with short writes. If an older Dayforge process is still shutting down,
    // retry briefly instead of immediately surfacing "database is locked".
    await retryBusy(() => database.select('PRAGMA journal_mode = WAL'));
    await retryBusy(() => database.execute('PRAGMA synchronous = NORMAL'));
    await retryBusy(() => database.execute('PRAGMA wal_autocheckpoint = 1000'));
    await retryBusy(() => database.select('SELECT 1'));
  } catch (error) {
    if (isSqliteBusy(error)) {
      throw new Error('Dayforge could not acquire its local database. Close any older Dayforge process and reopen the app.');
    }
    throw error;
  }

  return serializeDatabase(database);
}

/**
 * Serialize higher-level Dayforge writes as well as individual SQL commands.
 * This keeps multi-step feature operations ordered while the database proxy
 * above guarantees that no two SQL calls execute concurrently in the renderer.
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
