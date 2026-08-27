import { format } from 'date-fns';
import { getDatabase, runDatabaseWrite } from '../../db/database';
import type { Difficulty } from '../../domain/difficulty';
import { grantExperience } from '../experience/experienceService';

export type TimerCategory = 'Studying' | 'Working' | 'Exercise' | 'Custom';
export type TimerStatus = 'running' | 'paused' | 'completed' | 'cancelled';

export type TimerSession = {
  id: string;
  title: string;
  category: TimerCategory;
  difficulty: Difficulty;
  startedAt: string;
  endedAt: string | null;
  elapsedSeconds: number;
  status: TimerStatus;
  expAwarded: number;
};

type TimerRow = {
  id: string;
  title: string;
  category: TimerCategory;
  difficulty: Difficulty;
  started_at: string;
  ended_at: string | null;
  elapsed_seconds: number;
  status: TimerStatus;
  exp_awarded: number;
};

const MULTIPLIER: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.5,
  hard: 2,
};

function normalizeTitle(value: string | undefined, category: TimerCategory): string {
  const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
  return (trimmed || `${category} session`).slice(0, 80);
}

function mapRow(row: TimerRow): TimerSession {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    difficulty: row.difficulty,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    elapsedSeconds: Number(row.elapsed_seconds),
    status: row.status,
    expAwarded: Number(row.exp_awarded),
  };
}

export function calculateTimerExperience(elapsedSeconds: number, difficulty: Difficulty): number {
  const completeFiveMinuteBlocks = Math.floor(elapsedSeconds / 300);
  return Math.floor(completeFiveMinuteBlocks * MULTIPLIER[difficulty]);
}

export async function getActiveTimer(): Promise<TimerSession | null> {
  const db = await getDatabase();
  const rows = await db.select<TimerRow[]>(
    `SELECT id, title, category, difficulty, started_at, ended_at, elapsed_seconds, status, exp_awarded
     FROM timer_sessions
     WHERE status IN ('running', 'paused')
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function recoverTimerAfterLaunch(): Promise<TimerSession | null> {
  const session = await getActiveTimer();
  if (!session) return null;

  if (session.status === 'running') {
    await runDatabaseWrite(async (db) => {
      await db.execute(
        `UPDATE timer_sessions SET status = 'paused' WHERE id = $1`,
        [session.id],
      );
    });
    return { ...session, status: 'paused' };
  }

  return session;
}

export async function startTimer(
  category: TimerCategory,
  difficulty: Difficulty,
  title?: string,
): Promise<TimerSession> {
  const existing = await getActiveTimer();
  if (existing) throw new Error('Finish or cancel the current timer first.');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const normalizedTitle = normalizeTitle(title, category);

  await runDatabaseWrite(async (db) => {
    await db.execute(
      `INSERT INTO timer_sessions
        (id, title, category, difficulty, started_at, ended_at, elapsed_seconds, status, exp_awarded)
       VALUES ($1, $2, $3, $4, $5, NULL, 0, 'running', 0)`,
      [id, normalizedTitle, category, difficulty, now],
    );
  });

  return {
    id,
    title: normalizedTitle,
    category,
    difficulty,
    startedAt: now,
    endedAt: null,
    elapsedSeconds: 0,
    status: 'running',
    expAwarded: 0,
  };
}

export async function renameTimerSession(id: string, title: string): Promise<string> {
  const trimmed = title.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!trimmed) throw new Error('Timer name cannot be empty.');

  await runDatabaseWrite(async (db) => {
    const result = await db.execute(
      `UPDATE timer_sessions SET title = $2 WHERE id = $1`,
      [id, trimmed],
    );
    if (result.rowsAffected === 0) throw new Error('Timer session not found.');
  });

  return trimmed;
}

export async function checkpointTimer(id: string, elapsedSeconds: number): Promise<void> {
  await runDatabaseWrite(async (db) => {
    await db.execute(
      `UPDATE timer_sessions SET elapsed_seconds = $2 WHERE id = $1 AND status IN ('running', 'paused')`,
      [id, Math.max(0, Math.floor(elapsedSeconds))],
    );
  });
}

export async function pauseTimer(id: string, elapsedSeconds: number): Promise<void> {
  await runDatabaseWrite(async (db) => {
    await db.execute(
      `UPDATE timer_sessions SET status = 'paused', elapsed_seconds = $2 WHERE id = $1 AND status = 'running'`,
      [id, Math.max(0, Math.floor(elapsedSeconds))],
    );
  });
}

export async function resumeTimer(id: string): Promise<void> {
  await runDatabaseWrite(async (db) => {
    await db.execute(
      `UPDATE timer_sessions SET status = 'running', started_at = $2 WHERE id = $1 AND status = 'paused'`,
      [id, new Date().toISOString()],
    );
  });
}

export async function cancelTimer(id: string, elapsedSeconds: number): Promise<void> {
  await runDatabaseWrite(async (db) => {
    await db.execute(
      `UPDATE timer_sessions
       SET status = 'cancelled', elapsed_seconds = $2, ended_at = $3
       WHERE id = $1 AND status IN ('running', 'paused')`,
      [id, Math.max(0, Math.floor(elapsedSeconds)), new Date().toISOString()],
    );
  });
}

export async function completeTimer(session: TimerSession, elapsedSeconds: number): Promise<number> {
  const finalElapsed = Math.max(0, Math.floor(elapsedSeconds));
  const reward = calculateTimerExperience(finalElapsed, session.difficulty);
  const endedAt = new Date();

  await runDatabaseWrite(async (db) => {
    await db.execute(
      `UPDATE timer_sessions
       SET status = 'completed', elapsed_seconds = $2, ended_at = $3, exp_awarded = $4
       WHERE id = $1 AND status IN ('running', 'paused')`,
      [session.id, finalElapsed, endedAt.toISOString(), reward],
    );
  });

  if (reward > 0) {
    await grantExperience({
      source: 'TIMER',
      sourceId: session.id,
      description: `Focus session: ${session.title}`,
      amount: reward,
      occurredAt: endedAt,
    });
  }

  return reward;
}

export async function listRecentTimerSessions(limit = 20): Promise<TimerSession[]> {
  const db = await getDatabase();
  const rows = await db.select<TimerRow[]>(
    `SELECT id, title, category, difficulty, started_at, ended_at, elapsed_seconds, status, exp_awarded
     FROM timer_sessions
     WHERE status IN ('completed', 'cancelled')
     ORDER BY COALESCE(ended_at, started_at) DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(mapRow);
}

export function timerDateKey(date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}
