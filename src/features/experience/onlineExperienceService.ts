import { format } from 'date-fns';
import { getDatabase } from '../../db/database';
import { grantExperience } from './experienceService';

const ONLINE_UNIT_SECONDS = 300;
const ONLINE_EXP_PER_UNIT = 1;
const ONLINE_DAILY_CAP = 30;

export async function getTodayOnlineExperience(date = new Date()): Promise<number> {
  const db = await getDatabase();
  const dateKey = format(date, 'yyyy-MM-dd');
  const rows = await db.select<Array<{ total: number }>>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM experience_logs
     WHERE source_type = 'ONLINE' AND date_key = $1`,
    [dateKey],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function grantOnlineExperienceForVerifiedSeconds(
  verifiedSeconds: number,
  date = new Date(),
): Promise<{ awarded: number; reachedCap: boolean }> {
  const completeUnits = Math.floor(Math.max(0, verifiedSeconds) / ONLINE_UNIT_SECONDS);
  if (completeUnits <= 0) return { awarded: 0, reachedCap: false };

  const alreadyAwarded = await getTodayOnlineExperience(date);
  const remaining = Math.max(0, ONLINE_DAILY_CAP - alreadyAwarded);
  if (remaining <= 0) return { awarded: 0, reachedCap: true };

  const award = Math.min(remaining, completeUnits * ONLINE_EXP_PER_UNIT);
  if (award > 0) {
    await grantExperience({
      source: 'ONLINE',
      description: 'Verified online activity',
      amount: award,
      occurredAt: date,
    });
  }

  return {
    awarded: award,
    reachedCap: alreadyAwarded + award >= ONLINE_DAILY_CAP,
  };
}

export const ONLINE_RULES = {
  unitSeconds: ONLINE_UNIT_SECONDS,
  expPerUnit: ONLINE_EXP_PER_UNIT,
  dailyCap: ONLINE_DAILY_CAP,
};
