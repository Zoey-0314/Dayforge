import { format } from 'date-fns';
import { getDatabase, runDatabaseWrite } from '../../db/database';
import { getDifficultyExperience, type Difficulty } from '../../domain/difficulty';

export type TaskType = 'daily' | 'persistent';

export type TodoItem = {
  id: string;
  title: string;
  taskType: TaskType;
  difficulty: Difficulty;
  completed: boolean;
  createdAt: string;
};

function todayKey(date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

export async function listTodos(date = new Date()): Promise<TodoItem[]> {
  const db = await getDatabase();
  const dateKey = todayKey(date);
  const rows = await db.select<Array<{
    id: string;
    title: string;
    task_type: TaskType;
    difficulty: Difficulty;
    created_at: string;
    completed_at: string | null;
    daily_completed: number;
  }>>(
    `SELECT
       t.id,
       t.title,
       t.task_type,
       t.difficulty,
       t.created_at,
       t.completed_at,
       CASE WHEN tc.id IS NULL THEN 0 ELSE 1 END AS daily_completed
     FROM tasks t
     LEFT JOIN task_completions tc
       ON tc.task_id = t.id AND tc.date_key = $1
     WHERE t.is_active = 1
     ORDER BY t.created_at ASC`,
    [dateKey],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    taskType: row.task_type,
    difficulty: row.difficulty,
    completed: row.task_type === 'daily' ? Boolean(row.daily_completed) : Boolean(row.completed_at),
    createdAt: row.created_at,
  }));
}

export async function createTodo(input: {
  title: string;
  taskType: TaskType;
  difficulty: Difficulty;
}): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error('Task title cannot be empty.');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await runDatabaseWrite(async (db) => {
    await db.execute(
      `INSERT INTO tasks
        (id, title, task_type, difficulty, is_active, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5, NULL)`,
      [id, title, input.taskType, input.difficulty, now],
    );
  });

  return id;
}

export async function completeTodo(taskId: string, date = new Date()): Promise<number> {
  const dateKey = todayKey(date);
  const now = date.toISOString();

  return runDatabaseWrite(async (db) => {
    const rows = await db.select<Array<{
      title: string;
      task_type: TaskType;
      difficulty: Difficulty;
      completed_at: string | null;
    }>>(
      `SELECT title, task_type, difficulty, completed_at
       FROM tasks
       WHERE id = $1 AND is_active = 1
       LIMIT 1`,
      [taskId],
    );

    const task = rows[0];
    if (!task) throw new Error('Task not found.');
    const reward = getDifficultyExperience(task.difficulty);

    if (task.task_type === 'daily') {
      const result = await db.execute(
        `INSERT OR IGNORE INTO task_completions (id, task_id, date_key, completed_at)
         VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), taskId, dateKey, now],
      );
      if (result.rowsAffected === 0) return 0;
    } else {
      const result = await db.execute(
        `UPDATE tasks
         SET completed_at = $1, updated_at = $1
         WHERE id = $2 AND completed_at IS NULL`,
        [now, taskId],
      );
      if (result.rowsAffected === 0) return 0;
    }

    await db.execute(
      `INSERT INTO experience_logs
        (id, source_type, source_id, description, amount, occurred_at, date_key)
       VALUES ($1, 'TODO', $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), taskId, `Completed task: ${task.title}`, reward, now, dateKey],
    );

    return reward;
  });
}

export async function deleteTodo(taskId: string): Promise<void> {
  const now = new Date().toISOString();
  await runDatabaseWrite(async (db) => {
    await db.execute(
      `UPDATE tasks SET is_active = 0, updated_at = $1 WHERE id = $2`,
      [now, taskId],
    );
  });
}
