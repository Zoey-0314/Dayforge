import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear } from 'date-fns';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Check, Clock3, Maximize2, Minus, Pencil, Shrink, X } from 'lucide-react';
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
import { SleepPanel } from '../features/sleep/SleepPanel';
import {
  cancelTimer,
  checkpointTimer,
  completeTimer,
  listRecentTimerSessions,
  pauseTimer,
  recoverTimerAfterLaunch,
  renameTimerSession,
  resumeTimer,
  startTimer,
  type TimerCategory,
  type TimerSession,
} from '../features/timer/timerService';
import { completeTodo, createTodo, listTodos, type TaskType, type TodoItem } from '../features/todo/todoService';

const COMPACT_SIZE = { width: 320, height: 320 };
const EXPANDED_SIZE = { width: 980, height: 680 };

type ResizeMotion = 'expand' | 'collapse' | null;

export function App() {
  const [mode, setMode] = useState<HeatmapMode>('month');
  const [expanded, setExpanded] = useState(false);
  const [resizeMotion, setResizeMotion] = useState<ResizeMotion>(null);
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
  const [timerName, setTimerName] = useState('');
  const [timerSession, setTimerSession] = useState<TimerSession | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [timerHistory, setTimerHistory] = useState<TimerSession[]>([]);
  const [timerHistoryOpen, setTimerHistoryOpen] = useState(false);
  const [editingTimerId, setEditingTimerId] = useState<string | null>(null);
  const [editingTimerTitle, setEditingTimerTitle] = useState('');
  const onlineVerifiedSeconds = useRef(0);

  const level = useMemo(() => getLevelProgress(totalExperience), [totalExperience]);

  const refreshForMode = useCallback(async (viewMode: HeatmapMode) => {
    const now = new Date();
    const from = viewMode === 'month' ? startOfMonth(now) : startOfYear(now);
    const to = viewMode === 'month' ? endOfMonth(now) : endOfYear(now);
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
  }, []);

  const refreshTimerHistory = useCallback(async () => {
    const sessions = await listRecentTimerSessions(100);
    setTimerHistory(sessions);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await getDatabase();
        const loginReward = await grantDailyLoginIfEligible();
        const recoveredTimer = await recoverTimerAfterLaunch();

        if (cancelled) return;
        if (recoveredTimer) {
          setTimerSession(recoveredTimer);
          setTimerElapsed(recoveredTimer.elapsedSeconds);
          setTimerName(recoveredTimer.title);
        }

        await refreshForMode('month');
        await refreshTimerHistory();
        if (cancelled) return;
        setReady(true);
        setError(null);
        if (loginReward > 0) setToast(`Daily login +${loginReward} EXP`);
      } catch (cause) {
        if (cancelled) return;
        console.error('Dayforge database boot failed', cause);
        setReady(true);
        setError(cause instanceof Error ? cause.message : String(cause || 'Unable to open the local Dayforge database.'));
      }
    }

    void boot();
    return () => { cancelled = true; };
  }, [refreshForMode, refreshTimerHistory]);

  useEffect(() => {
    if (!ready || error) return;
    void refreshForMode(mode).catch((cause) => {
      console.error('Dayforge refresh failed', cause);
      setToast(cause instanceof Error ? cause.message : 'Could not refresh Dayforge.');
    });
  }, [mode, ready, error, refreshForMode]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!timerSession || timerSession.status !== 'running') return;
    const id = window.setInterval(() => {
      setTimerElapsed((current) => {
        const next = current + 1;
        if (next % 30 === 0) void checkpointTimer(timerSession.id, next);
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
            await refreshForMode(mode);
          }
        }).catch((cause) => console.error('Online EXP write failed', cause));
      }
    }, 60_000);
    return () => window.clearInterval(heartbeat);
  }, [mode, refreshForMode]);

  async function toggleExpanded() {
    try {
      const next = !expanded;
      const size = next ? EXPANDED_SIZE : COMPACT_SIZE;
      setResizeMotion(next ? 'expand' : 'collapse');
      if (!next) setTimerHistoryOpen(false);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
      setExpanded(next);
      window.setTimeout(() => setResizeMotion(null), 430);
    } catch (cause) {
      setResizeMotion(null);
      setToast(cause instanceof Error ? cause.message : 'Could not resize Dayforge.');
    }
  }

  async function minimizeWindow() {
    try { await getCurrentWindow().minimize(); }
    catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not minimize Dayforge.'); }
  }

  async function closeWindow() {
    try { await invoke('quit_app'); }
    catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not quit Dayforge.'); }
  }

  function updatePointerHighlight(event: ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--pointer-x', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--pointer-y', `${event.clientY - rect.top}px`);
    event.currentTarget.style.setProperty('--pointer-opacity', '1');
  }

  function hidePointerHighlight(event: ReactPointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty('--pointer-opacity', '0');
  }

  async function submitTodo(event: FormEvent) {
    event.preventDefault();
    if (!todoTitle.trim()) return;
    try {
      await createTodo({ title: todoTitle, taskType: todoType, difficulty: todoDifficulty });
      setTodoTitle('');
      await refreshForMode(mode);
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not save task.'); }
  }

  async function finishTodo(id: string) {
    try {
      const reward = await completeTodo(id);
      if (reward > 0) setToast(`Task complete +${reward} EXP`);
      await refreshForMode(mode);
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not complete task.'); }
  }

  async function submitHabit(event: FormEvent) {
    event.preventDefault();
    if (!habitTitle.trim()) return;
    try {
      await createHabit({ title: habitTitle, difficulty: habitDifficulty, rewardCapPerDay: 8 });
      setHabitTitle('');
      await refreshForMode(mode);
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not save habit.'); }
  }

  async function checkHabit(id: string) {
    try {
      const result = await checkInHabit(id);
      setToast(result.rewarded ? `Check-in +${result.experience} EXP` : 'Check-in saved · daily EXP cap reached');
      await refreshForMode(mode);
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not save check-in.'); }
  }

  async function handleTimerStart() {
    try {
      const session = await startTimer(timerCategory, timerDifficulty, timerName);
      setTimerSession(session);
      setTimerName(session.title);
      setTimerElapsed(0);
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not start timer.'); }
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
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not update timer.'); }
  }

  async function handleTimerComplete() {
    if (!timerSession) return;
    try {
      const reward = await completeTimer(timerSession, timerElapsed);
      setTimerSession(null);
      setTimerName('');
      setTimerElapsed(0);
      setToast(reward > 0 ? `Focus complete +${reward} EXP` : 'Session saved · 5 minutes required for EXP');
      await refreshForMode(mode);
      await refreshTimerHistory();
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not complete timer.'); }
  }

  async function handleTimerCancel() {
    if (!timerSession) return;
    try {
      await cancelTimer(timerSession.id, timerElapsed);
      setTimerSession(null);
      setTimerName('');
      setTimerElapsed(0);
      setToast('Timer cancelled · session history saved');
      await refreshTimerHistory();
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not cancel timer.'); }
  }

  async function toggleTimerHistory() {
    const next = !timerHistoryOpen;
    setTimerHistoryOpen(next);
    setEditingTimerId(null);
    if (!next) return;
    try { await refreshTimerHistory(); }
    catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not load timer history.'); }
  }

  function beginTimerRename(session: TimerSession) {
    setEditingTimerId(session.id);
    setEditingTimerTitle(session.title);
  }

  async function saveTimerRename(id: string) {
    try {
      const title = await renameTimerSession(id, editingTimerTitle);
      setTimerHistory((current) => current.map((session) => session.id === id ? { ...session, title } : session));
      setEditingTimerId(null);
      setEditingTimerTitle('');
      setToast('Timer renamed');
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Could not rename timer.'); }
  }

  const dailyTodos = todos.filter((task) => task.taskType === 'daily');
  const persistentTodos = todos.filter((task) => task.taskType === 'persistent');
  const resizeClass = resizeMotion ? `widget-card--motion-${resizeMotion}` : '';

  return (
    <main className={`widget-shell ${expanded ? 'widget-shell--expanded' : ''}`} onPointerMove={updatePointerHighlight} onPointerLeave={hidePointerHighlight}>
      <section className={`glass-card widget-card ${expanded ? 'widget-card--expanded' : ''} ${resizeClass}`}>
        <div className="window-chrome">
          <div className="window-chrome__brand" data-tauri-drag-region>
            <span className="window-chrome__mark" aria-hidden="true">D</span>
            <span data-tauri-drag-region>Dayforge</span>
          </div>
          <div className="window-chrome__drag-spacer" data-tauri-drag-region aria-hidden="true" />
          <div className="window-chrome__actions">
            <button type="button" aria-label="Minimize Dayforge" title="Minimize" onClick={() => void minimizeWindow()}><Minus size={14} strokeWidth={1.8} /></button>
            <button type="button" aria-label={expanded ? 'Collapse Dayforge' : 'Expand Dayforge'} title={expanded ? 'Collapse' : 'Expand'} onClick={() => void toggleExpanded()}>{expanded ? <Shrink size={13} strokeWidth={1.8} /> : <Maximize2 size={13} strokeWidth={1.8} />}</button>
            <button className="window-chrome__close" type="button" aria-label="Quit Dayforge" title="Quit Dayforge" onClick={() => void closeWindow()}><X size={14} strokeWidth={1.8} /></button>
          </div>
        </div>

        <header className="level-strip">
          <div className="level-strip__row">
            <span className="level-strip__level">Lv.{level.level}</span>
            <span className="level-strip__exp">{level.currentLevelExperience} / {level.requiredForNextLevel} EXP</span>
          </div>
          <div className="level-strip__track" aria-label="Level progress"><div className="level-strip__fill" style={{ width: `${Math.min(level.progress * 100, 100)}%` }} /></div>
        </header>

        <div className={expanded ? 'expanded-grid' : 'compact-layout'}>
          <section className="activity-panel">
            <div className="heatmap-header">
              <div><p className="eyebrow">DAYFORGE</p><h1>Activity</h1></div>
              <div className="segmented" aria-label="Heatmap range">
                <button className={mode === 'month' ? 'is-active' : ''} onClick={() => setMode('month')}>Month</button>
                <button className={mode === 'year' ? 'is-active' : ''} onClick={() => setMode('year')}>Year</button>
              </div>
            </div>
            <div className="heatmap-wrap">
              {!ready ? <div className="status-message">Opening your local history…</div> : null}
              {error ? <div className="status-message status-message--error">Database unavailable: {error}</div> : null}
              {ready && !error ? <Heatmap mode={mode} data={heatmapData} /> : null}
            </div>
            <footer className="widget-footer">
              <span>{expanded ? 'Heatmap rebuilt from saved EXP history.' : 'Every saved EXP event leaves a mark.'}</span>
              {!expanded ? <button className="expand-button" type="button" aria-label="Expand Dayforge" onClick={() => void toggleExpanded()}>+</button> : null}
            </footer>
          </section>

          {expanded ? <>
            <section className="feature-panel todo-panel">
              <div className="panel-heading"><div><p className="eyebrow">TASKS</p><h2>To-do</h2></div><span className="panel-note">Saved locally</span></div>
              <form className="quick-form" onSubmit={submitTodo}>
                <input value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} placeholder="Add a task…" />
                <select value={todoType} onChange={(event) => setTodoType(event.target.value as TaskType)}><option value="daily">Daily</option><option value="persistent">Persistent</option></select>
                <select value={todoDifficulty} onChange={(event) => setTodoDifficulty(event.target.value as Difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
                <button type="submit">Add</button>
              </form>
              <TaskSection title="Daily · refreshes each date" tasks={dailyTodos} onComplete={finishTodo} />
              <TaskSection title="Persistent · stays until done" tasks={persistentTodos} onComplete={finishTodo} />
            </section>

            <section className="feature-panel timer-panel">
              <div className="panel-heading timer-panel-heading">
                <div><p className="eyebrow">FOCUS</p><h2>Timer</h2></div>
                <button className={`timer-history-toggle ${timerHistoryOpen ? 'is-active' : ''}`} type="button" onClick={() => void toggleTimerHistory()}><Clock3 size={12} strokeWidth={1.8} /><span>History</span></button>
              </div>
              <div className="timer-controls">
                <input className="timer-name-input" value={timerName} disabled={Boolean(timerSession)} maxLength={80} onChange={(event) => setTimerName(event.target.value)} placeholder={`${timerCategory} session`} aria-label="Timer name" />
                <select value={timerCategory} disabled={Boolean(timerSession)} onChange={(event) => setTimerCategory(event.target.value as TimerCategory)}><option>Studying</option><option>Working</option><option>Exercise</option><option>Custom</option></select>
                <select value={timerDifficulty} disabled={Boolean(timerSession)} onChange={(event) => setTimerDifficulty(event.target.value as Difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
              </div>
              <div className="timer-clock">{formatElapsed(timerElapsed)}</div>
              <p className="timer-status">{timerSession ? `${timerSession.title} · ${timerSession.category} · ${timerSession.status}` : 'Name the session if you want, then start.'}</p>
              <div className="timer-actions">
                {!timerSession ? <button onClick={() => void handleTimerStart()}>Start</button> : null}
                {timerSession ? <button onClick={() => void handleTimerPauseResume()}>{timerSession.status === 'running' ? 'Pause' : 'Resume'}</button> : null}
                {timerSession ? <button onClick={() => void handleTimerComplete()}>Complete</button> : null}
                {timerSession ? <button className="ghost-button" onClick={() => void handleTimerCancel()}>Cancel</button> : null}
              </div>
              <p className="timer-rule">Timer EXP uses complete 5-minute blocks · Online +1 EXP / 5 min · cap {ONLINE_RULES.dailyCap}/day.</p>

              {timerHistoryOpen ? <div className="timer-history-layer" role="dialog" aria-label="Timer history">
                <div className="timer-history-header">
                  <div><p className="eyebrow">SAVED SESSIONS</p><strong>Timer history</strong></div>
                  <button type="button" className="timer-history-close" onClick={() => setTimerHistoryOpen(false)} aria-label="Close timer history"><X size={13} strokeWidth={1.8} /></button>
                </div>
                <div className="timer-history-list">
                  {timerHistory.length === 0 ? <EmptyState text="No completed sessions yet." /> : timerHistory.map((session) => <article className="timer-history-row" key={session.id}>
                    <div className="timer-history-row__main">
                      {editingTimerId === session.id ? <input className="timer-history-rename" value={editingTimerTitle} maxLength={80} autoFocus onChange={(event) => setEditingTimerTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveTimerRename(session.id); if (event.key === 'Escape') setEditingTimerId(null); }} /> : <strong title={session.title}>{session.title}</strong>}
                      <small>{formatTimerHistoryDate(session)} · {session.category} · {session.difficulty}</small>
                    </div>
                    <div className="timer-history-row__meta"><span>{formatElapsed(session.elapsedSeconds)}</span><small>{session.status === 'completed' ? `+${session.expAwarded} EXP` : 'cancelled'}</small></div>
                    {editingTimerId === session.id ? <button type="button" className="timer-history-icon" aria-label="Save timer name" onClick={() => void saveTimerRename(session.id)}><Check size={12} strokeWidth={2} /></button> : <button type="button" className="timer-history-icon" aria-label="Rename timer" onClick={() => beginTimerRename(session)}><Pencil size={11} strokeWidth={1.8} /></button>}
                  </article>)}
                </div>
              </div> : null}
            </section>

            <section className="feature-panel habit-panel">
              <div className="panel-heading"><div><p className="eyebrow">REPEATABLE</p><h2>Habit Check-in</h2></div><span className="panel-note">Tap again anytime</span></div>
              <form className="quick-form quick-form--habit" onSubmit={submitHabit}>
                <input value={habitTitle} onChange={(event) => setHabitTitle(event.target.value)} placeholder="Add a habit…" />
                <select value={habitDifficulty} onChange={(event) => setHabitDifficulty(event.target.value as Difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
                <button type="submit">Add</button>
              </form>
              <div className="habit-list">
                {habits.length === 0 ? <EmptyState text="No habits yet." /> : habits.map((habit) => <button className="habit-row" key={habit.id} onClick={() => void checkHabit(habit.id)}><span className="habit-row__main"><strong>{habit.title}</strong><small>{habit.difficulty} · {habit.totalCount} total · max {habit.rewardCapPerDay ?? '∞'} rewarded/day</small></span><span className="habit-row__count"><strong>{habit.todayCount}</strong><small>today</small></span></button>)}
              </div>
            </section>

            <SleepPanel onMessage={setToast} />
          </> : null}
        </div>
      </section>
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

function TaskSection({ title, tasks, onComplete }: { title: string; tasks: TodoItem[]; onComplete: (id: string) => Promise<void>; }) {
  return <div className="task-section"><h3>{title}</h3><div className="task-list">
    {tasks.length === 0 ? <EmptyState text="Nothing here yet." /> : tasks.map((task) => <button className={`task-row ${task.completed ? 'is-complete' : ''}`} key={task.id} disabled={task.completed} onClick={() => void onComplete(task.id)}><span className="task-checkbox">{task.completed ? '✓' : ''}</span><span className="task-row__title">{task.title}</span><span className={`difficulty difficulty--${task.difficulty}`}>{task.difficulty}</span></button>)}
  </div></div>;
}

function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }

function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTimerHistoryDate(session: TimerSession): string {
  const date = new Date(session.endedAt ?? session.startedAt);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d · HH:mm');
}
