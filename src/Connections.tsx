import { useEffect, useState } from 'react';
import { Check, KeyRound, LockKeyhole, LogOut, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { usePanel } from './context';
import { Heading } from './Heading';
import { Badge, Button, Modal, Panel } from './ui';

export interface TelegramState {
  state: 'not_configured' | 'disconnected' | 'code_required' | 'password_required' | 'connected';
  connected: boolean;
  api_id: number | null;
  api_hash_configured: boolean;
  phone: string;
  phone_masked: string;
  session_saved: boolean;
  account: { id: number; name: string } | null;
}
const labels: Record<string, string> = {
  not_configured: 'Не настроен',
  disconnected: 'Не подключён',
  code_required: 'Ожидает код',
  password_required: 'Ожидает 2FA',
  connected: 'Подключён',
};

export function Connections() {
  const { client, refresh, notify, demo, navigate } = usePanel();
  const [state, setState] = useState<TelegramState | null>(null);
  const [error, setError] = useState('');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    client
      .request<TelegramState>('/telegram')
      .then((value) => {
        if (active) {
          setState(value);
          setApiId(value.api_id ? String(value.api_id) : '');
          setPhone(value.phone || '');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [client]);
  async function load() {
    setBusy(true);
    setError('');
    try {
      const next = await client.request<TelegramState>('/telegram');
      setState(next);
      setApiId(next.api_id ? String(next.api_id) : '');
      setPhone(next.phone || '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      const next = await client.request<TelegramState>(path, { method: 'POST', body });
      setState(next);
      setApiHash('');
      setCode('');
      setPassword('');
      if (next.connected) notify('Telegram подключён. Сессия сохранена.');
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="АККАУНТ И СЕССИЯ"
        title="Подключение Telegram"
        text="Войдите один раз. Бот запомнит реквизиты и восстановит сессию при запуске."
        action={
          <Button variant="secondary" busy={busy} onClick={load}>
            <RefreshCw size={15} />
            Обновить статус
          </Button>
        }
      />
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      <div className="settings-columns">
        <Panel
          title="Личный Telegram-аккаунт"
          subtitle="API ID и API hash — с my.telegram.org/apps"
          action={
            <Badge tone={state?.connected ? 'green' : 'neutral'}>
              {state ? labels[state.state] : 'Проверяем API…'}
            </Badge>
          }
        >
          {state?.connected && (
            <div className="soft-note">
              <Check size={22} />
              <h3>{state.account?.name || 'Аккаунт подключён'}</h3>
              <p>
                ID {state.account?.id} · {state.phone_masked}
                <br />
                Сессия сохранена на машине бота. Повторный код при запуске обычно не нужен.
              </p>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action('/telegram/code', {
                api_id: Number(apiId),
                phone,
                ...(apiHash ? { api_hash: apiHash } : {}),
              });
            }}
            className="telegram-form"
          >
            <div className="form-grid">
              <label className="field">
                Telegram API ID
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={apiId}
                  disabled={busy || !state || state.connected}
                  onChange={(e) => setApiId(e.target.value)}
                  placeholder="Например, 12345678"
                />
              </label>
              <label className="field">
                Telegram API hash
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={32}
                  minLength={32}
                  required={!state?.api_hash_configured}
                  disabled={busy || !state || state.connected}
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value.trim())}
                  placeholder={
                    state?.api_hash_configured
                      ? 'Сохранён · оставьте пустым'
                      : '32 символа API hash'
                  }
                />
              </label>
            </div>
            <label className="field">
              Номер телефона Telegram
              <input
                type="tel"
                aria-label="Номер телефона Telegram"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy || !state || state.connected}
                placeholder="+79991234567"
              />
              <small>Номер и API-реквизиты сохраняются зашифрованными.</small>
            </label>
            {!state?.connected && (
              <Button type="submit" busy={busy} disabled={!state}>
                <Send size={16} />
                {state?.session_saved
                  ? 'Восстановить вход / запросить код'
                  : 'Получить код Telegram'}
              </Button>
            )}
          </form>
          {state?.state === 'code_required' && (
            <form
              className="editor-section"
              onSubmit={(e) => {
                e.preventDefault();
                void action('/telegram/verify', { code });
              }}
            >
              <label className="field">
                Код входа Telegram
                <input
                  autoComplete="one-time-code"
                  aria-label="Код входа Telegram"
                  inputMode="numeric"
                  pattern="[0-9]{4,8}"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  maxLength={8}
                  disabled={busy}
                />
                <small>
                  Проверьте Telegram на другом устройстве. Способ доставки определяет Telegram.
                </small>
              </label>
              <Button type="submit" busy={busy}>
                Подтвердить код
              </Button>
            </form>
          )}
          {state?.state === 'password_required' && (
            <form
              className="editor-section"
              onSubmit={(e) => {
                e.preventDefault();
                void action('/telegram/password', { password });
              }}
            >
              <label className="field">
                Пароль двухэтапной проверки Telegram
                <input
                  type="password"
                  autoComplete="off"
                  aria-label="Пароль двухэтапной проверки Telegram"
                  required
                  maxLength={256}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
                <small>Нужен только для завершения входа. Этот пароль не сохраняется.</small>
              </label>
              <Button type="submit" busy={busy}>
                Завершить вход
              </Button>
            </form>
          )}
          {(state?.connected || state?.session_saved) && (
            <div className="editor-section">
              <Button variant="secondary" busy={busy} onClick={() => setConfirm(true)}>
                <LogOut size={15} />
                Выйти из Telegram
              </Button>
              <p className="muted small">
                Выход отменит текущую сессию и остановит автоответы. Песочницы сохранятся.
              </p>
            </div>
          )}
          {demo && (
            <p className="muted small">
              Демонстрация: код 12345 открывает шаг 2FA; пароль может быть любым. Реального входа
              нет.
            </p>
          )}
        </Panel>
        <div className="settings-side">
          <Panel title="Что будет сохранено">
            <ul className="check-list">
              <li>
                <KeyRound size={16} />
                API ID, API hash и телефон
              </li>
              <li>
                <ShieldCheck size={16} />
                Зашифрованная сессия Telegram
              </li>
              <li>
                <LockKeyhole size={16} />
                Ключи и настройки ИИ
              </li>
            </ul>
            <p className="muted small">
              Данные хранятся на машине бота. Коды и пароль 2FA остаются только на время входа.
            </p>
          </Panel>
          <div className="soft-note">
            <ShieldCheck size={22} />
            <h3>Модель этого не видит</h3>
            <p>
              Реквизиты входа не входят в песочницы и не отправляются ИИ. После подключения аккаунта
              статус остаётся «Онлайн».
            </p>
            <Button variant="ghost" onClick={() => navigate('models')}>
              Настроить ИИ →
            </Button>
          </div>
        </div>
      </div>
      {confirm && (
        <Modal title="Выйти из Telegram?" onClose={() => setConfirm(false)}>
          <p>
            Текущая сессия Telegram будет отменена. Для нового входа понадобится код. Материалы
            песочниц сохранятся.
          </p>
          <Button
            variant="danger"
            busy={busy}
            onClick={async () => {
              if (await action('/telegram/logout', {})) setConfirm(false);
            }}
          >
            Подтвердить выход
          </Button>
        </Modal>
      )}
    </>
  );
}
