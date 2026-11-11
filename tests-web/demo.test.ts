import { expect, it } from 'vitest';
import { Client } from '../src/client';
import { Demo } from '../src/demo';

it('demo mutates only local state and never calls fetch', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('network forbidden');
  };
  try {
    const client = new Client(new Demo());
    const data = await client.load(7);
    expect(data.chats.length).toBe(4);
    await client.request('/status', { method: 'PUT', body: { status: 'online' } });
    expect((await client.load(7)).status).toBe('online');
    await client.request('/chats/1001', { method: 'PATCH', body: { name: 'Custom' } });
    expect((await client.load(7)).chats[0].name).toBe('Custom');
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});
