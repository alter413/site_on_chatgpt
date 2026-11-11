import { useEffect, useState } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { usePanel } from './context';
import { Button, Empty, EventList, Panel } from './ui';
import { number } from './types';

import { Heading } from './Heading';

export function ActivityPage() {
  const { data, names, client, notify } = usePanel();
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState(data.activity);
  const [more, setMore] = useState(false);
  useEffect(
    () =>
      setItems((previous) => {
        const latest = new Map([...previous, ...data.activity].map((event) => [event.id, event]));
        return [...latest.values()].sort((a, b) => b.id - a.id);
      }),
    [data.activity],
  );
  const visible = items.filter((e) => filter === 'all' || e.outcome === filter);
  async function loadMore() {
    setMore(true);
    try {
      const next = await client.request<typeof items>(
        `/activity?limit=100&before=${items.at(-1)?.id || ''}`,
      );
      const ids = new Set(items.map((e) => e.id));
      setItems([...items, ...next.filter((e) => !ids.has(e.id))]);
      if (!next.length) notify('Более ранних событий нет');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setMore(false);
    }
  }
  function download() {
    const rows = [
      [
        'id',
        'time_utc',
        'chat_id',
        'outcome',
        'reason',
        'duration_ms',
        'input_tokens',
        'output_tokens',
        'model',
      ],
      ...visible.map((e) => [
        e.id,
        e.at,
        e.chat_id,
        e.outcome,
        e.reason,
        e.duration_ms,
        e.input_tokens,
        e.output_tokens,
        e.model,
      ]),
    ];
    const csv =
      '\uFEFF' +
      rows
        .map((r) =>
          r
            .map(
              (v) =>
                '"' +
                String(v ?? '')
                  .replace(/"/g, '""')
                  .replace(/^[=+@-]/, "'$&") +
                '"',
            )
            .join(','),
        )
        .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sova-events.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <Heading
        eyebrow="ПРОЗРАЧНАЯ РАБОТА"
        title="Журнал активности"
        text="Видно, что произошло. Содержимое переписки остаётся приватным."
        action={
          <Button variant="secondary" onClick={download} disabled={!visible.length}>
            <Download size={16} />
            Экспорт CSV
          </Button>
        }
      />
      <Panel>
        <div className="list-toolbar">
          <div className="filter-tabs" aria-label="Фильтр событий">
            {[
              ['all', 'Все'],
              ['replied', 'Ответы'],
              ['skipped', 'Пропуски'],
              ['cancelled', 'Отмены'],
              ['failed', 'Ошибки'],
            ].map(([v, t]) => (
              <button
                aria-pressed={filter === v}
                className={filter === v ? 'active' : ''}
                onClick={() => setFilter(v)}
                key={v}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="muted">{number(visible.length)} событий</span>
        </div>
        {visible.length ? (
          <EventList items={visible} names={names} />
        ) : (
          <Empty title="Событий с таким результатом нет">
            Попробуйте другой фильтр или дождитесь новых сообщений.
          </Empty>
        )}
        <div className="panel-footer">
          <span>Хранятся последние 20 000 событий · без текста сообщений</span>
          <Button variant="ghost" onClick={loadMore} busy={more} disabled={!items.length}>
            Загрузить ещё <ChevronRight size={15} />
          </Button>
        </div>
      </Panel>
    </>
  );
}
