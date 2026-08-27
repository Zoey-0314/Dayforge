import { endOfWeek, format, startOfWeek } from 'date-fns';
import { getDatabase, runDatabaseWrite } from '../../db/database';

export type SleepRecord = {
  id: string;
  dateKey: string;
  bedtime: string;
  wakeTime: string;
  createdAt: string;
  updatedAt: string;
};

type SleepRow = {
  id: string;
  date_key: string;
  bedtime: string;
  wake_time: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: SleepRow): SleepRecord {
  return {
    id: row.id,
    dateKey: row.date_key,
    bedtime: row.bedtime,
    wakeTime: row.wake_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertTime(value: string, label: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${label} must use HH:mm.`);
  }
}

function minutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function getSleepDurationMinutes(bedtime: string, wakeTime: string): number {
  assertTime(bedtime, 'Bedtime');
  assertTime(wakeTime, 'Wake time');

  const start = minutes(bedtime);
  let end = minutes(wakeTime);
  if (end <= start) end += 24 * 60;
  return end - start;
}

export async function upsertSleepRecord(input: {
  dateKey: string;
  bedtime: string;
  wakeTime: string;
}): Promise<SleepRecord> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) {
    throw new Error('Sleep date must use YYYY-MM-DD.');
  }

  const duration = getSleepDurationMinutes(input.bedtime, input.wakeTime);
  if (duration < 60 || duration > 16 * 60) {
    throw new Error('Sleep duration must be between 1 and 16 hours.');
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await runDatabaseWrite(async (db) => {
    await db.execute(
      `INSERT INTO sleep_records
        (id, date_key, bedtime, wake_time, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT(date_key) DO UPDATE SET
         bedtime = excluded.bedtime,
         wake_time = excluded.wake_time,
         updated_at = excluded.updated_at`,
      [id, input.dateKey, input.bedtime, input.wakeTime, now],
    );
  });

  const saved = await getSleepRecord(input.dateKey);
  if (!saved) throw new Error('Sleep record could not be reloaded after saving.');
  return saved;
}

export async function getSleepRecord(dateKey: string): Promise<SleepRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<SleepRow[]>(
    `SELECT id, date_key, bedtime, wake_time, created_at, updated_at
     FROM sleep_records
     WHERE date_key = $1
     LIMIT 1`,
    [dateKey],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listSleepRecords(fromDateKey: string, toDateKey: string): Promise<SleepRecord[]> {
  const db = await getDatabase();
  const rows = await db.select<SleepRow[]>(
    `SELECT id, date_key, bedtime, wake_time, created_at, updated_at
     FROM sleep_records
     WHERE date_key BETWEEN $1 AND $2
     ORDER BY date_key ASC`,
    [fromDateKey, toDateKey],
  );
  return rows.map(mapRow);
}

export async function listWeekSleepRecords(anchorDate = new Date()): Promise<SleepRecord[]> {
  const from = startOfWeek(anchorDate, { weekStartsOn: 1 });
  const to = endOfWeek(anchorDate, { weekStartsOn: 1 });
  return listSleepRecords(format(from, 'yyyy-MM-dd'), format(to, 'yyyy-MM-dd'));
}

export async function deleteSleepRecord(dateKey: string): Promise<void> {
  await runDatabaseWrite(async (db) => {
    await db.execute('DELETE FROM sleep_records WHERE date_key = $1', [dateKey]);
  });
}
