export type Status = 'online' | 'offline' | 'busy' | 'unavailable';
export interface Chat {
  id: number;
  enabled: boolean;
  name: string;
  age: number | null;
  location: string;
  web_enabled: boolean;
  revision: number;
}
export interface Material {
  id: number;
  title: string;
  content: { text?: string; image?: string };
}
export interface Settings {
  model: string;
  base_url: string;
  api_key_configured: boolean;
  search_key_configured: boolean;
  reply_style: string;
  max_output_units: number;
  runtime_available: boolean;
}
export type Outcome = 'replied' | 'failed' | 'skipped' | 'cancelled';
export interface Activity {
  id: number;
  at: string;
  chat_id: number | null;
  outcome: Outcome;
  reason: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  model: string;
}
export interface Dashboard {
  days: number;
  timezone: string;
  enabled_chats: number;
  total_chats: number;
  retention_limit: number;
  totals: {
    replied: number;
    failed: number;
    skipped: number;
    cancelled: number;
    tokens: number;
    input_tokens: number;
    output_tokens: number;
    avg_latency_ms: number;
    success_rate: number | null;
  };
  daily: { date: string; replied: number; failed: number; skipped: number; cancelled: number }[];
  hourly: { hour: number; count: number }[];
  context: { chat_id: number; characters: number; materials: number; limit: number }[];
}
export interface PanelData {
  status: Status;
  chats: Chat[];
  settings: Settings;
  dashboard: Dashboard;
  activity: Activity[];
  health: { ok: boolean; telegram_connected: boolean };
}
export interface Appearance {
  theme: 'light' | 'dark' | 'system';
  accent: 'mint' | 'blue' | 'amber';
  density: 'comfortable' | 'compact';
  title: string;
  refresh: number;
}
export interface Session {
  email: string;
  access: string;
  backend_configured: boolean;
}
export const statusLabels: Record<Status, string> = {
  online: 'Онлайн · отвечаю сам',
  offline: 'Не в сети',
  busy: 'Занят',
  unavailable: 'Не могу ответить',
};
export const outcomeLabels: Record<Outcome, string> = {
  replied: 'Ответ отправлен',
  failed: 'Ошибка',
  skipped: 'Пропущено',
  cancelled: 'Отменено',
};
export const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
