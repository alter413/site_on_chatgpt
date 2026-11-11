import { describe, expect, it, vi } from 'vitest';
import { COOKIE, SESSION_SECONDS } from '../server/auth';
import { allowedRoute, handleRequest, type Env } from '../server/gateway';

// Deliberately public test fixture, never a deployment credential.
const PASSWORD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk0123456789_-';
const env: Env = {
  OWNER_PASSWORD: PASSWORD,
  BOT_API_URL: 'https://bot.example.com',
  BOT_ADMIN_TOKEN: 'private-bot-token',
};
const origin = 'https://panel.example.com';
class Backend {
  sessions = new Map<string, { version: string; expires: number }>();
  attempts = new Map<string, number>();
  bodies: string[] = [];
  upstream = vi.fn(async () => Response.json({ status: 'busy' }));
  fetch: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const headers = new Headers(options?.headers);
    expect(headers.get('Authorization')).toBe('Bearer private-bot-token');
    expect(headers.get('Cookie')).toBeNull();
    expect(headers.get('Cf-Access-Jwt-Assertion')).toBeNull();
    expect(options?.redirect).toBe('manual');
    if (!url.pathname.startsWith('/api/v1/auth/')) return this.upstream();
    const raw = String(options?.body);
    this.bodies.push(raw);
    const body = JSON.parse(raw);
    if (url.pathname.endsWith('/attempt')) {
      const count = (this.attempts.get(body.key) || 0) + 1;
      this.attempts.set(body.key, count);
      return Response.json(count > 10 ? { detail: 'limited' } : { allowed: true }, {
        status: count > 10 ? 429 : 200,
      });
    }
    if (url.pathname.endsWith('/create')) {
      this.sessions.set(body.digest, {
        version: body.version,
        expires: Date.now() + SESSION_SECONDS * 1000,
      });
      return Response.json({ created: true });
    }
    if (url.pathname.endsWith('/revoke')) {
      this.sessions.delete(body.digest);
      return Response.json({ revoked: true });
    }
    const stored = this.sessions.get(body.digest);
    return Response.json({
      valid: !!stored && stored.version === body.version && stored.expires > Date.now(),
    });
  };
}
function request(
  path = '/api/session',
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const method = options.method || 'GET';
  return new Request(origin + path, {
    method,
    headers: {
      ...(method !== 'GET'
        ? { Origin: origin, 'X-Panel-Request': '1', 'Content-Type': 'application/json' }
        : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
async function login(backend: Backend, password = PASSWORD) {
  return handleRequest(request('/api/login', { method: 'POST', body: { password } }), env, {
    fetch: backend.fetch,
  });
}
async function cookie(backend: Backend) {
  const response = await login(backend);
  expect(response.status).toBe(200);
  return response.headers.get('Set-Cookie')!.split(';')[0];
}

describe('password owner authentication', () => {
  it('fails closed if the password is unset or weak', async () => {
    for (const value of [undefined, 'short'])
      expect((await handleRequest(request(), { OWNER_PASSWORD: value })).status).toBe(503);
  });
  it('does not trust old Access headers, bearer keys or demo flags', async () => {
    const backend = new Backend();
    const response = await handleRequest(
      request('/api/session', {
        headers: {
          'Cf-Access-Jwt-Assertion': 'forged',
          'Cf-Access-Authenticated-User-Email': 'owner@example.com',
          Authorization: 'Bearer private-bot-token',
          'X-Demo': 'true',
        },
      }),
      env,
      { fetch: backend.fetch },
    );
    expect(response.status).toBe(401);
    expect(backend.bodies).toHaveLength(0);
  });
  it('sets a secure cookie and stores only session digests in the backend', async () => {
    const backend = new Backend();
    const response = await login(backend);
    expect(response.status).toBe(200);
    const header = response.headers.get('Set-Cookie')!;
    for (const part of [
      COOKIE + '=',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Path=/',
      'Max-Age=28800',
    ])
      expect(header).toContain(part);
    const raw = header.split(';')[0].split('=')[1];
    expect(raw).toHaveLength(43);
    expect(backend.sessions.has(raw)).toBe(false);
    expect(backend.bodies.join(' ')).not.toContain(PASSWORD);
    expect(backend.bodies.join(' ')).not.toContain(raw);
    expect(await response.text()).not.toContain(PASSWORD);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects a wrong password and globally throttles repeated attempts', async () => {
    const backend = new Backend();
    for (let i = 0; i < 10; i++) expect((await login(backend, 'wrong-password')).status).toBe(401);
    const response = await login(backend);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('900');
    expect(backend.sessions.size).toBe(0);
  });
  it('checks the shared backend on every authenticated request', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    const response = await handleRequest(request('/api/session', { cookie: stored }), env, {
      fetch: backend.fetch,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ access: 'owner' });
    backend.sessions.clear();
    expect(
      (
        await handleRequest(request('/api/session', { cookie: stored }), env, {
          fetch: backend.fetch,
        })
      ).status,
    ).toBe(401);
  });
  it('rejects expired, tampered and duplicate cookies', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    for (const session of backend.sessions.values()) session.expires = 0;
    for (const value of [stored, stored + 'tampered', stored + '; ' + stored])
      expect(
        (
          await handleRequest(request('/api/session', { cookie: value }), env, {
            fetch: backend.fetch,
          })
        ).status,
      ).toBe(401);
  });
  it('password rotation invalidates every old session', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    const rotated = { ...env, OWNER_PASSWORD: 'another-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' };
    expect(
      (
        await handleRequest(request('/api/session', { cookie: stored }), rotated, {
          fetch: backend.fetch,
        })
      ).status,
    ).toBe(401);
  });
  it('logout revokes on the server and blocks replay of the cookie', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    const result = await handleRequest(
      request('/api/logout', { method: 'POST', cookie: stored }),
      env,
      { fetch: backend.fetch },
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(
      (
        await handleRequest(request('/api/session', { cookie: stored }), env, {
          fetch: backend.fetch,
        })
      ).status,
    ).toBe(401);
  });
  it('generates a different opaque token for each login', async () => {
    const backend = new Backend();
    expect(await cookie(backend)).not.toBe(await cookie(backend));
  });
  it('rejects cross-origin login and logout before backend access', async () => {
    const backend = new Backend();
    for (const path of ['/api/login', '/api/logout']) {
      const result = await handleRequest(
        request(path, {
          method: 'POST',
          body: { password: PASSWORD },
          headers: { Origin: 'https://evil.example' },
        }),
        env,
        { fetch: backend.fetch },
      );
      expect(result.status).toBe(403);
    }
    expect(backend.bodies).toHaveLength(0);
  });
  it('bounds login input and rejects unexpected fields', async () => {
    const backend = new Backend();
    for (const body of [{ password: 'x'.repeat(2000) }, { password: PASSWORD, extra: true }, {}]) {
      const result = await handleRequest(request('/api/login', { method: 'POST', body }), env, {
        fetch: backend.fetch,
      });
      expect([400, 413]).toContain(result.status);
    }
    expect(backend.bodies).toHaveLength(0);
  });
  it('fails closed if shared auth storage is unavailable', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    const fail = async () => {
      throw new Error('INTERNAL_SECRET');
    };
    for (const req of [
      request('/api/session', { cookie: stored }),
      request('/api/login', { method: 'POST', body: { password: PASSWORD } }),
    ]) {
      const result = await handleRequest(req, env, { fetch: fail });
      expect(result.status).toBe(503);
      expect(await result.text()).not.toContain('INTERNAL_SECRET');
    }
  });
});

describe('authenticated proxy boundary', () => {
  it('allows Telegram setup only after authentication and shows only allowlisted errors', async () => {
    const backend = new Backend();
    expect(allowedRoute('/api/v1/telegram/code', 'POST')).toBe(true);
    expect(allowedRoute('/api/v1/telegram/code', 'GET')).toBe(false);
    expect(
      (
        await handleRequest(request('/api/v1/telegram/code', { method: 'POST', body: {} }), env, {
          fetch: backend.fetch,
        })
      ).status,
    ).toBe(401);
    const stored = await cookie(backend);
    for (const detail of ['Неверный код Telegram', 'PRIVATE_CODE_OR_SESSION']) {
      backend.upstream.mockImplementation(async () => Response.json({ detail }, { status: 422 }));
      const result = await handleRequest(
        request('/api/v1/telegram/verify', {
          method: 'POST',
          cookie: stored,
          body: { code: '00000' },
        }),
        env,
        { fetch: backend.fetch },
      );
      const text = await result.text();
      expect(result.status).toBe(422);
      if (detail === 'Неверный код Telegram') expect(text).toContain(detail);
      else expect(text).not.toContain(detail);
    }
  });
  it('rejects cross-origin writes', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    const result = await handleRequest(
      request('/api/v1/status', {
        method: 'PUT',
        cookie: stored,
        body: { status: 'busy' },
        headers: { Origin: 'https://evil.example' },
      }),
      env,
      { fetch: backend.fetch },
    );
    expect(result.status).toBe(403);
    expect(backend.upstream).not.toHaveBeenCalled();
  });
  it('requires the UI header even with the correct origin', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    const req = request('/api/v1/status', {
      method: 'PUT',
      cookie: stored,
      body: { status: 'busy' },
    });
    req.headers.delete('X-Panel-Request');
    expect((await handleRequest(req, env, { fetch: backend.fetch })).status).toBe(403);
  });
  it('adds only server credentials and does not forward cookies or supplied auth', async () => {
    const backend = new Backend();
    const stored = await cookie(backend);
    const result = await handleRequest(
      request('/api/v1/status', {
        method: 'PUT',
        cookie: stored,
        body: { status: 'busy' },
        headers: { Authorization: 'Bearer injected', 'Cf-Access-Jwt-Assertion': 'untrusted' },
      }),
      env,
      { fetch: backend.fetch },
    );
    expect(result.status).toBe(200);
    expect(backend.upstream).toHaveBeenCalledOnce();
  });
  it('blocks redirects and arbitrary upstream error bodies', async () => {
    for (const status of [302, 500]) {
      const backend = new Backend();
      const stored = await cookie(backend);
      backend.upstream.mockImplementation(
        async () =>
          new Response('SECRET', { status, headers: { Location: 'https://evil.example' } }),
      );
      const result = await handleRequest(request('/api/v1/health', { cookie: stored }), env, {
        fetch: backend.fetch,
      });
      expect(result.status).toBe(502);
      expect(await result.text()).not.toContain('SECRET');
    }
  });
  it('does not publicly proxy the auth service or arbitrary routes', () => {
    for (const path of [
      '/api/v1/auth/session/create',
      '/api/v1/auth/attempt',
      '/api/v1/anything',
      '/api/v1/chats/-1',
      '/openapi.json',
    ])
      expect(allowedRoute(path, 'POST')).toBe(false);
    expect(allowedRoute('/api/v1/chats/42', 'PATCH')).toBe(true);
  });
  it('requires an HTTPS backend origin without userinfo', async () => {
    for (const url of [
      'http://localhost:8765',
      'https://key:secret@bot.example.com',
      'https://bot.example.com/path',
    ]) {
      const result = await handleRequest(
        request('/api/login', { method: 'POST', body: { password: PASSWORD } }),
        { ...env, BOT_API_URL: url },
        {
          fetch: async () => {
            throw new Error();
          },
        },
      );
      expect(result.status).toBe(503);
    }
  });
});
