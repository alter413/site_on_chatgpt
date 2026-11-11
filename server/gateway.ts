import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Env {
  OWNER_EMAIL?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  BOT_API_URL?: string;
  BOT_ADMIN_TOKEN?: string;
  BOT_ACCESS_CLIENT_ID?: string;
  BOT_ACCESS_CLIENT_SECRET?: string;
}

const MAX_BODY = 8 * 1024 * 1024 + 65536;
const jwksCache = new Map<string, JWTVerifyGetKey>();
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });

export function identityConfig(env: Env) {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!env.OWNER_EMAIL || !env.CF_ACCESS_AUD || !team) return null;
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return null;
  return { team, audience: env.CF_ACCESS_AUD, owner: env.OWNER_EMAIL.trim().toLowerCase() };
}

export async function ownerIdentity(request: Request, env: Env, key?: JWTVerifyGetKey) {
  const config = identityConfig(env);
  if (!config) throw new Error('not_configured');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new Error('unauthorized');
  if (!key) {
    key = jwksCache.get(config.team);
    if (!key) {
      key = createRemoteJWKSet(new URL(config.team + '/cdn-cgi/access/certs'));
      jwksCache.set(config.team, key);
    }
  }
  const { payload } = await jwtVerify(token, key, {
    issuer: config.team,
    audience: config.audience,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'email'],
    clockTolerance: 5,
  });
  if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== config.owner)
    throw new Error('forbidden');
  return payload.email;
}

export function allowedRoute(path: string, method: string) {
  const routes: [RegExp, string[]][] = [
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
    key?: JWTVerifyGetKey;
    fetch?: typeof fetch;
  } = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (!identityConfig(env))
    return json(
      {
        error: 'not_configured',
        detail: 'Настройте Cloudflare Access и OWNER_EMAIL. Доступ к управлению закрыт.',
      },
      503,
    );
  let email: string;
  try {
    email = await ownerIdentity(request, env, dependencies.key);
  } catch {
    return json(
      { error: 'unauthorized', detail: 'Войдите в Cloudflare Access аккаунтом владельца.' },
      401,
    );
  }
  if (url.pathname === '/api/session' && request.method === 'GET')
    return json({
      email,
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
        detail: 'Добавьте BOT_API_URL и BOT_ADMIN_TOKEN в Cloudflare Pages.',
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
      // Never relay arbitrary upstream bodies, stack traces or credentials.
      return json(
        {
          error: 'backend_error',
          status: upstream.status,
          detail:
            upstream.status === 422
              ? 'Проверьте поля, формат файла и лимит песочницы.'
              : 'API бота недоступен или отклонил запрос. Проверьте соединение и настройки.',
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
