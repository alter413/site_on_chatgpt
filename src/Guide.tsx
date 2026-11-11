import { ChevronRight, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { usePanel } from './context';
import { Panel } from './ui';

import { Heading } from './Heading';

export function Guide() {
  const { navigate } = usePanel();
  return (
    <>
      <Heading
        eyebrow="НАЧНИТЕ С ГЛАВНОГО"
        title="Как всё устроено"
        text="Четыре шага до спокойного автоответчика."
      />
      <div className="guide-steps">
        {[
          [
            '01',
            'Подключите аккаунт',
            'Запустите Python-бот, введите Telegram API ID/hash, реквизиты ИИ и пройдите вход по коду. Сессия остаётся на вашем сервере.',
          ],
          [
            '02',
            'Соедините сайт и бота',
            'Создайте Cloudflare Tunnel до localhost:8765. Задайте BOT_API_URL, BOT_ADMIN_TOKEN и случайный OWNER_PASSWORD в секретах Worker. Для входа нужен только пароль.',
          ],
          [
            '03',
            'Наполните песочницы',
            'Выберите личные чаты. Для каждого задайте свой профиль, заметки и документы. По умолчанию автоответы выключены.',
          ],
          [
            '04',
            'Установите свой статус',
            'При «Онлайн» отвечаете вы. «Занят», «Не в сети» и «Не могу ответить» разрешают ответы в выбранных чатах.',
          ],
        ].map(([step, title, text]) => (
          <Panel key={step}>
            <span className="step-number">{step}</span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </Panel>
        ))}
      </div>
      <div className="overview-lower">
        <Panel title="Вопросы и ответы">
          <div className="faq">
            {[
              [
                'Можно разместить всё на Cloudflare?',
                'Cloudflare Pages размещает сайт и серверный proxy. Постоянный Python/Telethon-процесс должен работать на вашем компьютере или VPS. Обычная загрузка сайта не запускает Telegram-аккаунт.',
              ],
              [
                'Почему графики пустые?',
                'В рабочем режиме показываются реальные события с момента установки новой версии бота. Если сообщений не было, счётчики равны нулю. Демоданные доступны только в отдельно обозначенном режиме.',
              ],
              [
                'Сохраняются ли переписки?',
                'Нет. Журнал хранит ID, результат, время, задержку и число токенов, но не тексты сообщений и ответов.',
              ],
              [
                'Какие файлы подходят?',
                'TXT/MD/JSON/CSV/YAML/LOG, PDF с текстовым слоем, DOCX и изображения. До 8 МБ на файл. OCR, видео и голосовые пока не поддерживаются.',
              ],
              [
                'Что произойдёт при перезапуске?',
                'Статус станет «Онлайн». Песочницы сохранятся. Секреты ИИ надо ввести в консоли снова; изменённые в панели ключи живут в памяти процесса.',
              ],
              [
                'Можно ли вернуться к ручным ответам?',
                'В любой момент выберите «Онлайн» в верхней панели. Незавершённые ответы отменятся. Уже отправленное в Telegram не отзывается.',
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Panel>
        <div className="settings-side">
          <Panel title="Полезные переходы">
            <div className="guide-links">
              <button onClick={() => navigate('sandboxes')}>
                Настроить первую песочницу
                <ChevronRight size={17} />
              </button>
              <button onClick={() => navigate('models')}>
                Подключение модели
                <ChevronRight size={17} />
              </button>
              <button onClick={() => navigate('security')}>
                Проверить защиту
                <ChevronRight size={17} />
              </button>
              <a
                href="https://github.com/alter413/site_on_chatgpt"
                target="_blank"
                rel="noreferrer"
              >
                Исходники и инструкция
                <ExternalLink size={15} />
              </a>
            </div>
          </Panel>
          <div className="soft-note">
            <SlidersHorizontal size={22} />
            <h3>Честные настройки</h3>
            <p>
              Панель показывает реальные возможности бота. Смена модели не добавляет ей vision или
              интернет, если провайдер их не поддерживает.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
