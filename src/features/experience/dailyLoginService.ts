import { format } from 'date-fns';
import { runDatabaseWrite } from '../../db/database';

const DAILY_LOGIN_EXP = 10;

export async function grantDailyLoginIfEligible(date = new Date()): Promise<number> {
  const dateKey = format(date, 'yyyy-MM-dd');
  const now = date.toISOString();

  return runDatabaseWrite(async (db) => {
    const result = await db.execute(
      `INSERT INTO experience_logs
        (id, source_type, source_id, description, amount, occurred_at, date_key)
       SELECT $1, 'DAILY_LOGIN', NULL, 'Daily login bonus', $2, $3, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM experience_logs
         WHERE source_type = 'DAILY_LOGIN' AND date_key = $4
       )`,
      [crypto.randomUUID(), DAILY_LOGIN_EXP, now, dateKey],
    );

    return result.rowsAffected > 0 ? DAILY_LOGIN_EXP : 0;
  });
}
