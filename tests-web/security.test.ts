import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { allowedRoute, handleRequest, type Env } from '../server/gateway';

const env: Env = {
  OWNER_EMAIL: 'owner@example.com',
  CF_ACCESS_TEAM_DOMAIN: 'https://myteam.cloudflareaccess.com',
  CF_ACCESS_AUD: 'app-audience',
  BOT_API_URL: 'https://bot.example.com',
  BOT_ADMIN_TOKEN: 'private-bot-token',
};
let privateKey: CryptoKey;
let key: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'test-key';
  key = createLocalJWKSet({ keys: [jwk] });
});
async function token(email = 'owner@example.com', aud = 'app-audience', expired = false) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('owner-id')
    .setIssuer(env.CF_ACCESS_TEAM_DOMAIN!)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 100 : '10m')
    .sign(privateKey);
}
async function request(
  path = '/api/v1/status',
  method = 'GET',
  jwt?: string,
  extra: Record<string, string> = {},
) {
  return new Request('https://panel.example.com' + path, {
    method,
    headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...extra },
    ...(method === 'PATCH' || method === 'PUT' ? { body: '{"status":"busy"}' } : {}),
  });
}

describe('owner authorization', () => {
  it('fails closed before configuration', async () => {
    const result = await handleRequest(await request(), {});
    expect(result.status).toBe(503);
  });
  it('rejects missing JWT and forged email headers', async () => {
    const result = await handleRequest(
      await request('/api/session', 'GET', undefined, {
        'Cf-Access-Authenticated-User-Email': 'owner@example.com',
      }),
      env,
      { key },
    );
    expect(result.status).toBe(401);
  });
  it('allows only a signed owner token and never returns secrets', async () => {
    const result = await handleRequest(await request('/api/session', 'GET', await token()), env, {
      key,
    });
    expect(result.status).toBe(200);
    const body = await result.text();
    expect(body).toContain('owner@example.com');
    expect(body).not.toContain('private-bot-token');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each(['other_email', 'wrong_audience', 'expired', 'tampered'])('rejects %s', async (kind) => {
    let jwt = await token(
      kind === 'other_email' ? 'stranger@example.com' : undefined,
      kind === 'wrong_audience' ? 'another-app' : undefined,
      kind === 'expired',
    );
    if (kind === 'tampered') jwt = jwt.slice(0, -5) + 'abcde';
    const result = await handleRequest(await request('/api/session', 'GET', jwt), env, { key });
    expect(result.status).toBe(401);
  });
  it('does not permit a development bypass', async () => {
    const result = await handleRequest(
      await request('/api/session', 'GET', undefined, {
        'X-Demo': 'true',
        Authorization: 'Bearer private-bot-token',
      }),
      env,
      { key },
    );
    expect(result.status).toBe(401);
  });
});

describe('proxy boundary', () => {
  it('rejects cross-origin writes', async () => {
    const upstream = vi.fn();
    const result = await handleRequest(
      await request('/api/v1/status', 'PUT', await token(), {
        Origin: 'https://evil.example',
        'X-Panel-Request': '1',
      }),
      env,
      { key, fetch: upstream },
    );
    expect(result.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('requires the UI request header even with origin', async () => {
    const result = await handleRequest(
      await request('/api/v1/status', 'PUT', await token(), {
        Origin: 'https://panel.example.com',
      }),
      env,
      { key },
    );
    expect(result.status).toBe(403);
  });
  it('adds only server credentials and does not forward cookies or user auth', async () => {
    const upstream = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const h = new Headers(options?.headers);
      expect(h.get('Authorization')).toBe('Bearer private-bot-token');
      expect(h.get('Cookie')).toBeNull();
      expect(h.get('Cf-Access-Jwt-Assertion')).toBeNull();
      expect(options?.redirect).toBe('manual');
      return Response.json({ status: 'busy' });
    });
    const result = await handleRequest(
      await request('/api/v1/status', 'PUT', await token(), {
        Origin: 'https://panel.example.com',
        'X-Panel-Request': '1',
        Cookie: 'sensitive=cookie',
        Authorization: 'Bearer injected',
      }),
      env,
      { key, fetch: upstream },
    );
    expect(result.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });
  it('blocks redirects and arbitrary upstream error bodies', async () => {
    for (const status of [302, 500]) {
      const result = await handleRequest(
        await request('/api/v1/health', 'GET', await token()),
        env,
        {
          key,
          fetch: async () =>
            new Response('SECRET', { status, headers: { Location: 'https://evil.example' } }),
        },
      );
      expect(result.status).toBe(502);
      expect(await result.text()).not.toContain('SECRET');
    }
  });
  it('blocks arbitrary paths and methods', () => {
    expect(allowedRoute('/api/v1/chats/42', 'PATCH')).toBe(true);
    for (const path of [
      '/api/v1/anything',
      '/api/v1/chats/-1',
      '/openapi.json',
      '/api/v1/chats/42/../../secret',
    ])
      expect(allowedRoute(path, 'GET')).toBe(false);
    expect(allowedRoute('/api/v1/health', 'POST')).toBe(false);
  });
  it('requires an HTTPS backend origin without userinfo', async () => {
    for (const url of [
      'http://localhost:8765',
      'https://key:secret@bot.example.com',
      'https://bot.example.com/path',
    ]) {
      const result = await handleRequest(
        await request('/api/v1/health', 'GET', await token()),
        { ...env, BOT_API_URL: url },
        { key },
      );
      expect(result.status).toBe(503);
    }
  });
});
