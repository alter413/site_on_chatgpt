import { Cloud, Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';
import { usePanel } from './context';
import { Badge, Panel } from './ui';

import { Heading } from './Heading';

export function SecurityPage() {
  const { demo } = usePanel();
  return (
    <>
      <Heading
        eyebrow="ДОСТУП ТОЛЬКО ВАМ"
        title="Безопасность"
        text="Два уровня защиты: личный вход на сайт и отдельный токен API бота."
      />
      <div className="security-grid">
        {[
          {
            icon: Fingerprint,
            title: 'Личность владельца',
            text: 'Случайный пароль владельца проверяется сервером. Сессия на 8 часов хранится в HttpOnly cookie; выход отзывает её в базе бота.',
            badge: demo ? 'Демонстрация' : 'Проверяется сервером',
          },
          {
            icon: KeyRound,
            title: 'Секреты на сервере',
            text: 'Пароль и токен API хранятся в секретах Worker. Ключи ИИ не возвращаются в ответах API и не сохраняются в браузере.',
            badge: 'Без ключей в сборке',
          },
          {
            icon: ShieldCheck,
            title: 'Изоляция контекста',
            text: 'Одна песочница — один собеседник. История и другие чаты не передаются модели. Входящие не становятся памятью.',
            badge: 'Включена всегда',
          },
          {
            icon: Cloud,
            title: 'Закрытая связь с ботом',
            text: 'Панель обращается через серверный proxy к HTTPS-адресу Cloudflare Tunnel. Порт Python API остаётся на localhost.',
            badge: 'Серверный proxy',
          },
        ].map((item) => (
          <Panel key={item.title}>
            <span className="security-icon">
              <item.icon size={24} />
            </span>
            <h2>{item.title}</h2>
            <p className="muted">{item.text}</p>
            <Badge tone="green">{item.badge}</Badge>
          </Panel>
        ))}
      </div>
      <Panel title="Границы, которые важно понимать">
        <div className="security-notes">
          <div>
            <h3>Модель может ошибаться</h3>
            <p>
              Изоляция ограничивает передаваемые данные. Она не гарантирует, что генеративная модель
              никогда не выдумает факт или не поддастся prompt injection.
            </p>
          </div>
          <div>
            <h3>Данные получает выбранный провайдер</h3>
            <p>
              Профиль, материалы и текущее сообщение передаются ИИ с store: false. Условия хранения
              определяет ваш провайдер.
            </p>
          </div>
          <div>
            <h3>Локальная сессия — доступ к аккаунту</h3>
            <p>
              Защитите папку data средствами ОС. Telegram-сессия и SQLite не зашифрованы
              приложением. Удаление материала не стирает его из старых резервных копий.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
