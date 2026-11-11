import { useEffect, useState } from 'react';
import { Check, Globe2, KeyRound, LockKeyhole, Monitor, RefreshCw, Zap } from 'lucide-react';
import { usePanel } from './context';
import { Button, Panel } from './ui';

import { Heading } from './Heading';

export function Models() {
  const { data, client, run, notify, demo } = usePanel();
  const saved = data.settings;
  const [model, setModel] = useState(saved.model);
  const [base, setBase] = useState(saved.base_url);
  const [key, setKey] = useState('');
  const [searchKey, setSearchKey] = useState('');
  const [style, setStyle] = useState(saved.reply_style);
  const [length, setLength] = useState(saved.max_output_units);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setModel(saved.model);
    setBase(saved.base_url);
    setStyle(saved.reply_style);
    setLength(saved.max_output_units);
  }, [saved.model, saved.base_url, saved.reply_style, saved.max_output_units]);
  async function list() {
    setLoading(true);
    try {
      setModels((await client.request<{ models: string[] }>('/models')).models);
      notify('Список моделей обновлён');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="ИНТЕЛЛЕКТ АССИСТЕНТА"
        title="Модели и поведение"
        text="Выберите, кто отвечает за вас. Ключи остаются на сервере."
      />
      {!saved.runtime_available && (
        <div className="notice warning">
          ИИ не подключён. Запустите Python-бот без флага --api-only, чтобы менять настройки.
        </div>
      )}
      <div className="settings-columns">
        <Panel title="Подключение к ИИ" subtitle="OpenAI-compatible Chat Completions">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                const body: Record<string, unknown> = {
                  model,
                  base_url: base,
                  reply_style: style,
                  max_output_units: length,
                };
                if (key) body.api_key = key;
                if (searchKey) body.search_key = searchKey;
                if (
                  await run(
                    () => client.request('/settings', { method: 'PATCH', body }),
                    'Настройки ИИ применены',
                  )
                ) {
                  setKey('');
                  setSearchKey('');
                }
              } finally {
                setSaving(false);
              }
            }}
          >
            <label className="field">
              Base URL провайдера
              <input
                type="url"
                required
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="https://your-provider.com/v1"
              />
              <small>С /v1, если он требуется. /chat/completions добавляется автоматически.</small>
            </label>
            <label className="field">
              API key
              <div className="input-icon">
                <KeyRound size={16} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    saved.api_key_configured
                      ? 'Ключ настроен · оставьте пустым, чтобы сохранить'
                      : 'Введите ключ провайдера'
                  }
                />
              </div>
              <small>
                Новый ключ действует до перезапуска бота. При смене провайдера укажите новый ключ.
              </small>
            </label>
            <div className="field">
              <label htmlFor="model">Модель</label>
              <div className="model-input">
                <input
                  id="model"
                  list="available-models"
                  required
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Точное имя модели"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={list}
                  busy={loading}
                  aria-label="Получить список моделей"
                >
                  <RefreshCw size={16} />
                </Button>
              </div>
              <datalist id="available-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <small>Введите название вручную или загрузите список текущего провайдера.</small>
            </div>
            <div className="form-grid">
              <label className="field">
                Стиль ответа
                <select value={style} onChange={(e) => setStyle(e.target.value)}>
                  <option value="neutral">Нейтральный</option>
                  <option value="friendly">Дружелюбный</option>
                  <option value="brief">Коротко и по делу</option>
                  <option value="formal">Деловой</option>
                </select>
              </label>
              <label className="field">
                Максимальная длина
                <input
                  type="number"
                  min="100"
                  max="3500"
                  required
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                />
                <small>100–3500 единиц UTF-16</small>
              </label>
            </div>
            <label className="field">
              Tavily API key · необязательно
              <input
                type="password"
                autoComplete="new-password"
                value={searchKey}
                onChange={(e) => setSearchKey(e.target.value)}
                placeholder={
                  saved.search_key_configured
                    ? 'Поиск настроен · новый ключ для замены'
                    : 'Ключ интернет-поиска'
                }
              />
              <small>Поиск дополнительно включается отдельно в каждой песочнице.</small>
            </label>
            <Button type="submit" busy={saving} disabled={!saved.runtime_available && !demo}>
              <Check size={16} />
              Применить настройки
            </Button>
          </form>
        </Panel>
        <div className="settings-side">
          <Panel title="Возможности вашей модели">
            <div className="capability">
              <span>
                <Zap size={19} />
              </span>
              <div>
                <strong>Текстовые ответы</strong>
                <p>Нужна поддержка Chat Completions API.</p>
              </div>
            </div>
            <div className="capability">
              <span>
                <Monitor size={19} />
              </span>
              <div>
                <strong>Изображения и документы</strong>
                <p>Для изображений выберите vision-модель. Текст PDF и DOCX извлекается ботом.</p>
              </div>
            </div>
            <div className="capability">
              <span>
                <Globe2 size={19} />
              </span>
              <div>
                <strong>Поиск в интернете</strong>
                <p>Нужны function calling, ключ Tavily и разрешение для чата.</p>
              </div>
            </div>
          </Panel>
          <div className="soft-note">
            <LockKeyhole size={20} />
            <h3>Секреты не возвращаются в браузер</h3>
            <p>
              Панель показывает только факт настройки ключа. Telegram-сессия остаётся на компьютере
              или сервере бота.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
