import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowUpRight, Check, Circle, LoaderCircle } from 'lucide-react';
import { outcomeLabels, type Activity } from './types';

export function Button({
  children,
  variant = 'primary',
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${props.className || ''}`}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`toggle ${checked ? 'checked' : ''}`}
    >
      <span />
    </button>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <Circle size={6} fill="currentColor" />
      {children}
    </span>
  );
}
export function Avatar({ name, id }: { name?: string; id: number }) {
  return (
    <span className={`avatar color-${id % 4}`}>
      {name
        ? name
            .split(' ')
            .map((n) => n[0])
            .slice(0, 2)
            .join('')
        : String(id).slice(-2)}
    </span>
  );
}
export function EventList({
  items,
  names = {},
  compact = false,
}: {
  items: Activity[];
  names?: Record<number, string>;
  compact?: boolean;
}) {
  if (!items.length)
    return (
      <Empty title="Событий пока нет">
        После первого входящего сообщения здесь появится результат обработки.
      </Empty>
    );
  return (
    <div className="event-list">
      {items.map((e) => (
        <div className="event-row" key={e.id}>
          <span className={`event-symbol ${e.outcome}`}>
            {e.outcome === 'replied' ? (
              <Check size={16} />
            ) : e.outcome === 'failed' ? (
              <span>!</span>
            ) : (
              <ArrowUpRight size={16} />
            )}
          </span>
          <div className="event-main">
            <strong>{e.chat_id ? names[e.chat_id] || `Чат ${e.chat_id}` : 'Система'}</strong>
            <span>
              {outcomeLabels[e.outcome]}
              {!compact && e.reason ? ` · ${reasonLabel(e.reason)}` : ''}
            </span>
          </div>
          {!compact && (
            <span className="event-meta">
              {e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)} с` : '—'}
            </span>
          )}
          <time dateTime={e.at}>
            {new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            <small>
              {new Date(e.at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
            </small>
          </time>
        </div>
      ))}
    </div>
  );
}
export function reasonLabel(reason: string) {
  return (
    (
      {
        online: 'Вы онлайн',
        disabled: 'Чат выключен',
        state_changed_or_duplicate: 'Изменение настроек или повтор',
        TimeoutError: 'Таймаут провайдера',
        ValueError: 'Вложение не поддерживается',
        RuntimeError: 'Ошибка провайдера',
      } as Record<string, string>
    )[reason] || reason
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-label={title} className="modal">
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть окно" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
