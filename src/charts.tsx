import { useId, useState } from 'react';
import { Dashboard } from './types';
import { number } from './types';

export function ActivityChart({ data }: { data: Dashboard['daily'] }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(4, ...data.map((d) => Math.max(d.replied, d.skipped)));
  const width = 740,
    height = 205,
    left = 38,
    right = 15,
    top = 20,
    bottom = 30;
  const x = (i: number) => left + (i * (width - left - right)) / Math.max(1, data.length - 1);
  const y = (n: number) => height - bottom - (n / max) * (height - top - bottom);
  const line = (key: 'replied' | 'skipped') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[key])}`).join(' ');
  const active = hover === null ? data.length - 1 : hover;
  return (
    <div className="activity-chart">
      <div className="chart-caption">
        <span>
          <i className="legend-dot" />
          Ответы
        </span>
        <span>
          <i className="legend-dot muted" />
          Пропуски
        </span>
        <strong>
          {data[active] &&
            new Date(data[active].date + 'T12:00:00Z').toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'short',
            })}{' '}
          <b>{number(data[active]?.replied || 0)}</b>
        </strong>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Ответы за период: ${data.map((d) => `${d.date}: ${d.replied}`).join(', ')}`}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1={left}
              x2={width - right}
              y1={y((max * i) / 4)}
              y2={y((max * i) / 4)}
              className="grid-line"
            />
            <text x={left - 12} y={y((max * i) / 4) + 4} textAnchor="end" className="chart-label">
              {Math.round((max * i) / 4)}
            </text>
          </g>
        ))}
        <path
          d={`${line('replied')} L${x(data.length - 1)},${height - bottom} L${left},${height - bottom} Z`}
          fill={`url(#${id})`}
        />
        <path
          d={line('skipped')}
          fill="none"
          stroke="var(--chart-muted)"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <path
          d={line('replied')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setHover(i)}>
            <rect
              x={x(i) - 10}
              y={top}
              width="20"
              height={height - top - bottom}
              fill="transparent"
            />
            {(data.length <= 7 || i % Math.ceil(data.length / 7) === 0) && (
              <text x={x(i)} y={height - 5} className="chart-label" textAnchor="middle">
                {new Date(d.date + 'T12:00:00Z').toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                })}
              </text>
            )}
          </g>
        ))}
        <line
          x1={x(active)}
          x2={x(active)}
          y1={top}
          y2={height - bottom}
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(active)}
          cy={y(data[active]?.replied || 0)}
          r="5"
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth="3"
        />
      </svg>
      <span className="chart-footnote">Границы дней и часов — UTC</span>
    </div>
  );
}

export function HourChart({ data }: { data: Dashboard['hourly'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="hour-chart">
      <svg viewBox="0 0 350 110" role="img" aria-label="Количество событий по часам UTC">
        {data.map((d, i) => (
          <g key={i}>
            <rect
              x={i * 14.2 + 4}
              y={85 - (d.count / max) * 70}
              width="8"
              height={Math.max(2, (d.count / max) * 70)}
              rx="3"
              fill={i >= 9 && i <= 18 ? 'var(--accent)' : 'var(--accent-soft)'}
            >
              <title>
                {d.hour}:00 UTC — {d.count} событий
              </title>
            </rect>
            {i % 6 === 0 && (
              <text x={i * 14.2 + 7} y="107" textAnchor="middle" className="chart-label">
                {String(i).padStart(2, '0')}:00
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function OutcomeChart({ totals }: { totals: Dashboard['totals'] }) {
  const values = [
    { label: 'Ответы', value: totals.replied, color: 'var(--accent)' },
    { label: 'Пропуски', value: totals.skipped, color: 'var(--chart-muted)' },
    { label: 'Отмены', value: totals.cancelled, color: 'var(--amber)' },
    { label: 'Ошибки', value: totals.failed, color: 'var(--danger)' },
  ];
  const total = values.reduce((s, d) => s + d.value, 0);
  let offset = 0;
  return (
    <div className="outcome-chart">
      <svg viewBox="0 0 130 130" role="img" aria-label={`Всего ${total} событий`}>
        <circle cx="65" cy="65" r="48" fill="none" stroke="var(--border)" strokeWidth="13" />
        {values.map((v) => {
          const dash = (v.value / Math.max(1, total)) * 301.59;
          const circle = (
            <circle
              key={v.label}
              cx="65"
              cy="65"
              r="48"
              fill="none"
              stroke={v.color}
              strokeWidth="13"
              strokeDasharray={`${dash} ${301.59 - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 65 65)"
            />
          );
          offset += dash;
          return circle;
        })}
        <text x="65" y="65" textAnchor="middle" className="donut-value">
          {number(total)}
        </text>
        <text x="65" y="82" textAnchor="middle" className="chart-label">
          событий
        </text>
      </svg>
      <div>
        {values.map((v) => (
          <div className="outcome-key" key={v.label}>
            <i style={{ background: v.color }} />
            <span>{v.label}</span>
            <strong>{number(v.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
