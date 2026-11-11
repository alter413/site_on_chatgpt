import { Demo } from './demo';
import type { PanelData } from './types';

export class Client {
  constructor(
    public demo: Demo | null = null,
    private onUnauthorized?: () => void,
  ) {}
  async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const method = options.method || 'GET';
    if (this.demo) return (await this.demo.request(path, method, options.body)) as T;
    const isFile = options.body instanceof FormData;
    const response = await fetch('/api/v1' + path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'X-Panel-Request': '1',
        ...(!isFile && options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body
        ? isFile
          ? (options.body as FormData)
          : JSON.stringify(options.body)
        : undefined,
      signal: AbortSignal.timeout(35000),
    });
    if (!response.ok) {
      let detail = 'Не удалось связаться с ботом';
      try {
        const error = (await response.json()) as { detail?: string };
        detail = error.detail || detail;
      } catch {
        /* no upstream content */
      }
      if (response.status === 401) {
        detail = 'Сессия истекла. Введите пароль снова.';
        this.onUnauthorized?.();
      }
      throw new Error(detail);
    }
    return (response.status === 204 ? null : await response.json()) as T;
  }
  async load(days: number): Promise<PanelData> {
    const [status, chats, settings, dashboard, activity, health] = await Promise.all([
      this.request<{ status: PanelData['status'] }>('/status'),
      this.request<PanelData['chats']>('/chats'),
      this.request<PanelData['settings']>('/settings'),
      this.request<PanelData['dashboard']>(`/dashboard?days=${days}`),
      this.request<PanelData['activity']>('/activity'),
      this.request<PanelData['health']>('/health'),
    ]);
    return { status: status.status, chats, settings, dashboard, activity, health };
  }
}
