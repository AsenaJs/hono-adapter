import { afterEach, describe, expect, it } from 'bun:test';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';
import { ValidationError } from '../lib/errors';

async function withContext<T>(path: string, init: RequestInit | undefined, read: (c: Context) => T): Promise<T> {
  const app = new Hono();
  let result: T;

  app.all('*', (c) => {
    result = read(c);

    return c.body(null, 204);
  });

  await app.request(path, init);

  return result!;
}

const headerCases: [string, HeadersInit][] = [
  ['none', []],
  ['single', [['X-Request-Id', 'abc']]],
  [
    'unsorted with common and custom names',
    [
      ['zz-custom', 'q'],
      ['Host', 'example.test'],
      ['X-B', '1'],
      ['a-z', '2'],
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer t'],
      ['accept', '*/*'],
    ],
  ],
  [
    'repeated names',
    [
      ['X-B', '1'],
      ['x-b', '3'],
      ['Accept', 'text/html'],
      ['accept', 'application/json'],
    ],
  ],
  [
    'repeated set-cookie',
    [
      ['Set-Cookie', 's=1'],
      ['set-cookie', 't=2'],
      ['cookie', 'a=1'],
      ['x-trace', '1'],
    ],
  ],
  [
    'single set-cookie',
    [
      ['x-trace', '1'],
      ['Set-Cookie', 's=1'],
      ['accept', '*/*'],
    ],
  ],
];

describe('headers record', () => {
  for (const [name, headers] of headerCases) {
    it(`matches Hono's req.header() for ${name}`, async () => {
      const [ours, hono] = await withContext('/h', { headers }, (c) => [
        new HonoContextWrapper(c).headers,
        c.req.header(),
      ]);

      expect(ours).toEqual(hono);
      expect(Object.keys(ours)).toEqual(Object.keys(hono));
      expect(Object.getPrototypeOf(ours)).toBe(Object.getPrototypeOf(hono));
    });
  }

  it('returns a fresh object on every read', async () => {
    const [first, second] = await withContext('/h', { headers: { 'X-A': '1' } }, (c) => {
      const wrapper = new HonoContextWrapper(c);

      return [wrapper.headers, wrapper.headers];
    });

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe('query reads', () => {
  it('follow a context swapped through the setter', async () => {
    const values = await new Promise<(string | undefined)[]>((resolve) => {
      const app = new Hono();
      let first: Context | undefined;

      app.all('*', async (c) => {
        if (!first) {
          first = c;

          return c.body(null, 204);
        }

        const wrapper = new HonoContextWrapper(first);
        const before = await wrapper.getQuery('q');

        wrapper.context = c;
        resolve([before, await wrapper.getQuery('q'), await wrapper.getQuery('missing')]);

        return c.body(null, 204);
      });

      void Promise.resolve(app.request('/a?q=one')).then(() => app.request('/b?q=two'));
    });

    expect(values).toEqual(['one', 'two', undefined]);
  });

  it('match Hono for repeated, encoded and valueless keys', async () => {
    const url = '/q?a=1&a=2&b=x%20y&c&d=p+q&na%6De=enc&name=plain';

    const [ours, hono] = await withContext(url, undefined, async (c) => {
      const wrapper = new HonoContextWrapper(c);
      const keys = ['a', 'b', 'c', 'd', 'name', 'na%6De', 'missing'];

      return [await Promise.all(keys.map((k) => wrapper.getQuery(k))), keys.map((k) => c.req.query(k))];
    });

    expect(ours).toEqual(hono);
  });

  const queryCases: [string, string[]][] = [
    ['/q', ['a', '', 'na%6De']],
    ['/q?', ['a', '']],
    ['/q?&page=1', ['page', 'pag', '']],
    ['/q?pages=1&page=2&xpage=3', ['page', 'pages', 'age', 'xpage']],
    ['/q?a=x+y&b=plain', ['a', 'b', 'missing']],
    ['/q?a=plain&b=%41', ['a', 'b', 'c']],
    ['/q?a=1?b=2&c', ['a', 'b', 'c', '?b']],
    ['/q?x=1&a', ['a', 'x']],
    ['/q?a&x=1', ['a', 'x']],
    ['/q?a=&b=2', ['a', 'b']],
    ['/q?%61=enc', ['a', '%61']],
    ['/q?a+b=1&a%20b=2', ['a b', 'a+b', 'a%20b']],
    ['/q?k=v&k=w', ['k']],
    ['/q?=v&k', ['', 'k']],
  ];

  for (const [url, keys] of queryCases) {
    it(`match Hono for ${url}`, async () => {
      const [ours, hono] = await withContext(url, undefined, async (c) => {
        const wrapper = new HonoContextWrapper(c);

        return [await Promise.all(keys.map((k) => wrapper.getQuery(k))), keys.map((k) => c.req.query(k))];
      });

      expect(ours).toEqual(hono);
    });
  }
});

describe('validator without a hook', () => {
  let adapter: HonoAdapter | undefined;

  afterEach(async () => {
    await adapter?.stop();
    adapter = undefined;
  });

  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, profile: noop };

  async function start(onError?: (error: Error) => Response | undefined) {
    adapter = new HonoAdapter(logger as never);

    if (onError) {
      adapter.onError((error) => onError(error));
    }

    await adapter.registerRoute({
      method: 'post' as never,
      path: '/v',
      middlewares: [],
      validator: {
        json: { handle: () => z.object({ name: z.string().min(3) }) },
      } as never,
      handler: async (ctx) => ctx.send(await ctx.getBody(), 200),
      staticServe: undefined,
      controllerName: 'V',
      controllerBasePath: '/',
    } as never);

    adapter.setPort(10000 + Math.floor(Math.random() * 22000));

    const server = await adapter.start();

    return `http://127.0.0.1:${server.port}/v`;
  }

  const post = (url: string, body: unknown) =>
    fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  it('hands the parsed output to the handler', async () => {
    const url = await start();
    const res = await post(url, { name: 'asena', extra: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'asena' });
  });

  it('routes a failure to onError as a ValidationError', async () => {
    let seen: Error | undefined;
    const url = await start((error) => {
      seen = error;

      return new Response('handled', { status: 422 });
    });
    const res = await post(url, { name: 'a' });

    expect(res.status).toBe(422);
    expect(await res.text()).toBe('handled');
    expect(seen).toBeInstanceOf(ValidationError);
  });

  it('answers 400 when no error handler is registered', async () => {
    const url = await start();
    const res = await post(url, { name: 'a' });

    expect(res.status).toBe(400);
  });
});
