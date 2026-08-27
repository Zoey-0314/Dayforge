import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear } from 'date-fns';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getDailyExperienceTotals, getDatabase } from '../db/database';
import { type Difficulty } from '../domain/difficulty';
import { grantDailyLoginIfEligible } from '../features/experience/dailyLoginService';
import { getLevelProgress, getTotalExperience } from '../features/experience/experienceService';
import {
  grantOnlineExperienceForVerifiedSeconds,
  ONLINE_RULES,
} from '../features/experience/onlineExperienceService';
import { Heatmap, type HeatmapDatum, type HeatmapMode } from '../features/heatmap/Heatmap';
import { checkInHabit, createHabit, listHabits, type HabitItem } from '../features/habits/habitService';
import {
  cancelTimer,
  checkpointTimer,
  completeTimer,
  pauseTimer,
  recoverTimerAfterLaunch,
  resumeTimer,
  startTimer,
  type TimerCategory,
  type TimerSession,
} from '../features/timer/timerService';
import { completeTodo, createTodo, listTodos, type TaskType, type TodoItem } from '../features/todo/todoService';

const COMPACT_SIZE = { width: 320, height: 320 };
const EXPANDED_SIZE = { width: 920, height: 680 };

export function App() {
  const [mode, setMode] = useState<HeatmapMode>('month');
  const [expanded, setExpanded] = useState(false);
  const [totalExperience, setTotalExperience] = useState(0);
  const [heatmapData, setHeatmapData] = useState<HeatmapDatum[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [habits, setHabits] = useState<HabitItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [todoTitle, setTodoTitle] = useState('');
  const [todoType, setTodoType] = useState<TaskType>('daily');
  const [todoDifficulty, setTodoDifficulty] = useState<Difficulty>('easy');
  const [habitTitle, setHabitTitle] = useState('');
  const [habitDifficulty, setHabitDifficulty] = useState<Difficulty>('easy');

  const [timerCategory, setTimerCategory] = useState<TimerCategory>('Studying');
  const [timerDifficulty, setTimerDifficulty] = useState<Difficulty>('easy');
  const [timerSession, setTimerSession] = useState<TimerSession | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const onlineVerifiedSeconds = useRef(0);

  const level = useMemo(() => getLevelProgress(totalExperience), [totalExperience]);

  const refresh = useCallback(async () => {
    const now = new Date();
    const from = mode === 'month' ? startOfMonth(now) : startOfYear(now);
    const to = mode === 'month' ? endOfMonth(now) : endOfYear(now);
    const [total, daily, nextTodos, nextHabits] = await Promise.all([
      getTotalExperience(),
      getDailyExperienceTotals(format(from, 'yyyy-MM-dd'), format(to, 'yyyy-MM-dd')),
      listTodos(now),
      listHabits(now),
    ]);

    setTotalExperience(total);
    setHeatmapData(daily.map((row) => ({ dateKey: row.date_key, total: Number(row.total) })));
    setTodos(nextTodos);
    setHabits(nextHabits);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        await getDatabase();
        const [loginReward, recoveredTimer] = await Promise.all([
          grantDailyLoginIfEligible(),
          recoverTimerAfterLaunch(),
        ]);
        if (!cancelled) {
          if (recoveredTimer) {
            setTimerSession(recoveredTimer);
            setTimerElapsed(recoveredTimer.elapsedSeconds);
          }
          await refresh();
          setReady(true);
          setError(null);
          if (loginReward > 0) setToast(`Daily login +${loginReward} EXP`);
        }
      } catch (cause) {
        if (!cancelled) {
          setReady(true);
          setError(cause instanceof Error ? cause.message : 'Unable to open the local Dayforge database.');
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!timerSession || timerSession.status !== 'running') return;

    const id = window.setInterval(() => {
      setTimerElapsed((current) => {
        const next = current + 1;
        if (next % 5 === 0) void checkpointTimer(timerSession.id, next);
        return next;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [timerSession]);

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      onlineVerifiedSeconds.current += 60;

      if (onlineVerifiedSeconds.current >= ONLINE_RULES.unitSeconds) {
        const verified = onlineVerifiedSeconds.current;
        onlineVerifiedSeconds.current = 0;
        void grantOnlineExperienceForVerifiedSeconds(verified).then(async (result) => {
          if (result.awarded > 0) {
            setToast(`Online +${result.awarded} EXP`);
            await refresh();
          }
        });
      }
    }, 60_000);

    return () => window.clearInterval(heartbeat);
  }, [refresh]);

  async function toggleExpanded() {
    const next = !expanded;
    const size = next ? EXPANDED_SIZE : COMPACT_SIZE;
    await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
    setExpanded(next);
  }

  async function submitTodo(event: FormEvent) {
    event.preventDefault();
    try {
      await createTodo({ title: todoTitle, taskType: todoType, difficulty: todoDifficulty });
      setTodoTitle('');
      await refresh();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not save task.');
    }
  }

  async function finishTodo(id: string) {
    try {
      const reward = await completeTodo(id);
      if (reward > 0) setToast(`Task complete +${reward} EXP`);
      await refresh();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not complete task.');
    }
  }

  async function submitHabit(event: FormEvent) {
    event.preventDefault();
    try {
      await createHabit({ title: habitTitle, difficulty: habitDifficulty, rewardCapPerDay: 8 });
      setHabitTitle('');
      await refresh();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not save habit.');
    }
  }

  async function checkHabit(id: string) {
    try {
      const result = await checkInHabit(id);
      setToast(result.rewarded ? `Check-in +${result.experience} EXP` : 'Check-in saved · daily EXP cap reached');
      await refresh();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not save check-in.');
    }
  }

  async function handleTimerStart() {
    try {
      const session = await startTimer(timerCategory, timerDifficulty);
      setTimerSession(session);
      setTimerElapsed(0);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not start timer.');
    }
  }

  async function handleTimerPauseResume() {
    if (!timerSession) return;
    try {
      if (timerSession.status === 'running') {
        await pauseTimer(timerSession.id, timerElapsed);
        setTimerSession({ ...timerSession, status: 'paused', elapsedSeconds: timerElapsed });
      } else if (timerSession.status === 'paused') {
        await resumeTimer(timerSession.id);
        setTimerSession({ ...timerSession, status: 'running', elapsedSeconds: timerElapsed });
      }
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not update timer.');
    }
  }

  async function handleTimerComplete() {
    if (!timerSession) return;
    try {
      const reward = await completeTimer(timerSession, timerElapsed);
      setTimerSession(null);
      setTimerElapsed(0);
      setToast(reward > 0 ? `Focus complete +${reward} EXP` : 'Session saved · 5 minutes required for EXP');
      await refresh();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not complete timer.');
    }
  }

  async function handleTimerCancel() {
    if (!timerSession) return;
    try {
      await cancelTimer(timerSession.id, timerElapsed);
      setTimerSession(null);
      setTimerElapsed(0);
      setToast('Timer cancelled · session history saved');
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Could not cancel timer.');
    }
  }

  const dailyTodos = todos.filter((task) => task.taskType === 'daily');
  const persistentTodos = todos.filter((task) => task.taskType === 'persistent');

  return (
    <main className={`widget-shell ${expanded ? 'widget-shell--expanded' : ''}`}>
      <section className={`glass-card widget-card ${expanded ? 'widget-card--expanded' : ''}`}>
        <header className="level-strip" data-tauri-drag-region>
          <div className="level-strip__row">
            <span className="level-strip__level">Lv.{level.level}</span>
            <span className="level-strip__exp">
              {level.currentLevelExperience} / {level.requiredForNextLevel} EXP
            </span>
          </div>
          <div className="level-strip__track" aria-label="Level progress">
            <div className="level-strip__fill" style={{ width: `${Math.min(level.progress * 100, 100)}%` }} />
          </div>
        </header>

        <div className={expanded ? 'expanded-grid' : 'compact-layout'}>
          <section className="activity-panel">
            <div className="heatmap-header">
              <div>
                <p className="eyebrow">DAYFORGE</p>
                <h1>Activity</h1>
              </div>
              <div className="segmented" aria-label="Heatmap range">
                <button className={mode === 'month' ? 'is-active' : ''} onClick={() => setMode('month')}>Month</button>
                <button className={mode === 'year' ? 'is-active' : ''} onClick={() => setMode('year')}>Year</button>
              </div>
            </div>

            <div className="heatmap-wrap">
              {!ready ? <div className="status-message">Opening your local history…</div> : null}
              {error ? <div className="status-message status-message--error">{error}</div> : null}
              {ready && !error ? <Heatmap mode={mode} data={heatmapData} /> : null}
            </div>

            <footer className="widget-footer">
              <span>{expanded ? 'Heatmap rebuilt from saved EXP history.' : 'Every saved EXP event leaves a mark.'}</span>
              <button className="expand-button" type="button" aria-label={expanded ? 'Collapse Dayforge' : 'Expand Dayforge'} onClick={() => void toggleExpanded()}>
                {expanded ? '−' : '+'}
              </button>
            </footer>
          </section>

          {expanded ? (
            <>
              <section className="feature-panel todo-panel">
                <div className="panel-heading">
                  <div><p className="eyebrow">TASKS</p><h2>To-do</h2></div>
                  <span className="panel-note">Saved locally</span>
                </div>

                <form className="quick-form" onSubmit={submitTodo}>
                  <input value={todoTitle} onChange={(e) => setTodoTitle(e.target.value)} placeholder="Add a task…" />
                  <select value={todoType} onChange={(e) => setTodoType(e.target.value as TaskType)}>
                    <option value="daily">Daily</option><option value="persistent">Persistent</option>
                  </select>
                  <select value={todoDifficulty} onChange={(e) => setTodoDifficulty(e.target.value as Difficulty)}>
                    <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                  </select>
                  <button type="submit">Add</button>
                </form>

                <TaskSection title="Daily · refreshes each date" tasks={dailyTodos} onComplete={finishTodo} />
                <TaskSection title="Persistent · stays until done" tasks={persistentTodos} onComplete={finishTodo} />
              </section>

              <section className="feature-panel habit-panel">
                <div className="panel-heading">
                  <div><p className="eyebrow">REPEATABLE</p><h2>Habit Check-in</h2></div>
                  <span className="panel-note">Tap again anytime</span>
                </div>

                <form className="quick-form quick-form--habit" onSubmit={submitHabit}>
                  <input value={habitTitle} onChange={(e) => setHabitTitle(e.target.value)} placeholder="Add a habit…" />
                  <select value={habitDifficulty} onChange={(e) => setHabitDifficulty(e.target.value as Difficulty)}>
                    <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                  </select>
                  <button type="submit">Add</button>
                </form>

                <div className="habit-list">
                  {habits.length === 0 ? <EmptyState text="No habits yet." /> : habits.map((habit) => (
                    <button className="habit-row" key={habit.id} onClick={() => void checkHabit(habit.id)}>
                      <span className="habit-row__main"><strong>{habit.title}</strong><small>{habit.difficulty} · max {habit.rewardCapPerDay ?? '∞'} rewarded/day</small></span>
                      <span className="habit-row__count"><strong>{habit.todayCount}</strong><small>today</small></span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="feature-panel timer-panel">
                <div className="panel-heading">
                  <div><p className="eyebrow">FOCUS</p><h2>Timer</h2></div>
                  <span className="panel-note">Online +1 EXP / 5 min · cap {ONLINE_RULES.dailyCap}/day</span>
                </div>

                <div className="timer-controls">
                  <select value={timerCategory} disabled={Boolean(timerSession)} onChange={(e) => setTimerCategory(e.target.value as TimerCategory)}>
                    <option>Studying</option><option>Working</option><option>Exercise</option><option>Custom</option>
                  </select>
                  <select value={timerDifficulty} disabled={Boolean(timerSession)} onChange={(e) => setTimerDifficulty(e.target.value as Difficulty)}>
                    <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                  </select>
                </div>

                <div className="timer-clock">{formatElapsed(timerElapsed)}</div>
                <p className="timer-status">
                  {timerSession ? `${timerSession.category} · ${timerSession.status}` : 'Choose a mode and difficulty, then start.'}
                </p>

                <div className="timer-actions">
                  {!timerSession ? <button onClick={() => void handleTimerStart()}>Start</button> : null}
                  {timerSession ? <button onClick={() => void handleTimerPauseResume()}>{timerSession.status === 'running' ? 'Pause' : 'Resume'}</button> : null}
                  {timerSession ? <button onClick={() => void handleTimerComplete()}>Complete</button> : null}
                  {timerSession ? <button className="secondary" onClick={() => void handleTimerCancel()}>Cancel</button> : null}
                </div>

                <div className="timer-rule">EXP is granted per complete 5-minute block. Medium ×1.5, Hard ×2. A running timer is restored as paused after relaunch so closed/sleep time is never falsely rewarded.</div>
              </section>
            </>
          ) : null}
        </div>
      </section>
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

function TaskSection({ title, tasks, onComplete }: { title: string; tasks: TodoItem[]; onComplete: (id: string) => Promise<void> }) {
  return (
    <div className="task-section">
      <h3>{title}</h3>
      <div className="task-list">
        {tasks.length === 0 ? <EmptyState text="Nothing here yet." /> : tasks.map((task) => (
          <button className={`task-row ${task.completed ? 'is-complete' : ''}`} key={task.id} disabled={task.completed} onClick={() => void onComplete(task.id)}>
            <span className="task-checkbox">{task.completed ? '✓' : ''}</span>
            <span className="task-row__title">{task.title}</span>
            <span className={`difficulty difficulty--${task.difficulty}`}>{task.difficulty}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
