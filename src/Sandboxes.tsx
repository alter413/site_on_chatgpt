import { useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  Eye,
  FileText,
  FolderLock,
  Globe2,
  Image,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { usePanel } from './context';
import { Avatar, Badge, Button, Empty, Modal, Panel, Toggle } from './ui';
import { number, type Chat, type Material } from './types';

export function Sandboxes() {
  const { data, client, names, setNames, run, notify } = usePanel();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [add, setAdd] = useState(false);
  const [id, setId] = useState('');
  const [loading, setLoading] = useState(false);
  const filtered = data.chats.filter((c) =>
    `${c.id} ${names[c.id] || ''} ${c.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function loadDialogs() {
    setAdd(true);
    setLoading(true);
    try {
      const dialogs = await client.request<{ id: number; title: string }[]>('/dialogs');
      setNames({ ...names, ...Object.fromEntries(dialogs.map((d) => [d.id, d.title])) });
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }
  const chat = data.chats.find((c) => c.id === selected);
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">ЛИЧНЫЕ ГРАНИЦЫ</div>
        <div className="heading-row">
          <div>
            <h1>
              Песочницы<span className="heading-dot">.</span>
            </h1>
            <p>Разрешите ассистенту знать ровно столько, сколько нужно каждому чату.</p>
          </div>
          <Button onClick={loadDialogs} busy={loading}>
            <Plus size={16} />
            Добавить чат
          </Button>
        </div>
      </div>
      <Panel>
        <div className="list-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Найти чат по имени или ID"
              aria-label="Найти чат"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="muted">
            {data.chats.filter((c) => c.enabled).length} активных / {data.chats.length} всего
          </span>
        </div>
        {filtered.length ? (
          <div className="chat-table">
            <div className="chat-table-head">
              <span>Собеседник</span>
              <span>Контекст</span>
              <span>Интернет</span>
              <span>Автоответ</span>
              <span />
            </div>
            {filtered.map((c) => {
              const context = data.dashboard.context.find((x) => x.chat_id === c.id);
              return (
                <div className="chat-row" key={c.id}>
                  <button className="chat-person" onClick={() => setSelected(c.id)}>
                    <Avatar name={names[c.id]} id={c.id} />
                    <span>
                      <strong>{names[c.id] || `Чат ${c.id}`}</strong>
                      <small>ID {c.id}</small>
                    </span>
                  </button>
                  <span className="chat-context">
                    <FileText size={14} />
                    {context?.materials || 0} материалов
                  </span>
                  <span className="chat-web">
                    <Badge tone={c.web_enabled ? 'green' : 'neutral'}>
                      {c.web_enabled ? 'Разрешён' : 'Выключен'}
                    </Badge>
                  </span>
                  <Toggle
                    checked={c.enabled}
                    label={`Автоответы: ${names[c.id] || c.id}`}
                    onChange={(v) =>
                      run(
                        () =>
                          client.request(`/chats/${c.id}`, {
                            method: 'PATCH',
                            body: { enabled: v },
                          }),
                        v ? 'Чат включён' : 'Чат выключен',
                      )
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label={`Настроить чат ${c.id}`}
                    onClick={() => setSelected(c.id)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={<FolderLock size={36} />}
            title={query ? 'Ничего не найдено' : 'Здесь начинаются ваши границы'}
          >
            {query
              ? 'Измените поисковый запрос.'
              : 'Добавьте личный чат. Новая песочница всегда выключена по умолчанию.'}
          </Empty>
        )}
      </Panel>
      <div className="inline-info">
        <FolderLock size={17} />
        <p>
          Сведения в песочнице доступны только в этом чате. Входящие сообщения не пополняют её
          автоматически.
        </p>
      </div>
      {add && (
        <Modal title="Добавить личный чат" onClose={() => setAdd(false)}>
          <p className="muted">
            Выберите диалог Telegram или укажите его положительный числовой ID.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const number = Number(id);
              if (!Number.isSafeInteger(number) || number <= 0)
                return notify('Нужен положительный числовой ID', true);
              const ok = await run(
                () => client.request(`/chats/${number}`, { method: 'PATCH', body: {} }),
                'Песочница создана',
              );
              if (ok) {
                setAdd(false);
                setSelected(number);
                setId('');
              }
            }}
          >
            <label className="field">
              ID чата
              <input
                inputMode="numeric"
                required
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="Например, 123456789"
              />
            </label>
            <div className="dialog-options">
              {Object.entries(names).map(([key, title]) => (
                <button
                  type="button"
                  className="dialog-option"
                  key={key}
                  onClick={() => setId(key)}
                >
                  <Avatar name={title} id={Number(key)} />
                  <span>
                    {title}
                    <small>{key}</small>
                  </span>
                  {id === key && <Check size={17} />}
                </button>
              ))}
            </div>
            <Button type="submit">Создать песочницу</Button>
          </form>
        </Modal>
      )}
      {chat && <SandboxEditor key={chat.id} chat={chat} onClose={() => setSelected(null)} />}
    </>
  );
}

function SandboxEditor({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const { client, names, run, notify, data } = usePanel();
  const [profile, setProfile] = useState({
    name: chat.name,
    age: chat.age === null ? '' : String(chat.age),
    location: chat.location,
  });
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  async function load() {
    setMaterials(await client.request(`/chats/${chat.id}/materials`));
  }
  useEffect(() => {
    let active = true;
    client
      .request<Material[]>(`/chats/${chat.id}/materials`)
      .then((m) => {
        if (active) setMaterials(m);
      })
      .catch((e) => notify(e.message, true))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chat.id, client, notify]);
  const used = materials.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
  async function upload(file: File) {
    if (file.size > 8 * 1024 * 1024) return notify('Максимальный размер файла — 8 МБ', true);
    setUploading(true);
    const body = new FormData();
    body.set('file', file);
    try {
      if (
        await run(
          () => client.request(`/chats/${chat.id}/files`, { method: 'POST', body }),
          'Материал загружен',
        )
      )
        await load();
    } finally {
      setUploading(false);
    }
  }
  return (
    <Modal title={names[chat.id] || `Песочница ${chat.id}`} onClose={onClose}>
      <div className="editor-meta">
        <Badge tone={chat.enabled ? 'green' : 'neutral'}>
          {chat.enabled ? 'Автоответ разрешён' : 'Автоответ выключен'}
        </Badge>
        <small>ID {chat.id}</small>
      </div>
      <div className="editor-section">
        <div className="section-label">
          <UserRound size={16} />
          <h3>Кем вы будете в этом чате</h3>
        </div>
        <p className="muted">Это ваш профиль для собеседника, а не данные собеседника.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await run(
              () =>
                client.request(`/chats/${chat.id}`, {
                  method: 'PATCH',
                  body: { ...profile, age: profile.age === '' ? null : Number(profile.age) },
                }),
              'Профиль сохранён',
            );
          }}
        >
          <div className="form-grid">
            <label className="field">
              Ваше имя
              <input
                maxLength={500}
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                placeholder="Не задано"
              />
            </label>
            <label className="field">
              Возраст
              <input
                type="number"
                min="0"
                max="150"
                value={profile.age}
                onChange={(e) => setProfile({ ...profile, age: e.target.value })}
                placeholder="Неизвестен"
              />
            </label>
          </div>
          <label className="field">
            Местонахождение
            <input
              maxLength={500}
              value={profile.location}
              onChange={(e) => setProfile({ ...profile, location: e.target.value })}
              placeholder="Только то, чем хотите поделиться"
            />
          </label>
          <Button variant="secondary" type="submit">
            Сохранить профиль
          </Button>
        </form>
      </div>
      <div className="editor-section">
        <div className="section-label">
          <FolderLock size={16} />
          <h3>Разрешённые материалы</h3>
          <span className="count-pill">{materials.length}</span>
        </div>
        <div className="storage-meter">
          <progress value={used} max={200000} aria-label="Размер песочницы" />
          <small>{number(used)} / 200 000 символов</small>
        </div>
        <div className="material-actions">
          <Button variant="secondary" onClick={() => setNote(!note)}>
            <Plus size={15} />
            Заметка
          </Button>
          <label className={`button secondary upload-button ${uploading ? 'disabled' : ''}`}>
            <Upload size={15} />
            {uploading ? 'Загрузка…' : 'Загрузить файл'}
            <input
              type="file"
              disabled={uploading}
              accept=".txt,.md,.json,.csv,.yaml,.yml,.log,.pdf,.docx,.jpg,.jpeg,.png,.webp,.gif"
              aria-label="Загрузить материал"
              onChange={(e) => {
                if (e.target.files?.[0]) void upload(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </label>
          <Button variant="ghost" onClick={() => setPreview(!preview)}>
            <Eye size={15} />
            Контекст
          </Button>
        </div>
        {note && (
          <form
            className="note-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(
                  () =>
                    client.request(`/chats/${chat.id}/materials`, {
                      method: 'POST',
                      body: { title, text },
                    }),
                  'Заметка добавлена',
                )
              ) {
                setNote(false);
                setTitle('');
                setText('');
                await load();
              }
            }}
          >
            <label className="field">
              Заголовок
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Информация о вас
              <textarea
                required
                maxLength={100000}
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Например: по будням отвечаю после 19:00"
              />
            </label>
            <Button type="submit">Добавить в песочницу</Button>
          </form>
        )}
        {loading ? (
          <div className="skeleton" />
        ) : materials.length ? (
          <div className="material-list">
            {materials.map((m) => (
              <div className="material" key={m.id}>
                {m.content.image ? <Image size={18} /> : <FileText size={18} />}
                <div>
                  <strong>{m.title}</strong>
                  <small>
                    {m.content.text ? `${number(m.content.text.length)} символов` : 'Изображение'} ·
                    #{m.id}
                  </small>
                </div>
                <button
                  className="icon-button destructive"
                  aria-label={`Удалить ${m.title}`}
                  onClick={() => setRemoving(m.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">
            Добавьте только сведения, которыми готовы поделиться в этом чате.
          </p>
        )}
        {removing !== null && (
          <div className="confirm-bar" role="alert">
            <span>Удалить этот материал?</span>
            <Button
              variant="danger"
              onClick={async () => {
                if (
                  await run(
                    () =>
                      client.request(`/chats/${chat.id}/materials/${removing}`, {
                        method: 'DELETE',
                      }),
                    'Материал удалён',
                  )
                ) {
                  setRemoving(null);
                  await load();
                }
              }}
            >
              Удалить
            </Button>
            <button
              className="icon-button"
              aria-label="Отмена удаления"
              onClick={() => setRemoving(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {preview && (
          <div className="context-preview">
            <h3>Что получит модель</h3>
            <p>
              Сохранённый профиль:{' '}
              {JSON.stringify({ name: chat.name, age: chat.age, location: chat.location })}
            </p>
            <p>Ручной статус: {data.status}. Плюс только текущее входящее сообщение.</p>
            {materials.map((m) => (
              <div key={m.id}>
                <strong>{m.title}</strong>
                {m.content.text && <p>{m.content.text}</p>}
                {m.content.image && <img src={m.content.image} alt={m.title} />}
              </div>
            ))}
            <small>Другие чаты и история не включаются. Здесь показаны сохранённые данные.</small>
          </div>
        )}
      </div>
      <div className="setting-row">
        <div>
          <strong>
            <Globe2 size={16} />
            Поиск в интернете
          </strong>
          <p>Общие сведения. Поисковик не получает вашу песочницу.</p>
        </div>
        <Toggle
          checked={chat.web_enabled}
          label="Интернет для этого чата"
          onChange={(v) =>
            run(
              () =>
                client.request(`/chats/${chat.id}`, { method: 'PATCH', body: { web_enabled: v } }),
              'Разрешение интернета обновлено',
            )
          }
        />
      </div>
      <p className="muted small">
        Лимит файла: 8 МБ. PDF нужен с текстовым слоем; OCR, голосовые и видео пока не
        поддерживаются.
      </p>
    </Modal>
  );
}
