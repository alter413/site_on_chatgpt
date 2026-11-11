import { authenticated, authRoute, AuthUnavailable, configured, json, type Env } from './auth';
export type { Env } from './auth';

const MAX_BODY = 8 * 1024 * 1024 + 65536;

async function safeTelegramError(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let text = '';
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.length > 2048) {
      await reader.cancel();
      return null;
    }
  }
  const allowed = new Set([
    'Неверный код Telegram',
    'Код Telegram истёк. Запросите новый',
    'Неверный пароль двухэтапной проверки',
    'Telegram отклонил номер телефона',
    'Не удалось выполнить вход в Telegram. Проверьте реквизиты и сеть',
    'Нужен личный Telegram-аккаунт',
    'Сохранена сессия другого номера. Сначала выйдите из Telegram',
    'Сначала выйдите из текущего Telegram-аккаунта',
    'Сначала запросите новый код входа',
    'Попытки или время входа истекли. Запросите код заново',
    'Повторный запрос кода доступен через минуту',
    'Операция уже выполняется. Подождите её завершения',
    'Неверный Telegram API ID',
    'API hash должен содержать 32 шестнадцатеричных символа',
    'Телефон должен быть в международном формате +79991234567',
    'Telegram не подтвердил выход. Проверьте соединение',
    'Для настройки с сайта запустите бот с --web',
    'Telegram не ответил вовремя. Попробуйте ещё раз',
  ]);
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (
      typeof parsed.detail === 'string' &&
      (allowed.has(parsed.detail) ||
        /^Telegram ограничил запросы\. Подождите \d{1,7} секунд$/.test(parsed.detail))
    )
      return parsed.detail;
  } catch {
    /* no arbitrary backend content */
  }
  return null;
}

export function allowedRoute(path: string, method: string) {
  const routes: [RegExp, string[]][] = [
    [/^\/api\/v1\/telegram$/, ['GET']],
    [/^\/api\/v1\/telegram\/(code|verify|password|logout)$/, ['POST']],
    [/^\/api\/v1\/(health|dialogs|chats|dashboard|activity|models)$/, ['GET']],
    [/^\/api\/v1\/status$/, ['GET', 'PUT']],
    [/^\/api\/v1\/settings$/, ['GET', 'PATCH']],
    [/^\/api\/v1\/chats\/[1-9]\d*$/, ['GET', 'PATCH']],
    [/^\/api\/v1\/chats\/[1-9]\d*\/materials$/, ['GET', 'POST']],
    [/^\/api\/v1\/chats\/[1-9]\d*\/files$/, ['POST']],
    [/^\/api\/v1\/chats\/[1-9]\d*\/materials\/[1-9]\d*$/, ['DELETE']],
  ];
  return routes.some(([pattern, methods]) => pattern.test(path) && methods.includes(method));
}

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: {
    fetch?: typeof fetch;
  } = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (!configured(env))
    return json(
      {
        error: 'not_configured',
        detail:
          'Добавьте секрет OWNER_PASSWORD — случайный пароль из 43 символов — в настройках Worker.',
      },
      503,
    );
  try {
    const auth = await authRoute(request, env, dependencies.fetch || fetch);
    if (auth) return auth;
    if (!(await authenticated(request, env, dependencies.fetch || fetch)))
      return json({ error: 'unauthorized', detail: 'Введите пароль владельца.' }, 401);
  } catch (error) {
    if (error instanceof AuthUnavailable)
      return json(
        {
          error: 'auth_unavailable',
          detail: 'Запустите обновлённого бота и Tunnel. Проверьте BOT_API_URL и BOT_ADMIN_TOKEN.',
        },
        503,
      );
    return json({ error: 'unauthorized', detail: 'Введите пароль владельца.' }, 401);
  }
  if (url.pathname === '/api/session' && request.method === 'GET')
    return json({
      email: 'Владелец',
      access: 'owner',
      backend_configured: Boolean(env.BOT_API_URL && env.BOT_ADMIN_TOKEN),
    });
  if (!allowedRoute(url.pathname, request.method)) return json({ error: 'not_found' }, 404);
  if (
    request.method !== 'GET' &&
    (request.headers.get('Origin') !== url.origin || request.headers.get('X-Panel-Request') !== '1')
  )
    return json({ error: 'csrf_rejected' }, 403);
  if (!env.BOT_API_URL || !env.BOT_ADMIN_TOKEN)
    return json(
      {
        error: 'backend_not_configured',
        detail: 'Добавьте BOT_API_URL и BOT_ADMIN_TOKEN в настройках Worker.',
      },
      503,
    );
  let base: URL;
  try {
    base = new URL(env.BOT_API_URL);
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.pathname !== '/' && base.pathname !== '')
    )
      throw new Error();
  } catch {
    return json({ error: 'invalid_backend_url' }, 503);
  }
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) {
            await reader.cancel();
            return json({ error: 'file_too_large' }, 413);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.byteLength;
    }
    body = bytes.buffer;
  }
  const headers = new Headers({ Authorization: `Bearer ${env.BOT_ADMIN_TOKEN}` });
  if (request.headers.has('Content-Type'))
    headers.set('Content-Type', request.headers.get('Content-Type')!);
  if (env.BOT_ACCESS_CLIENT_ID && env.BOT_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id', env.BOT_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', env.BOT_ACCESS_CLIENT_SECRET);
  }
  const target = new URL(url.pathname, base);
  for (const key of ['days', 'limit', 'before'])
    if (url.searchParams.has(key)) target.searchParams.set(key, url.searchParams.get(key)!);
  try {
    const upstream = await (dependencies.fetch || fetch)(target, {
      method: request.method,
      body,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (upstream.status >= 300 && upstream.status < 400)
      return json(
        { error: 'backend_redirect', detail: 'Проверьте адрес API и Tunnel Access.' },
        502,
      );
    if (!upstream.ok) {
      const telegramDetail = url.pathname.startsWith('/api/v1/telegram')
        ? await safeTelegramError(upstream)
        : null;
      // Never relay arbitrary upstream bodies, stack traces or credentials.
      return json(
        {
          error: 'backend_error',
          status: upstream.status,
          detail:
            telegramDetail ||
            (upstream.status === 422
              ? 'Проверьте поля, формат файла и лимит песочницы.'
              : 'API бота недоступен или отклонил запрос. Проверьте соединение и настройки.'),
        },
        upstream.status >= 500 ? 502 : upstream.status,
      );
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return json(
      {
        error: 'backend_unavailable',
        detail: 'Нет соединения с ботом. Проверьте запущенный процесс и Cloudflare Tunnel.',
      },
      502,
    );
  }
}
