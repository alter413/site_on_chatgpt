import type { Activity, Chat, Dashboard, Material, Settings, Status } from './types';
import type { TelegramState } from './Connections';

export class Demo {
  telegramState: TelegramState = {
    state: 'connected',
    connected: true,
    api_id: 123456,
    api_hash_configured: true,
    phone: '+79991234567',
    phone_masked: '+*******4567',
    session_saved: true,
    account: { id: 4242, name: 'Алексей' },
  };
  status: Status = 'busy';
  chats: Chat[] = [
    {
      id: 1001,
      name: 'Алексей',
      age: 27,
      location: 'Санкт-Петербург',
      enabled: true,
      web_enabled: true,
      revision: 0,
    },
    {
      id: 1002,
      name: 'Лёша',
      age: 27,
      location: '',
      enabled: true,
      web_enabled: false,
      revision: 0,
    },
    {
      id: 1003,
      name: 'Алексей',
      age: null,
      location: 'Россия',
      enabled: false,
      web_enabled: false,
      revision: 0,
    },
    {
      id: 1004,
      name: 'Alex',
      age: 27,
      location: '',
      enabled: true,
      web_enabled: true,
      revision: 0,
    },
  ];
  titles: Record<number, string> = {
    1001: 'Анна Смирнова',
    1002: 'Дмитрий',
    1003: 'Рабочие вопросы',
    1004: 'Мария',
  };
  settings: Settings = {
    model: 'my-vision-model',
    base_url: 'https://ai.example.com/v1',
    api_key_configured: true,
    search_key_configured: true,
    reply_style: 'friendly',
    max_output_units: 1800,
    runtime_available: true,
  };
  materials: Record<number, Material[]> = {
    1001: [
      {
        id: 1,
        title: 'Что можно обо мне знать',
        content: {
          text: 'Работаю над личным проектом. По будням отвечаю вечером. Люблю фотографию и пешие прогулки.',
        },
      },
      {
        id: 2,
        title: 'Расписание и контакты.txt',
        content: {
          text: 'Рабочие вопросы: с 10:00 до 18:00. Для срочных вопросов лучше позвонить.',
        },
      },
    ],
    1002: [
      {
        id: 3,
        title: 'Для друзей',
        content: { text: 'На этой неделе много работы. В выходные свободен.' },
      },
    ],
    1004: [
      {
        id: 4,
        title: 'Профиль',
        content: { text: 'Изучаю дизайн и разработку. Не сообщать точный адрес.' },
      },
    ],
  };
  activity: Activity[] = Array.from({ length: 24 }, (_, i) => ({
    id: 100 - i,
    at: new Date(Date.now() - i * 13 * 60000).toISOString(),
    chat_id: [1001, 1002, 1004, 1003][i % 4],
    outcome: i % 9 === 8 ? 'failed' : i % 5 === 4 ? 'skipped' : 'replied',
    reason: i % 9 === 8 ? 'TimeoutError' : i % 5 === 4 ? 'disabled' : '',
    duration_ms: 900 + i * 131,
    input_tokens: 320 + i * 10,
    output_tokens: 40 + i * 2,
    model: 'my-vision-model',
  }));
  dashboard(days: number): Dashboard {
    const daily = Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10),
      replied: [18, 27, 21, 38, 32, 46, 41][i % 7],
      skipped: [8, 11, 5, 13, 8, 17, 9][i % 7],
      failed: i % 4 === 0 ? 1 : 0,
      cancelled: i % 3 === 0 ? 2 : 0,
    }));
    const replied = daily.reduce((sum, d) => sum + d.replied, 0);
    const failed = daily.reduce((sum, d) => sum + d.failed, 0);
    return {
      days,
      timezone: 'UTC',
      enabled_chats: this.chats.filter((c) => c.enabled).length,
      total_chats: this.chats.length,
      retention_limit: 20000,
      totals: {
        replied,
        failed,
        skipped: daily.reduce((s, d) => s + d.skipped, 0),
        cancelled: daily.reduce((s, d) => s + d.cancelled, 0),
        tokens: replied * 472,
        input_tokens: replied * 410,
        output_tokens: replied * 62,
        avg_latency_ms: 1840,
        success_rate: Math.round((replied / (replied + failed)) * 1000) / 10,
      },
      daily,
      hourly: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: [
          2, 1, 0, 0, 1, 0, 2, 5, 12, 19, 15, 22, 18, 25, 32, 28, 24, 30, 20, 15, 11, 8, 5, 2,
        ][h],
      })),
      context: this.chats.map((c) => ({
        chat_id: c.id,
        characters: (this.materials[c.id] || []).reduce(
          (s, m) => s + JSON.stringify(m.content).length,
          0,
        ),
        materials: (this.materials[c.id] || []).length,
        limit: 200000,
      })),
    };
  }
  async request(path: string, method: string, body?: unknown): Promise<unknown> {
    const value = body as Record<string, unknown>;
    if (path === '/telegram') return structuredClone(this.telegramState);
    if (path === '/telegram/code') {
      this.telegramState = {
        ...this.telegramState,
        state: 'code_required',
        connected: false,
        api_id: Number(value.api_id),
        api_hash_configured: true,
        phone: String(value.phone),
        phone_masked: '+*******' + String(value.phone).slice(-4),
        account: null,
      };
      return structuredClone(this.telegramState);
    }
    if (path === '/telegram/verify') {
      if (value.code === '00000') throw new Error('Неверный код Telegram');
      this.telegramState.state = 'password_required';
      return structuredClone(this.telegramState);
    }
    if (path === '/telegram/password') {
      this.telegramState = {
        ...this.telegramState,
        state: 'connected',
        connected: true,
        session_saved: true,
        account: { id: 4242, name: 'Алексей' },
      };
      this.status = 'online';
      return structuredClone(this.telegramState);
    }
    if (path === '/telegram/logout') {
      this.telegramState = {
        ...this.telegramState,
        state: 'disconnected',
        connected: false,
        session_saved: false,
        account: null,
      };
      this.status = 'online';
      return structuredClone(this.telegramState);
    }
    if (path === '/status') {
      if (method === 'PUT') this.status = value.status as Status;
      return { status: this.status };
    }
    if (path === '/health') return { ok: true, telegram_connected: this.telegramState.connected };
    if (path === '/chats') return structuredClone(this.chats);
    if (path === '/settings') {
      if (method === 'PATCH') {
        Object.assign(
          this.settings,
          Object.fromEntries(
            Object.entries(value).filter(([k]) => !['api_key', 'search_key'].includes(k)),
          ),
        );
        if (value.api_key) this.settings.api_key_configured = true;
      }
      return { ...this.settings };
    }
    if (path.startsWith('/dashboard'))
      return this.dashboard(Number(new URLSearchParams(path.split('?')[1]).get('days') || 7));
    if (path.startsWith('/activity')) return [...this.activity];
    if (path === '/dialogs')
      return this.chats.map((c) => ({ id: c.id, title: this.titles[c.id], enabled: c.enabled }));
    if (path === '/models')
      return { models: ['my-vision-model', 'my-fast-model', 'my-reasoning-model'] };
    const match = path.match(/^\/chats\/(\d+)(?:\/(materials|files)(?:\/(\d+))?)?$/);
    if (match) {
      const id = Number(match[1]);
      let chat = this.chats.find((c) => c.id === id);
      if (!chat) {
        chat = {
          id,
          enabled: false,
          name: '',
          age: null,
          location: '',
          web_enabled: false,
          revision: 0,
        };
        this.chats.push(chat);
      }
      if (!match[2]) {
        if (method === 'PATCH') Object.assign(chat, value);
        return { ...chat };
      }
      this.materials[id] ||= [];
      if (method === 'GET') return structuredClone(this.materials[id]);
      if (method === 'DELETE') {
        this.materials[id] = this.materials[id].filter((m) => m.id !== Number(match[3]));
        return null;
      }
      const next = Date.now();
      if (match[2] === 'files') {
        const file = (body as FormData).get('file') as File;
        this.materials[id].push({
          id: next,
          title: file.name,
          content: { text: 'Демонстрация загрузки. Содержимое файла не отправлено на сервер.' },
        });
      } else
        this.materials[id].push({
          id: next,
          title: String(value.title),
          content: { text: String(value.text) },
        });
      return { id: next };
    }
    throw new Error('Действие недоступно в деморежиме');
  }
}
