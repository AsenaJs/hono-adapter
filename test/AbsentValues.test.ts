import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';

async function read(path: string, cookie: string | undefined, fn: (w: HonoContextWrapper) => Promise<unknown>) {
  const app = new Hono();
  let value: unknown = 'not read';

  app.get('*', async (c) => {
    value = await fn(new HonoContextWrapper(c));

    return c.body(null, 204);
  });

  await app.request(path, cookie ? { headers: { cookie } } : undefined);

  return value;
}

describe('absent values match the declared types', () => {
  it('getQueryAll resolves [] for a missing key', async () => {
    expect(await read('/x?other=1', undefined, (w) => w.getQueryAll('missing'))).toEqual([]);
    expect(await read('/x', undefined, (w) => w.getQueryAll('missing'))).toEqual([]);
  });

  it('getQueryAll still resolves every value of a present key', async () => {
    expect(await read('/x?tag=a&tag=b', undefined, (w) => w.getQueryAll('tag'))).toEqual(['a', 'b']);
  });

  it('getCookie resolves false for a missing cookie', async () => {
    expect(await read('/x', 'other=1', (w) => w.getCookie('missing'))).toBe(false);
    expect(await read('/x', undefined, (w) => w.getCookie('missing'))).toBe(false);
  });

  it('getCookie with a secret resolves false for a missing cookie', async () => {
    expect(await read('/x', 'other=1', (w) => w.getCookie('missing', 'secret'))).toBe(false);
    expect(await read('/x', undefined, (w) => w.getCookie('missing', 'secret'))).toBe(false);
  });

  it('getCookie with a secret resolves false for a bad signature and the value for a good one', async () => {
    const app = new Hono();
    let signed = '';

    app.get('/sign', async (c) => {
      await new HonoContextWrapper(c).setCookie('session', 'abc', { secret: 'secret' });

      return c.body(null, 204);
    });

    const res = await app.request('/sign');

    signed = res.headers.get('set-cookie')!.split(';')[0];

    expect(await read('/x', signed, (w) => w.getCookie('session', 'secret'))).toBe('abc');
    expect(await read('/x', signed, (w) => w.getCookie('session', 'other-secret'))).toBe(false);
  });

  it('getCookie still resolves a present cookie', async () => {
    expect(await read('/x', 'session=abc; other=1', (w) => w.getCookie('session'))).toBe('abc');
  });
});
