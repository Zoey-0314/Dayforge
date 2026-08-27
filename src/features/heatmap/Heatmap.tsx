import { eachDayOfInterval, endOfMonth, endOfYear, format, startOfMonth, startOfYear } from 'date-fns';

export type HeatmapMode = 'month' | 'year';

export type HeatmapDatum = {
  dateKey: string;
  total: number;
};

type Props = {
  mode: HeatmapMode;
  data: HeatmapDatum[];
  referenceDate?: Date;
};

function intensity(total: number): number {
  if (total <= 0) return 0;
  if (total <= 20) return 1;
  if (total <= 50) return 2;
  if (total <= 100) return 3;
  if (total <= 200) return 4;
  return 5;
}

export function Heatmap({ mode, data, referenceDate = new Date() }: Props) {
  const from = mode === 'month' ? startOfMonth(referenceDate) : startOfYear(referenceDate);
  const to = mode === 'month' ? endOfMonth(referenceDate) : endOfYear(referenceDate);
  const lookup = new Map(data.map((item) => [item.dateKey, item.total]));
  const days = eachDayOfInterval({ start: from, end: to });

  return (
    <div className={`heatmap heatmap--${mode}`} aria-label={`${mode} activity heatmap`}>
      {days.map((day) => {
        const dateKey = format(day, 'yyyy-MM-dd');
        const total = Number(lookup.get(dateKey) ?? 0);
        return (
          <div
            key={dateKey}
            className={`heatmap__cell heatmap__cell--${intensity(total)}`}
            title={`${dateKey}: ${total} EXP`}
            aria-label={`${dateKey}, ${total} EXP`}
          />
        );
      })}
    </div>
  );
}
