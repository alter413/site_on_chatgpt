export interface Env {
  OWNER_PASSWORD?: string;
  BOT_API_URL?: string;
  BOT_ADMIN_TOKEN?: string;
  BOT_ACCESS_CLIENT_ID?: string;
  BOT_ACCESS_CLIENT_SECRET?: string;
}

export const COOKIE = '__Host-sova_session';
export const SESSION_SECONDS = 8 * 3600;
const encoder = new TextEncoder();
export const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });

export function configured(env: Env) {
  return (
    typeof env.OWNER_PASSWORD === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(env.OWNER_PASSWORD)
  );
}

export async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}

async function passwordMatches(candidate: string, expected: string) {
  // High-entropy random access secret, not a human-generated password database.
  // Native HMAC verification avoids JS string equality on password-derived values.
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('raw', encoder.encode(expected), algorithm, false, [
    'verify',
  ]);
  const candidateKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(candidate),
    algorithm,
    false,
    ['sign'],
  );
  const challenge = encoder.encode('sova-owner-login-v1');
  const signature = await crypto.subtle.sign('HMAC', candidateKey, challenge);
  return crypto.subtle.verify('HMAC', key, signature, challenge);
}

export function sameOriginWrite(request: Request) {
  return (
    request.headers.get('Origin') === new URL(request.url).origin &&
    request.headers.get('X-Panel-Request') === '1'
  );
}

export function backendBase(env: Env) {
  if (!env.BOT_API_URL || !env.BOT_ADMIN_TOKEN) throw new Error('backend_configuration');
  const base = new URL(env.BOT_API_URL);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== '/' && base.pathname !== '')
  )
    throw new Error('backend_configuration');
  return base;
}

export function backendHeaders(env: Env) {
  const headers = new Headers({ Authorization: `Bearer ${env.BOT_ADMIN_TOKEN}` });
  if (env.BOT_ACCESS_CLIENT_ID && env.BOT_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id', env.BOT_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', env.BOT_ACCESS_CLIENT_SECRET);
  }
  return headers;
}

export class AuthUnavailable extends Error {}
async function service(env: Env, path: string, body: unknown, fetcher: typeof fetch) {
  try {
    const headers = backendHeaders(env);
    headers.set('Content-Type', 'application/json');
    const response = await fetcher(new URL('/api/v1/auth/' + path, backendBase(env)), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 429) return { throttled: true, valid: false };
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json'))
      throw new Error();
    const reader = response.body?.getReader();
    let text = '';
    const decoder = new TextDecoder();
    if (!reader) throw new Error();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 4096) {
        await reader.cancel();
        throw new Error();
      }
    }
    return JSON.parse(text) as {
      valid?: boolean;
      allowed?: boolean;
      throttled?: boolean;
      created?: boolean;
      revoked?: boolean;
    };
  } catch {
    throw new AuthUnavailable('authentication_service_unavailable');
  }
}

function readCookie(request: Request) {
  const values = (request.headers.get('Cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(COOKIE + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
const cookie = (value: string, age: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function version(env: Env) {
  return digest('sova-owner-version-v1|' + env.OWNER_PASSWORD);
}

export async function authenticated(request: Request, env: Env, fetcher: typeof fetch) {
  const token = readCookie(request);
  if (!token) return false;
  const result = await service(
    env,
    'session/check',
    { digest: await digest(token), version: await version(env) },
    fetcher,
  );
  return result.valid === true;
}

export async function authRoute(
  request: Request,
  env: Env,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!['/api/login', '/api/logout'].includes(path)) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (new URL(request.url).protocol !== 'https:') return json({ error: 'https_required' }, 400);
  if (!sameOriginWrite(request)) return json({ error: 'csrf_rejected' }, 403);
  if (path === '/api/logout') {
    const token = readCookie(request);
    if (token) {
      const result = await service(
        env,
        'session/revoke',
        { digest: await digest(token), version: await version(env) },
        fetcher,
      );
      if (result.revoked !== true) throw new AuthUnavailable();
    }
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', cookie('', 0));
    return response;
  }
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return json({ error: 'invalid_request' }, 400);
  let data: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'invalid_request' }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) {
        await reader.cancel();
        return json({ error: 'request_too_large' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !('password' in data) ||
    Object.keys(data).length !== 1 ||
    typeof data.password !== 'string' ||
    data.password.length < 1 ||
    data.password.length > 128
  )
    return json({ error: 'invalid_request' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = await digest('sova-login-rate-v1|' + env.OWNER_PASSWORD + '|' + ip);
  const attempt = await service(env, 'attempt', { key }, fetcher);
  if (attempt.throttled) {
    const response = json(
      { error: 'too_many_attempts', detail: 'Слишком много попыток. Подождите 15 минут.' },
      429,
    );
    response.headers.set('Retry-After', '900');
    return response;
  }
  if (attempt.allowed !== true) throw new AuthUnavailable();
  if (!(await passwordMatches(data.password, env.OWNER_PASSWORD!)))
    return json({ error: 'unauthorized', detail: 'Неверный пароль.' }, 401);
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const created = await service(
    env,
    'session/create',
    { digest: await digest(token), version: await version(env) },
    fetcher,
  );
  if (created.created !== true) throw new AuthUnavailable();
  const response = json({ email: 'Владелец', access: 'owner', backend_configured: true });
  response.headers.set('Set-Cookie', cookie(token, SESSION_SECONDS));
  return response;
}
