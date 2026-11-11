import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  Clock3,
  FileLock2,
  Layers3,
  MessageSquare,
  Pause,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { usePanel } from './context';
import { ActivityChart, HourChart, OutcomeChart } from './charts';
import { Badge, Button, Empty, EventList, Panel } from './ui';
import { number } from './types';

export function Overview() {
  const { data, days, setDays, navigate, names, run, client } = usePanel();
  const d = data.dashboard,
    t = d.totals;
  const paused = data.status === 'online';
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">
          <span className="tiny-line" />
          ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО
        </div>
        <div className="heading-row">
          <div>
            <h1>
              Всё под вашим контролем<span className="heading-dot">.</span>
            </h1>
            <p>Ваши разговоры. Ваши границы. Ассистент, который их соблюдает.</p>
          </div>
          <label className="period-select">
            <span className="sr-only">Период статистики</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Последние 7 дней</option>
              <option value={14}>Последние 14 дней</option>
              <option value={30}>Последние 30 дней</option>
            </select>
          </label>
        </div>
      </div>
      <div className={`presence-banner ${paused ? 'paused' : ''}`}>
        <span className="presence-icon">
          {paused ? <Pause size={21} /> : <Sparkles size={21} />}
        </span>
        <div>
          <strong>{paused ? 'Сейчас отвечаете вы' : 'Sova присматривает за сообщениями'}</strong>
          <p>
            {paused
              ? 'Вы онлайн. Автоответы остановлены во всех чатах.'
              : `Автоответы разрешены в ${d.enabled_chats} чатах. Остальное остаётся только вашим.`}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            paused
              ? navigate('sandboxes')
              : run(
                  () => client.request('/status', { method: 'PUT', body: { status: 'online' } }),
                  'Автоответы приостановлены',
                )
          }
        >
          {paused ? (
            'Настроить чаты'
          ) : (
            <>
              <Pause size={15} />
              Приостановить
            </>
          )}
        </Button>
        <span className="presence-decoration" aria-hidden="true">
          ✳
        </span>
      </div>
      <div className="stats-grid">
        <Stat
          icon={<MessageSquare size={17} />}
          title="Ответов ассистента"
          value={number(t.replied)}
          footer={
            <>
              <span className="mini-label positive">
                <CircleCheck size={12} />
                Отправлено
              </span>
              <span>за {days} дней</span>
            </>
          }
        />
        <Stat
          icon={<Layers3 size={17} />}
          title="Активных песочниц"
          value={`${d.enabled_chats}`}
          suffix={`/ ${d.total_chats}`}
          footer={
            <>
              <span className="mini-label">Изолированный контекст</span>
              <button
                onClick={() => navigate('sandboxes')}
                className="text-link"
                aria-label="Открыть песочницы"
              >
                <ArrowUpRight size={15} />
              </button>
            </>
          }
        />
        <Stat
          icon={<Clock3 size={17} />}
          title="Среднее время ответа"
          value={t.avg_latency_ms ? (t.avg_latency_ms / 1000).toFixed(1) : '—'}
          suffix={t.avg_latency_ms ? 'с' : ''}
          footer={
            <>
              <span className="mini-label">От получения до отправки</span>
            </>
          }
        />
        <Stat
          icon={<Zap size={17} />}
          title="Использовано токенов"
          value={t.tokens >= 1000 ? `${(t.tokens / 1000).toFixed(1)}k` : number(t.tokens)}
          footer={
            <>
              <span>
                <ArrowDownLeft size={12} />
                {number(t.input_tokens)}
              </span>
              <span>
                <ArrowUpRight size={12} />
                {number(t.output_tokens)}
              </span>
            </>
          }
        />
      </div>
      <div className="overview-main">
        <Panel
          title="Активность ассистента"
          subtitle="Как Sova помогает вам оставаться на связи"
          action={
            <Badge tone={data.health.telegram_connected ? 'green' : 'neutral'}>
              {data.health.telegram_connected ? 'Telegram подключён' : 'Telegram не подключён'}
            </Badge>
          }
        >
          <ActivityChart data={d.daily} />
          <div className="chart-summary">
            <span>
              <strong>{t.success_rate === null ? '—' : `${t.success_rate}%`}</strong> успешных
              ответов
            </span>
            <span className="summary-separator" />
            <span>
              <strong>{number(t.skipped)}</strong> сообщений оставлено вам
            </span>
            <button className="text-link" onClick={() => navigate('activity')}>
              Подробнее <ArrowRight size={14} />
            </button>
          </div>
        </Panel>
        <Panel title="Ваш контекст защищён" className="privacy-panel">
          <div className="privacy-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="privacy-shield">
              <ShieldCheck size={40} strokeWidth={1.3} />
            </div>
            <i className="orbit-point one" />
            <i className="orbit-point two" />
            <FileLock2 className="orbit-file" size={22} />
          </div>
          <h3>Каждому — только своё</h3>
          <p>У каждого чата отдельная песочница. История переписки не передаётся модели.</p>
          <div className="privacy-bottom">
            <Badge tone="green">Изоляция включена</Badge>
            <button
              aria-label="Открыть раздел безопасности"
              onClick={() => navigate('security')}
              className="icon-button"
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
        </Panel>
      </div>
      <div className="overview-lower">
        <Panel
          title="Последние события"
          subtitle="Метаданные без содержимого переписки"
          action={
            <button className="text-link" onClick={() => navigate('activity')}>
              Все события <ArrowRight size={14} />
            </button>
          }
        >
          <EventList items={data.activity.slice(0, 4)} names={names} compact />
        </Panel>
        <Panel title="Ритм сообщений" subtitle={`Распределение по часам · UTC · ${days} дней`}>
          <HourChart data={d.hourly} />
          <div className="rhythm-note">
            <span className="mini-square" />
            Часы вашей активности
          </div>
        </Panel>
      </div>
      <div className="overview-lower">
        <Panel
          title="Результаты обработки"
          subtitle="Ответы, пропуски и отмены за выбранный период"
        >
          <OutcomeChart totals={t} />
        </Panel>
        <Panel
          title="Песочницы в деталях"
          subtitle="Сколько информации доступно ассистенту"
          action={
            <button className="text-link" onClick={() => navigate('sandboxes')}>
              Управление <ArrowRight size={14} />
            </button>
          }
        >
          {d.context.length ? (
            <div className="context-list">
              {d.context.slice(0, 4).map((c) => (
                <div key={c.chat_id}>
                  <div>
                    <span>{names[c.chat_id] || `Чат ${c.chat_id}`}</span>
                    <small>{number(c.characters)} / 200k</small>
                  </div>
                  <progress
                    max={c.limit}
                    value={c.characters}
                    aria-label={`Заполнение песочницы ${c.chat_id}`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Создайте первую песочницу">
              Добавьте чат и разрешённые сведения о себе.
            </Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
function Stat({
  icon,
  title,
  value,
  suffix,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  suffix?: string;
  footer: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        <span>{title}</span>
        {icon}
      </div>
      <div className="stat-number">
        {value}
        <small>{suffix}</small>
      </div>
      <div className="stat-footer">{footer}</div>
    </div>
  );
}
