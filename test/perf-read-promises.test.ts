import { describe, expect, it } from 'bun:test';
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';

async function capture(path: string, init: RequestInit | undefined, read: (w: HonoContextWrapper) => unknown) {
  const app = new Hono();
  let returned: unknown;
  let settled: { value?: unknown; error?: unknown } = {};

  app.all('*', async (c) => {
    returned = read(new HonoContextWrapper(c));

    try {
      settled = { value: await returned };
    } catch (error) {
      settled = { error };
    }

    return c.body(null, 204);
  });

  await app.request(path, init);

  return { returned, settled };
}

function jsonPost(body: string): RequestInit {
  return { method: 'POST', body, headers: { 'Content-Type': 'application/json' } };
}

const throwingWrapper = () =>
  new HonoContextWrapper({
    get req(): never {
      throw new Error('boom');
    },
  } as unknown as Context);

describe('context read methods return promises', () => {
  it('getQuery resolves the decoded value and undefined when absent', async () => {
    const hit = await capture('/x?name=a%20b&name=c', undefined, (w) => w.getQuery('name'));
    const miss = await capture('/x?other=1', undefined, (w) => w.getQuery('name'));
    const empty = await capture('/x?name', undefined, (w) => w.getQuery('name'));

    expect(hit.returned).toBeInstanceOf(Promise);
    expect(hit.settled).toEqual({ value: 'a b' });
    expect(miss.settled).toEqual({ value: undefined });
    expect(empty.settled).toEqual({ value: '' });
  });

  it('getQueryAll resolves every value', async () => {
    const { returned, settled } = await capture('/x?tag=a&tag=b', undefined, (w) => w.getQueryAll('tag'));

    expect(returned).toBeInstanceOf(Promise);
    expect(settled).toEqual({ value: ['a', 'b'] });
  });

  it('getBody resolves the parsed body, twice', async () => {
    const { returned, settled } = await capture('/x', jsonPost('{"a":1,"b":[true,null]}'), async (w) => [
      await w.getBody(),
      await w.getBody(),
    ]);

    expect(returned).toBeInstanceOf(Promise);
    expect(settled).toEqual({
      value: [
        { a: 1, b: [true, null] },
        { a: 1, b: [true, null] },
      ],
    });
  });

  it('getBody rejects on malformed JSON instead of throwing', async () => {
    const { returned, settled } = await capture('/x', jsonPost('{nope'), (w) => w.getBody());

    expect(returned).toBeInstanceOf(Promise);
    expect(settled.error).toBeInstanceOf(SyntaxError);
  });

  it('getBody and getParseBody resolve validated data, including null', async () => {
    const app = new Hono();
    const seen: unknown[] = [];

    app.post('/json', zValidator('json', z.object({ a: z.number() })), async (c) => {
      seen.push(await new HonoContextWrapper(c).getBody());

      return c.body(null, 204);
    });

    app.post(
      '/null',
      zValidator(
        'json',
        z.any().transform(() => null),
      ),
      async (c) => {
        seen.push(await new HonoContextWrapper(c).getBody());

        return c.body(null, 204);
      },
    );

    app.post('/form', zValidator('form', z.object({ n: z.coerce.number() })), async (c) => {
      seen.push(await new HonoContextWrapper(c).getParseBody());

      return c.body(null, 204);
    });

    await app.request('/json', jsonPost('{"a":1,"extra":2}'));
    await app.request('/null', jsonPost('{"a":1}'));
    await app.request('/form', { method: 'POST', body: new URLSearchParams({ n: '5' }) });

    expect(seen).toEqual([{ a: 1 }, null, { n: 5 }]);
  });

  it('getParseBody resolves the raw form without a validator', async () => {
    const { returned, settled } = await capture('/x', { method: 'POST', body: new URLSearchParams({ k: 'v' }) }, (w) =>
      w.getParseBody(),
    );

    expect(returned).toBeInstanceOf(Promise);
    expect(settled).toEqual({ value: { k: 'v' } });
  });

  it('turns a synchronous failure into a rejection', async () => {
    for (const read of [
      (w: HonoContextWrapper) => w.getQuery('a'),
      (w: HonoContextWrapper) => w.getQueryAll('a'),
      (w: HonoContextWrapper) => w.getBody(),
      (w: HonoContextWrapper) => w.getParseBody(),
    ]) {
      let returned: unknown;

      expect(() => {
        returned = read(throwingWrapper());
      }).not.toThrow();
      expect(returned).toBeInstanceOf(Promise);
      await expect(returned as Promise<unknown>).rejects.toThrow('boom');
    }
  });
});
