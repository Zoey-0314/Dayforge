import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
} from 'date-fns';
import {
  getSleepDurationMinutes,
  listWeekSleepRecords,
  upsertSleepRecord,
  type SleepRecord,
} from './sleepService';

type Props = {
  onMessage?: (message: string) => void;
};

const AXIS_START = 21;
const AXIS_END = 36;
const CHART_LEFT = 66;
const CHART_RIGHT = 474;
const CHART_TOP = 34;
const ROW_GAP = 30;

function decimalHour(value: string, wake = false): number {
  const [hour, minute] = value.split(':').map(Number);
  let result = hour + minute / 60;
  if (wake || result < 12) result += 24;
  return result;
}

function xForHour(hour: number): number {
  const ratio = (hour - AXIS_START) / (AXIS_END - AXIS_START);
  return CHART_LEFT + Math.max(0, Math.min(1, ratio)) * (CHART_RIGHT - CHART_LEFT);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

export function SleepPanel({ onMessage }: Props) {
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [records, setRecords] = useState<SleepRecord[]>([]);
  const [recordDate, setRecordDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [bedtime, setBedtime] = useState('00:30');
  const [wakeTime, setWakeTime] = useState('08:30');
  const [loading, setLoading] = useState(true);

  const weekStart = useMemo(() => startOfWeek(anchorDate, { weekStartsOn: 1 }), [anchorDate]);
  const weekEnd = useMemo(() => endOfWeek(anchorDate, { weekStartsOn: 1 }), [anchorDate]);
  const days = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekStart, weekEnd],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await listWeekSleepRecords(anchorDate));
    } finally {
      setLoading(false);
    }
  }, [anchorDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const parsed = parseISO(recordDate);
    if (Number.isNaN(parsed.getTime())) return;
    setAnchorDate(parsed);
  }, [recordDate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await upsertSleepRecord({ dateKey: recordDate, bedtime, wakeTime });
      await load();
      const duration = getSleepDurationMinutes(bedtime, wakeTime);
      onMessage?.(`Sleep saved · ${formatDuration(duration)} · no EXP`);
    } catch (cause) {
      onMessage?.(cause instanceof Error ? cause.message : 'Could not save sleep record.');
    }
  }

  const lookup = new Map(records.map((record) => [record.dateKey, record]));
  const bedtimePoints: string[] = [];
  const wakePoints: string[] = [];

  days.forEach((day, index) => {
    const record = lookup.get(format(day, 'yyyy-MM-dd'));
    if (!record) return;
    const y = CHART_TOP + index * ROW_GAP + 15;
    bedtimePoints.push(`${xForHour(decimalHour(record.bedtime))},${y}`);
    wakePoints.push(`${xForHour(decimalHour(record.wakeTime, true))},${y}`);
  });

  const axisHours = [21, 24, 27, 30, 33, 36];

  return (
    <section className="feature-panel sleep-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RECOVERY</p>
          <h2>Sleep Record</h2>
        </div>
        <div className="sleep-week-nav">
          <button type="button" onClick={() => setAnchorDate((date) => addWeeks(date, -1))}>‹</button>
          <span>{format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}</span>
          <button type="button" onClick={() => setAnchorDate((date) => addWeeks(date, 1))}>›</button>
        </div>
      </div>

      <form className="sleep-form" onSubmit={submit}>
        <label>
          <span>Date</span>
          <input type="date" value={recordDate} onChange={(event) => setRecordDate(event.target.value)} />
        </label>
        <label>
          <span>Bed</span>
          <input type="time" value={bedtime} onChange={(event) => setBedtime(event.target.value)} />
        </label>
        <label>
          <span>Wake</span>
          <input type="time" value={wakeTime} onChange={(event) => setWakeTime(event.target.value)} />
        </label>
        <button type="submit">Save</button>
      </form>

      <div className="sleep-chart-wrap">
        {loading ? <div className="sleep-loading">Loading saved sleep…</div> : null}
        <svg className="sleep-chart" viewBox="0 0 500 260" role="img" aria-label="Weekly sleep schedule">
          {axisHours.map((hour) => {
            const x = xForHour(hour);
            const label = hour >= 24 ? hour - 24 : hour;
            return (
              <g key={hour}>
                <line className="sleep-grid-line" x1={x} x2={x} y1="26" y2="246" />
                <text className="sleep-axis-label" x={x} y="18" textAnchor="middle">{label}:00</text>
              </g>
            );
          })}

          {days.map((day, index) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const record = lookup.get(dateKey);
            const y = CHART_TOP + index * ROW_GAP + 15;
            const bedX = record ? xForHour(decimalHour(record.bedtime)) : 0;
            const wakeX = record ? xForHour(decimalHour(record.wakeTime, true)) : 0;
            const duration = record ? getSleepDurationMinutes(record.bedtime, record.wakeTime) : 0;

            return (
              <g key={dateKey}>
                <text className="sleep-day-label" x="2" y={y + 4}>{format(day, 'EEE')}</text>
                <line className="sleep-row-line" x1={CHART_LEFT} x2={CHART_RIGHT} y1={y} y2={y} />
                {record ? (
                  <>
                    <line className="sleep-span" x1={bedX} x2={wakeX} y1={y} y2={y} />
                    <circle className="sleep-point sleep-point--bed" cx={bedX} cy={y} r="4" />
                    <circle className="sleep-point sleep-point--wake" cx={wakeX} cy={y} r="4" />
                    <text className="sleep-time-label" x={bedX} y={y - 8} textAnchor="middle">{record.bedtime}</text>
                    <text className="sleep-time-label" x={wakeX} y={y - 8} textAnchor="middle">{record.wakeTime}</text>
                    <title>{`${dateKey}: ${record.bedtime}–${record.wakeTime}, ${formatDuration(duration)}`}</title>
                  </>
                ) : null}
              </g>
            );
          })}

          {bedtimePoints.length > 1 ? <polyline className="sleep-trend sleep-trend--bed" points={bedtimePoints.join(' ')} /> : null}
          {wakePoints.length > 1 ? <polyline className="sleep-trend sleep-trend--wake" points={wakePoints.join(' ')} /> : null}
        </svg>
      </div>

      <footer className="sleep-footer">
        <span><i className="sleep-key sleep-key--bed" /> Bedtime</span>
        <span><i className="sleep-key sleep-key--wake" /> Wake time</span>
        <strong>Tracking only · no EXP</strong>
      </footer>
    </section>
  );
}
