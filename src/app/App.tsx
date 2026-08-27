import { useEffect, useMemo, useState } from 'react';
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear } from 'date-fns';
import { getDailyExperienceTotals, getDatabase } from '../db/database';
import { getLevelProgress, getTotalExperience } from '../features/experience/experienceService';
import { Heatmap, type HeatmapDatum, type HeatmapMode } from '../features/heatmap/Heatmap';

export function App() {
  const [mode, setMode] = useState<HeatmapMode>('month');
  const [totalExperience, setTotalExperience] = useState(0);
  const [heatmapData, setHeatmapData] = useState<HeatmapDatum[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const level = useMemo(() => getLevelProgress(totalExperience), [totalExperience]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await getDatabase();
        const now = new Date();
        const from = mode === 'month' ? startOfMonth(now) : startOfYear(now);
        const to = mode === 'month' ? endOfMonth(now) : endOfYear(now);
        const [total, daily] = await Promise.all([
          getTotalExperience(),
          getDailyExperienceTotals(format(from, 'yyyy-MM-dd'), format(to, 'yyyy-MM-dd')),
        ]);

        if (!cancelled) {
          setTotalExperience(total);
          setHeatmapData(daily.map((row) => ({ dateKey: row.date_key, total: Number(row.total) })));
          setReady(true);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setReady(true);
          setError(cause instanceof Error ? cause.message : 'Unable to open the local Dayforge database.');
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return (
    <main className="widget-shell">
      <section className="glass-card widget-card">
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

        <div className="heatmap-header">
          <div>
            <p className="eyebrow">DAYFORGE</p>
            <h1>Activity</h1>
          </div>
          <div className="segmented" aria-label="Heatmap range">
            <button className={mode === 'month' ? 'is-active' : ''} onClick={() => setMode('month')}>
              Month
            </button>
            <button className={mode === 'year' ? 'is-active' : ''} onClick={() => setMode('year')}>
              Year
            </button>
          </div>
        </div>

        <div className="heatmap-wrap">
          {!ready ? <div className="status-message">Opening your local history…</div> : null}
          {error ? <div className="status-message status-message--error">{error}</div> : null}
          {ready && !error ? <Heatmap mode={mode} data={heatmapData} /> : null}
        </div>

        <footer className="widget-footer">
          <span>Every saved EXP event leaves a mark.</span>
          <button className="expand-button" type="button" aria-label="Expand Dayforge" disabled title="Expanded view comes in the next milestone">
            +
          </button>
        </footer>
      </section>
    </main>
  );
}
