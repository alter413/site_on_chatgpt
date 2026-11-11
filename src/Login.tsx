import { useState } from 'react';
import {
  ArrowRight,
  ExternalLink,
  Eye,
  EyeOff,
  FolderLock,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { Brand } from './Brand';
import { Badge, Button } from './ui';
import type { Session } from './types';

export function Login({
  checking,
  error,
  onDemo,
  onLogin,
}: {
  checking: boolean;
  error: string;
  onDemo: () => void;
  onLogin: (session: Session) => void;
}) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Panel-Request': '1' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await response.json()) as Partial<Session> & { detail?: string };
      if (!response.ok)
        throw new Error(result.detail || 'Не удалось войти. Проверьте пароль и подключение бота.');
      if (result.access !== 'owner' || typeof result.email !== 'string')
        throw new Error('Сервер не подтвердил вход.');
      setPassword('');
      onLogin({
        email: result.email,
        access: result.access,
        backend_configured: !!result.backend_configured,
      });
    } catch (e) {
      setFailure(
        e instanceof SyntaxError
          ? 'Установите полную версию Worker с серверным входом.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <div className="eyebrow">НА СВЯЗИ. НА ВАШИХ УСЛОВИЯХ.</div>
          <h1>
            Ваши разговоры.
            <br />
            Ваши границы<span>.</span>
          </h1>
          <p>
            Пока вы заняты — Sova отвечает.
            <br />
            Только тем, кому вы разрешили.
            <br />
            Только то, чем вы готовы поделиться.
          </p>
          <div className="login-tags">
            <span>
              <ShieldCheck size={15} />
              Изоляция контекста
            </span>
            <span>
              <FolderLock size={15} />
              Личные песочницы
            </span>
          </div>
        </div>
        <span className="login-story-footer">Чуть меньше уведомлений. Чуть больше жизни.</span>
        <div className="login-orbit" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-form">
          <div className="login-lock">
            <ShieldCheck size={26} />
          </div>
          <Badge tone="green">Только для владельца</Badge>
          <h2>Добро пожаловать домой</h2>
          <p>
            Один пароль. Только ваш доступ.
            <br />
            Без писем, кодов и регистрации.
          </p>
          {checking ? (
            <div className="login-check">
              <LoaderCircle size={17} className="spin" />
              Проверяем вашу сессию…
            </div>
          ) : (
            <form onSubmit={submit}>
              <label className="field" htmlFor="owner-password">
                Пароль владельца
              </label>
              <div className="password-input">
                <input
                  id="owner-password"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  minLength={43}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Вставьте свой секретный пароль"
                  disabled={busy}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <Button type="submit" className="login-button" busy={busy} disabled={!password}>
                Войти в пространство <ArrowRight size={17} />
              </Button>
              {(failure || error) && (
                <div className="login-notice" role={failure ? 'alert' : 'status'}>
                  <ShieldCheck size={16} />
                  <span>{failure || error}</span>
                </div>
              )}
              <small className="password-hint">
                Защищённая сессия на 8 часов. Пароль не сохраняется в браузере.
              </small>
            </form>
          )}
          <div className="login-divider">
            <span>хотите сначала посмотреть?</span>
          </div>
          <Button variant="secondary" onClick={onDemo} className="login-button">
            Посмотреть демопанель <ExternalLink size={15} />
          </Button>
          <small className="login-help">
            Первый запуск?{' '}
            <a
              href="https://github.com/alter413/site_on_chatgpt/blob/main/PASSWORD_LOGIN.md"
              target="_blank"
              rel="noreferrer"
            >
              Короткая инструкция
            </a>
          </small>
        </div>
        <div className="login-security">
          <ShieldCheck size={14} />
          Пароль проверяется на сервере, ключи бота скрыты
        </div>
      </section>
    </div>
  );
}
