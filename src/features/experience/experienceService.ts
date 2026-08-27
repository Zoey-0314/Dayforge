import { format } from 'date-fns';
import { getDatabase } from '../../db/database';

export type ExperienceSource = 'TODO' | 'HABIT' | 'TIMER' | 'DAILY_LOGIN' | 'ONLINE';

export type GrantExperienceInput = {
  source: ExperienceSource;
  sourceId?: string;
  description: string;
  amount: number;
  occurredAt?: Date;
};

export async function grantExperience(input: GrantExperienceInput): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Experience amount must be a positive number.');
  }

  const db = await getDatabase();
  const occurredAt = input.occurredAt ?? new Date();

  await db.execute(
    `INSERT INTO experience_logs
      (id, source_type, source_id, description, amount, occurred_at, date_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      input.source,
      input.sourceId ?? null,
      input.description,
      Math.floor(input.amount),
      occurredAt.toISOString(),
      format(occurredAt, 'yyyy-MM-dd'),
    ],
  );
}

export async function getTotalExperience(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ total: number }>>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM experience_logs',
  );
  return Number(rows[0]?.total ?? 0);
}

export function getLevelProgress(totalExperience: number): {
  level: number;
  currentLevelExperience: number;
  requiredForNextLevel: number;
  progress: number;
} {
  let level = 1;
  let remaining = Math.max(0, totalExperience);
  let requirement = 100;

  while (remaining >= requirement) {
    remaining -= requirement;
    level += 1;
    requirement = level * 100;
  }

  return {
    level,
    currentLevelExperience: remaining,
    requiredForNextLevel: requirement,
    progress: requirement === 0 ? 0 : remaining / requirement,
  };
}
