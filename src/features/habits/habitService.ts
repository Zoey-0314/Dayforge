import { format } from 'date-fns';
import { getDatabase } from '../../db/database';
import { getDifficultyExperience, type Difficulty } from '../../domain/difficulty';

export type HabitItem = {
  id: string;
  title: string;
  difficulty: Difficulty;
  rewardCapPerDay: number | null;
  todayCount: number;
  totalCount: number;
  todayRewardedCount: number;
};

function todayKey(date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

export async function listHabits(date = new Date()): Promise<HabitItem[]> {
  const db = await getDatabase();
  const dateKey = todayKey(date);
  const rows = await db.select<Array<{
    id: string;
    title: string;
    difficulty: Difficulty;
    reward_cap_per_day: number | null;
    today_count: number;
    total_count: number;
    today_rewarded_count: number;
  }>>(
    `SELECT
       h.id,
       h.title,
       h.difficulty,
       h.reward_cap_per_day,
       COALESCE(SUM(CASE WHEN hc.date_key = $1 THEN 1 ELSE 0 END), 0) AS today_count,
       COUNT(hc.id) AS total_count,
       COALESCE(SUM(CASE WHEN hc.date_key = $1 AND hc.exp_eligible = 1 THEN 1 ELSE 0 END), 0) AS today_rewarded_count
     FROM habits h
     LEFT JOIN habit_checkins hc ON hc.habit_id = h.id
     WHERE h.is_active = 1
     GROUP BY h.id, h.title, h.difficulty, h.reward_cap_per_day, h.created_at
     ORDER BY h.created_at ASC`,
    [dateKey],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    difficulty: row.difficulty,
    rewardCapPerDay: row.reward_cap_per_day === null ? null : Number(row.reward_cap_per_day),
    todayCount: Number(row.today_count),
    totalCount: Number(row.total_count),
    todayRewardedCount: Number(row.today_rewarded_count),
  }));
}

export async function createHabit(input: {
  title: string;
  difficulty: Difficulty;
  rewardCapPerDay?: number | null;
}): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error('Habit title cannot be empty.');

  const cap = input.rewardCapPerDay ?? 8;
  if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
    throw new Error('Habit reward cap must be a positive integer or null.');
  }

  const db = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO habits
      (id, title, difficulty, reward_cap_per_day, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, $5, $5)`,
    [id, title, input.difficulty, cap, now],
  );
  return id;
}

export async function checkInHabit(habitId: string, date = new Date()): Promise<{
  rewarded: boolean;
  experience: number;
}> {
  const db = await getDatabase();
  const dateKey = todayKey(date);
  const now = date.toISOString();

  await db.execute('BEGIN IMMEDIATE');
  try {
    const rows = await db.select<Array<{
      title: string;
      difficulty: Difficulty;
      reward_cap_per_day: number | null;
    }>>(
      `SELECT title, difficulty, reward_cap_per_day
       FROM habits
       WHERE id = $1 AND is_active = 1
       LIMIT 1`,
      [habitId],
    );
    const habit = rows[0];
    if (!habit) throw new Error('Habit not found.');

    const countRows = await db.select<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count
       FROM habit_checkins
       WHERE habit_id = $1 AND date_key = $2 AND exp_eligible = 1`,
      [habitId, dateKey],
    );
    const rewardedToday = Number(countRows[0]?.count ?? 0);
    const cap = habit.reward_cap_per_day === null ? null : Number(habit.reward_cap_per_day);
    const rewarded = cap === null || rewardedToday < cap;
    const reward = rewarded ? getDifficultyExperience(habit.difficulty) : 0;

    const checkInId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO habit_checkins
        (id, habit_id, checked_in_at, date_key, exp_eligible)
       VALUES ($1, $2, $3, $4, $5)`,
      [checkInId, habitId, now, dateKey, rewarded ? 1 : 0],
    );

    if (rewarded) {
      await db.execute(
        `INSERT INTO experience_logs
          (id, source_type, source_id, description, amount, occurred_at, date_key)
         VALUES ($1, 'HABIT', $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), checkInId, `Habit check-in: ${habit.title}`, reward, now, dateKey],
      );
    }

    await db.execute('COMMIT');
    return { rewarded, experience: reward };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

export async function deleteHabit(habitId: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE habits SET is_active = 0, updated_at = $1 WHERE id = $2`,
    [now, habitId],
  );
}
