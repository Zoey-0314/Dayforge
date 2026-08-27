import { format } from 'date-fns';
import { getDatabase } from '../../db/database';

const DAILY_LOGIN_EXP = 10;

export async function grantDailyLoginIfEligible(date = new Date()): Promise<number> {
  const db = await getDatabase();
  const dateKey = format(date, 'yyyy-MM-dd');
  const now = date.toISOString();

  await db.execute('BEGIN IMMEDIATE');
  try {
    const rows = await db.select<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count
       FROM experience_logs
       WHERE source_type = 'DAILY_LOGIN' AND date_key = $1`,
      [dateKey],
    );

    if (Number(rows[0]?.count ?? 0) > 0) {
      await db.execute('ROLLBACK');
      return 0;
    }

    await db.execute(
      `INSERT INTO experience_logs
        (id, source_type, source_id, description, amount, occurred_at, date_key)
       VALUES ($1, 'DAILY_LOGIN', NULL, 'Daily login bonus', $2, $3, $4)`,
      [crypto.randomUUID(), DAILY_LOGIN_EXP, now, dateKey],
    );

    await db.execute('COMMIT');
    return DAILY_LOGIN_EXP;
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}
